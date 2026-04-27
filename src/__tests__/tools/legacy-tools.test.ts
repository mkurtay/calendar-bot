import {
  addEvent,
  removeEvent,
  setResult,
  updateEvent,
} from "../../tools.js";
import type { Calendar, CalendarStore } from "../../calendar-store.js";

// In-memory mock CalendarStore for round-tripping the granular tools.
function fakeStore(seed: Calendar): {
  store: CalendarStore;
  saved: { calendar: Calendar; sha: string; message: string }[];
} {
  let current = seed;
  let currentSha = "sha-v1";
  const saved: { calendar: Calendar; sha: string; message: string }[] = [];

  const store = {
    getCalendar: async () => ({
      calendar: current,
      sha: currentSha,
      path: `data/${current.id}.json`,
    }),
    saveCalendar: async (
      calendar: Calendar,
      sha: string,
      message: string,
    ) => {
      saved.push({ calendar, sha, message });
      current = calendar;
      currentSha = `sha-${saved.length + 1}`;
      return {
        sha: currentSha,
        commitUrl: `https://example/commit/${saved.length}`,
      };
    },
  } as unknown as CalendarStore;

  return { store, saved };
}

function soccerCalendar(events: Calendar["events"] = []): Calendar {
  return {
    id: "ucl-2026",
    name: "UCL 2026",
    category: "soccer",
    html_file: "ucl-2026.html",
    ics: { prodid: "-//x//EN", calscale: "GREGORIAN", method: "PUBLISH" },
    events,
  };
}

