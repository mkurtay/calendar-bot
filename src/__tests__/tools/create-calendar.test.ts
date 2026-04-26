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
    ).rejects.toThrow(/Invalid (events|calendar) for category "soccer"/);
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

describe("createCalendar — competition-format extension", () => {
  it("scaffolds a type=league calendar with teams[]", async () => {
    const { store, calls } = fakeStore();
    const result = await createCalendar(store, {
      name: "Premier League 2025-26",
      category: "soccer",
      type: "league",
      teams: [
        { id: "man-city", name: "Manchester City" },
        { id: "liverpool", name: "Liverpool" },
      ],
      events: [
        {
          uid: "epl-2526-mw1",
          title: "Man City vs Liverpool",
          start: "2025-08-16T14:00:00Z",
          end: "2025-08-16T16:00:00Z",
          soccer: {
            home: "Manchester City",
            away: "Liverpool",
            home_id: "man-city",
            away_id: "liverpool",
            stage: "LeaguePlay",
            matchday: 1,
          },
        },
      ],
    });
    expect(result.created.type).toBe("league");
    expect(result.created.team_count).toBe(2);
    const cal = calls[0]?.calendar as Record<string, unknown>;
    expect(cal["type"]).toBe("league");
    expect(cal["teams"]).toEqual([
      { id: "man-city", name: "Manchester City" },
      { id: "liverpool", name: "Liverpool" },
    ]);
  });

  it("scaffolds a type=cup_groups calendar with group + matchday", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "World Cup 2026",
      category: "soccer",
      type: "cup_groups",
      events: [
        {
          uid: "wc-2026-g-mex-can",
          title: "Mexico vs Canada",
          start: "2026-06-11T20:00:00Z",
          end: "2026-06-11T22:00:00Z",
          soccer: {
            home: "Mexico",
            away: "Canada",
            stage: "Group",
            group: "A",
            matchday: 1,
          },
        },
      ],
    });
    const cal = calls[0]?.calendar as Record<string, unknown>;
    expect(cal["type"]).toBe("cup_groups");
  });

  it("scaffolds a type=cup_swiss calendar with LeaguePhase events carrying matchday", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "UEFA Champions League 2025-26",
      category: "soccer",
      type: "cup_swiss",
      events: [
        {
          uid: "ucl-2526-lp-mw1",
          title: "Real Madrid vs Bayern",
          start: "2025-09-16T19:00:00Z",
          end: "2025-09-16T21:00:00Z",
          soccer: {
            home: "Real Madrid",
            away: "Bayern Munich",
            stage: "LeaguePhase",
            matchday: 1,
          },
        },
      ],
    });
    const cal = calls[0]?.calendar as Record<string, unknown>;
    expect(cal["type"]).toBe("cup_swiss");
  });

  it("rejects type=league with knockout-stage event", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "Premier League 2025-26",
        category: "soccer",
        type: "league",
        events: [
          {
            uid: "bad",
            title: "KO match",
            start: "2025-08-16T14:00:00Z",
            end: "2025-08-16T16:00:00Z",
            soccer: { home: "X", away: "Y", stage: "R16" },
          },
        ],
      }),
    ).rejects.toThrow(/must be "LeaguePlay"/);
  });

  it("rejects unresolved home_id reference", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "Premier League 2025-26",
        category: "soccer",
        type: "league",
        teams: [{ id: "liverpool", name: "Liverpool" }],
        events: [
          {
            uid: "mw1",
            title: "Man City vs Liverpool",
            start: "2025-08-16T14:00:00Z",
            end: "2025-08-16T16:00:00Z",
            soccer: {
              home: "Manchester City",
              away: "Liverpool",
              home_id: "man-city",
              away_id: "liverpool",
              stage: "LeaguePlay",
              matchday: 1,
            },
          },
        ],
      }),
    ).rejects.toThrow(/"man-city" is not in teams\[\]/);
  });

  it("rejects duplicate team ids", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "Premier League 2025-26",
        category: "soccer",
        type: "league",
        teams: [
          { id: "man-city", name: "Manchester City" },
          { id: "man-city", name: "Man City" },
        ],
        events: [],
      }),
    ).rejects.toThrow(/duplicated/);
  });

  it("rejects malformed team id (uppercase)", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "Premier League 2025-26",
        category: "soccer",
        type: "league",
        teams: [{ id: "ManCity", name: "Manchester City" }],
        events: [],
      }),
    ).rejects.toThrow(/teams\[0\]\.id must match/);
  });

  it("does not bake type/teams into a non-soccer calendar", async () => {
    const { store, calls } = fakeStore();
    await createCalendar(store, {
      name: "Formula 1 2026",
      category: "formula1",
      // These would be silently ignored for formula1
      type: "league",
      teams: [{ id: "ferrari", name: "Ferrari" }],
      events: [
        {
          uid: "f1-r1",
          title: "Australian GP",
          start: "2026-03-08T04:00:00Z",
          end: "2026-03-08T06:00:00Z",
          formula1: {
            round: 1,
            gp_name: "Australian Grand Prix",
            session: "Race",
          },
        },
      ],
    });
    const cal = calls[0]?.calendar as Record<string, unknown>;
    expect(cal["type"]).toBeUndefined();
    expect(cal["teams"]).toBeUndefined();
  });

  it("accepts a soccer event with a SoccerResult-shaped result", async () => {
    const { store } = fakeStore();
    await createCalendar(store, {
      name: "Test League",
      category: "soccer",
      type: "league",
      events: [
        {
          uid: "completed-match",
          title: "X vs Y",
          start: "2025-08-16T14:00:00Z",
          end: "2025-08-16T16:00:00Z",
          status: "completed",
          result: {
            home_score: 2,
            away_score: 1,
            status: "ft",
          },
          soccer: {
            home: "X",
            away: "Y",
            stage: "LeaguePlay",
            matchday: 1,
          },
        },
      ],
    });
  });

  it("rejects a soccer event with malformed SoccerResult", async () => {
    const { store } = fakeStore();
    await expect(
      createCalendar(store, {
        name: "Test League",
        category: "soccer",
        type: "league",
        events: [
          {
            uid: "bad-result",
            title: "X vs Y",
            start: "2025-08-16T14:00:00Z",
            end: "2025-08-16T16:00:00Z",
            status: "completed",
            result: {
              home_score: -1,
              away_score: "two",
            },
            soccer: {
              home: "X",
              away: "Y",
              stage: "LeaguePlay",
              matchday: 1,
            },
          },
        ],
      }),
    ).rejects.toThrow(/result\./);
  });
});
