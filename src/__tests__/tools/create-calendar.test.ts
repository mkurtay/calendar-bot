import {
  createCalendar,
  type CreateCalendarParams,
} from "../../tools/create-calendar.js";
import type { Calendar, CalendarStore } from "../../calendar-store.js";

// Minimal mock of CalendarStore.create that records calls and returns
// a fixed commit identifier.
function fakeStore(): {
  store: CalendarStore;
  calls: { calendar: Calendar; message: string }[];
} {
  const calls: { calendar: Calendar; message: string }[] = [];
  const store = {
    create: async (calendar: Calendar, message: string) => {
      calls.push({ calendar, message });
      return {
        sha: "fake-sha",
        commitUrl: `https://github.com/mkurtay/kurtays-calendar/commit/${calendar.id}`,
        path: `data/${calendar.id}.json`,
      };
    },
  } as unknown as CalendarStore;
  return { store, calls };
}

function validSoccerEvent(uid = "ucl-final") {
  return {
    uid,
    title: "Final",
    start: "2026-05-30T19:00:00Z",
    end: "2026-05-30T21:00:00Z",
    soccer: { home: "PSG", away: "Bayern", stage: "Final" },
  };
}

function validF1Event(uid = "f1-2026-r1-race") {
  return {
    uid,
    title: "Australian GP",
    start: "2026-03-08T04:00:00Z",
    end: "2026-03-08T06:00:00Z",
    formula1: {
      round: 1,
      gp_name: "Australian Grand Prix",
      session: "Race",
    },
  };
}

describe("createCalendar", () => {
  it("scaffolds a soccer calendar, auto-deriving id from name", async () => {
    const { store, calls } = fakeStore();
    const params: CreateCalendarParams = {
      name: "UEFA Champions League 2025-26",
      category: "soccer",
      events: [validSoccerEvent()],
    };
    const result = await createCalendar(store, params);

    expect(result.created.id).toBe("uefa-champions-league-2025-26");
    expect(result.created.category).toBe("soccer");
    expect(result.created.event_count).toBe(1);
    expect(result.commit_sha).toBe("fake-sha");
    expect(result.commit_url).toContain("uefa-champions-league-2025-26");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.calendar.id).toBe("uefa-champions-league-2025-26");
    expect(calls[0]?.calendar.html_file).toBe("uefa-champions-league-2025-26.html");
  });

  it("uses explicit id and html_file when provided", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "UEFA Champions League 2025-26",
      category: "soccer",
      id: "ucl-2026",
      html_file: "ucl-2026.html",
      events: [validSoccerEvent()],
    });
    expect(calls[0]?.calendar.id).toBe("ucl-2026");
    expect(calls[0]?.calendar.html_file).toBe("ucl-2026.html");
  });

  it("includes presentation block when provided", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "UCL 2026",
      category: "soccer",
      presentation: {
        subtitle: "Knockout rounds and final",
        badge_label: "Football",
        accent_color: "#1a73e8",
      },
      events: [validSoccerEvent()],
    });
    const cal = calls[0]?.calendar as Calendar & {
      presentation?: { subtitle: string };
    };
    expect(cal.presentation?.subtitle).toBe("Knockout rounds and final");
  });

  it("scaffolds an F1 calendar with the right typed_block", async () => {
    const { store, calls } = fakeStore();
    const result = await createCalendar(store, {
      name: "Formula 1 2026",
      category: "formula1",
      events: [validF1Event()],
    });
    expect(result.created.id).toBe("formula-1-2026");
    expect(result.created.category).toBe("formula1");
    expect(calls[0]?.calendar.events[0]).toMatchObject({
      uid: "f1-2026-r1-race",
      formula1: { round: 1, gp_name: "Australian Grand Prix", session: "Race" },
    });
  });

  it("defaults event status to 'scheduled' and result to null", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "Test",
      category: "soccer",
      id: "test-cal",
      events: [validSoccerEvent()],
    });
    expect(calls[0]?.calendar.events[0]?.status).toBe("scheduled");
    expect(calls[0]?.calendar.events[0]?.result).toBeNull();
  });

  it("includes default ics block (prodid, calscale, method)", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "Test",
      category: "soccer",
      id: "test-cal",
      events: [validSoccerEvent()],
    });
    expect(calls[0]?.calendar.ics).toEqual({
      prodid: "-//kurtays.com//EN",
      calscale: "GREGORIAN",
      method: "PUBLISH",
    });
  });

  it("rejects unknown category", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, { name: "Test", category: "nba", events: [] }),
    ).rejects.toThrow(/Unknown category "nba"/);
  });

  it("rejects empty name", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "   ",
        category: "soccer",
        events: [validSoccerEvent()],
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects malformed events with consolidated error", async () => {
    const { store } = fakeStore();
    const malformed = {
      uid: "bad",
      title: "",
      start: "not-iso",
      end: "not-iso",
      soccer: { home: "X", away: "Y", stage: "Playoffs" },
    };
    await expect(
      createCalendar(store, {
        name: "Bad",
        category: "soccer",
        id: "bad",
        events: [malformed],
      }),
    ).rejects.toThrow(/Invalid events for category "soccer"/);
  });

  it("rejects when an F1 event lacks formula1.round (Rundefined regression)", async () => {
    const { store } = fakeStore();
    const noRound = {
      ...validF1Event(),
      formula1: { gp_name: "Test GP", session: "Race" },
    };
    await expect(
      createCalendar(store, {
        name: "F1",
        category: "formula1",
        id: "f1-test",
        events: [noRound],
      }),
    ).rejects.toThrow(/formula1\.round/);
  });

  it("propagates 'already exists' error from the store", async () => {
    const store = {
      create: async () => {
        throw new Error("File already exists at data/ucl-2026.json");
      },
    } as unknown as CalendarStore;

    await expect(
      createCalendar(store, {
        name: "UCL 2026",
        category: "soccer",
        id: "ucl-2026",
        events: [validSoccerEvent()],
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects when slugified name produces an empty id", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "!!!",
        category: "soccer",
        events: [validSoccerEvent()],
      }),
    ).rejects.toThrow(/Could not derive a valid id/);
  });
});