describe("addEvent — Phase 1.x validation", () => {
  it("commits a well-formed soccer event", async () => {
    const { store, saved } = fakeStore(soccerCalendar());
    await addEvent(store, {
      calendar_id: "ucl-2026",
      title: "PSG vs Bayern",
      start: "2026-04-28T19:00:00Z",
      end: "2026-04-28T21:00:00Z",
      typed_block: {
        soccer: { home: "PSG", away: "Bayern", stage: "R16" },
      },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.calendar.events[0]).toMatchObject({
      title: "PSG vs Bayern",
      soccer: { home: "PSG", away: "Bayern", stage: "R16" },
    });
  });

  it("rejects a soccer event missing the soccer typed_block (the test-A regression)", async () => {
    const { store, saved } = fakeStore(soccerCalendar());
    await expect(
      addEvent(store, {
        calendar_id: "ucl-2026",
        title: "PSG vs Bayern",
        start: "2026-04-28T19:00:00Z",
        end: "2026-04-28T21:00:00Z",
        // typed_block passed flat without the `soccer:` wrapper —
        // this is what Claude Desktop did during smoke-test A and
        // the validator must reject it.
        typed_block: { home: "PSG", away: "Bayern", stage: "Playoffs" },
      }),
    ).rejects.toThrow(/soccer typed_block is required/);
    expect(saved).toHaveLength(0);
  });

  it("rejects an unknown stage value", async () => {
    const { store, saved } = fakeStore(soccerCalendar());
    await expect(
      addEvent(store, {
        calendar_id: "ucl-2026",
        title: "PSG vs Bayern",
        start: "2026-04-28T19:00:00Z",
        end: "2026-04-28T21:00:00Z",
        typed_block: {
          soccer: { home: "PSG", away: "Bayern", stage: "Playoffs" },
        },
      }),
    ).rejects.toThrow(/soccer\.stage must be one of/);
    expect(saved).toHaveLength(0);
  });

  it("rejects malformed start date", async () => {
    const { store, saved } = fakeStore(soccerCalendar());
    await expect(
      addEvent(store, {
        calendar_id: "ucl-2026",
        title: "PSG vs Bayern",
        start: "not-iso",
        end: "2026-04-28T21:00:00Z",
        typed_block: {
          soccer: { home: "PSG", away: "Bayern", stage: "R16" },
        },
      }),
    ).rejects.toThrow(/start must be an ISO-8601 UTC string/);
    expect(saved).toHaveLength(0);
  });
});

describe("updateEvent — Phase 1.x validation", () => {
  function seed() {
    return soccerCalendar([
      {
        uid: "e1",
        title: "PSG vs Bayern",
        start: "2026-04-28T19:00:00Z",
        end: "2026-04-28T21:00:00Z",
        status: "scheduled",
        result: null,
        soccer: { home: "PSG", away: "Bayern", stage: "R16" },
      },
    ]);
  }

  it("applies a benign patch", async () => {
    const { store, saved } = fakeStore(seed());
    await updateEvent(store, {
      calendar_id: "ucl-2026",
      uid: "e1",
      patch: { title: "PSG vs Bayern (rescheduled)" },
    });
    expect(saved[0]?.calendar.events[0]?.title).toBe(
      "PSG vs Bayern (rescheduled)",
    );
  });

  it("rejects a patch that breaks the stage", async () => {
    const { store, saved } = fakeStore(seed());
    await expect(
      updateEvent(store, {
        calendar_id: "ucl-2026",
        uid: "e1",
        patch: {
          soccer: { home: "PSG", away: "Bayern", stage: "Playoffs" },
        },
      }),
    ).rejects.toThrow(/soccer\.stage must be one of/);
    expect(saved).toHaveLength(0);
  });

  it("rejects a patch that drops required fields", async () => {
    const { store, saved } = fakeStore(seed());
    await expect(
      updateEvent(store, {
        calendar_id: "ucl-2026",
        uid: "e1",
        patch: { start: "not-iso" },
      }),
    ).rejects.toThrow(/start must be an ISO-8601 UTC string/);
    expect(saved).toHaveLength(0);
  });
});

describe("setResult — Phase 1.x validation", () => {
  function seed() {
    return soccerCalendar([
      {
        uid: "e1",
        title: "PSG vs Bayern",
        start: "2026-04-28T19:00:00Z",
        end: "2026-04-28T21:00:00Z",
        status: "scheduled",
        result: null,
        soccer: { home: "PSG", away: "Bayern", stage: "R16" },
      },
    ]);
  }

  it("accepts a well-formed SoccerResult", async () => {
    const { store, saved } = fakeStore(seed());
    await setResult(store, {
      calendar_id: "ucl-2026",
      uid: "e1",
      result: { home_score: 2, away_score: 1, status: "ft" },
    });
    expect(saved[0]?.calendar.events[0]?.result).toEqual({
      home_score: 2,
      away_score: 1,
      status: "ft",
    });
    expect(saved[0]?.calendar.events[0]?.status).toBe("completed");
  });

  it("accepts a penalty-shootout result with penalties", async () => {
    const { store, saved } = fakeStore(seed());
    await setResult(store, {
      calendar_id: "ucl-2026",
      uid: "e1",
      result: {
        home_score: 1,
        away_score: 1,
        status: "pen",
        penalties: { home: 5, away: 4 },
      },
    });
    expect(saved[0]?.calendar.events[0]?.result).toMatchObject({
      status: "pen",
      penalties: { home: 5, away: 4 },
    });
  });

  it("rejects a 'pen' status without penalties (the iff constraint)", async () => {
    const { store, saved } = fakeStore(seed());
    await expect(
      setResult(store, {
        calendar_id: "ucl-2026",
        uid: "e1",
        result: { home_score: 1, away_score: 1, status: "pen" },
      }),
    ).rejects.toThrow(/penalties is required when status is "pen"/);
    expect(saved).toHaveLength(0);
  });

  it("rejects penalties on non-pen status", async () => {
    const { store, saved } = fakeStore(seed());
    await expect(
      setResult(store, {
        calendar_id: "ucl-2026",
        uid: "e1",
        result: {
          home_score: 2,
          away_score: 1,
          status: "ft",
          penalties: { home: 1, away: 0 },
        },
      }),
    ).rejects.toThrow(/penalties is only allowed when status is "pen"/);
    expect(saved).toHaveLength(0);
  });

  it("rejects negative scores", async () => {
    const { store, saved } = fakeStore(seed());
    await expect(
      setResult(store, {
        calendar_id: "ucl-2026",
        uid: "e1",
        result: { home_score: -1, away_score: 0 },
      }),
    ).rejects.toThrow(/home_score must be a non-negative integer/);
    expect(saved).toHaveLength(0);
  });

  it("accepts null result (clearing a previously-set result)", async () => {
    const { store, saved } = fakeStore(seed());
    await setResult(store, {
      calendar_id: "ucl-2026",
      uid: "e1",
      result: null,
    });
    expect(saved[0]?.calendar.events[0]?.result).toBeNull();
  });
});

describe("removeEvent — unchanged by Phase 1.x", () => {
  it("removes an event without invoking validation", async () => {
    const { store, saved } = fakeStore(
      soccerCalendar([
        {
          uid: "e1",
          title: "Match",
          start: "2026-04-28T19:00:00Z",
          end: "2026-04-28T21:00:00Z",
          status: "scheduled",
          result: null,
          soccer: { home: "PSG", away: "Bayern", stage: "R16" },
        },
      ]),
    );
    await removeEvent(store, { calendar_id: "ucl-2026", uid: "e1" });
    expect(saved[0]?.calendar.events).toHaveLength(0);
  });
});
