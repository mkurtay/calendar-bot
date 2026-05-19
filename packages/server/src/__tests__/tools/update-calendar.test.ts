import {
  updateCalendar,
  type UpdateCalendarParams,
} from "../../tools/update-calendar.js";
import { applyCalendarUpdate } from "../../tools/apply-calendar-update.js";
import type { Calendar, CalendarStore } from "../../calendar-store.js";

// In-memory mock CalendarStore for round-trip tests.
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

function soccerEvent(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    title: "Match",
    start: "2026-04-28T19:00:00Z",
    end: "2026-04-28T21:00:00Z",
    status: "scheduled" as const,
    result: null,
    soccer: { home: "Team A", away: "Team B", stage: "R16" },
    ...overrides,
  };
}

function seedCalendar(events: ReturnType<typeof soccerEvent>[]): Calendar {
  return {
    id: "ucl-2026",
    name: "UCL 2026",
    category: "soccer",
    html_file: "ucl-2026.html",
    ics: { prodid: "-//x//EN", calscale: "GREGORIAN", method: "PUBLISH" },
    events,
  };
}

describe("updateCalendar", () => {
  it("computes a diff and stashes a token (no commits yet)", async () => {
    const seed = seedCalendar([soccerEvent("e1"), soccerEvent("e2")]);
    const { store, saved } = fakeStore(seed);

    const result = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1"), soccerEvent("e3")],
    });

    expect(result.token).toBeTruthy();
    expect(result.calendar_id).toBe("ucl-2026");
    expect(result.is_noop).toBe(false);
    expect(result.summary).toContain("1 added");
    expect(result.summary).toContain("1 removed");
    expect(saved).toHaveLength(0);
  });

  it("returns is_noop when arrays are identical", async () => {
    const seed = seedCalendar([soccerEvent("e1")]);
    const { store } = fakeStore(seed);
    const result = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1")],
    });
    expect(result.is_noop).toBe(true);
  });

  it("rejects unknown calendar id (propagates 404 from store)", async () => {
    const store = {
      getCalendar: async () => {
        throw new Error("Path is not a file: data/missing.json");
      },
    } as unknown as CalendarStore;
    await expect(
      updateCalendar(store, { id: "missing", events: [] }),
    ).rejects.toThrow(/Path is not a file/);
  });

  it("rejects malformed events with consolidated category errors", async () => {
    const seed = seedCalendar([soccerEvent("e1")]);
    const { store } = fakeStore(seed);
    const malformed = {
      uid: "bad",
      title: "",
      start: "not-iso",
      end: "not-iso",
      soccer: { home: "X", away: "Y", stage: "Playoffs" },
    };
    await expect(
      updateCalendar(store, { id: "ucl-2026", events: [malformed] }),
    ).rejects.toThrow(/Invalid (events|calendar) for category "soccer"/);
  });

  it("rejects empty id", async () => {
    const seed = seedCalendar([]);
    const { store } = fakeStore(seed);
    await expect(
      updateCalendar(store, { id: "", events: [] } as UpdateCalendarParams),
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects when calendar has unknown category", async () => {
    const seed: Calendar = { ...seedCalendar([]), category: "tennis" };
    const { store } = fakeStore(seed);
    await expect(
      updateCalendar(store, { id: "ucl-2026", events: [] }),
    ).rejects.toThrow(/unknown category/);
  });
});

describe("applyCalendarUpdate", () => {
  it("commits the resolved diff after a valid update_calendar token", async () => {
    const seed = seedCalendar([soccerEvent("e1"), soccerEvent("e2")]);
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1"), soccerEvent("e3")],
    });
    const applied = await applyCalendarUpdate(store, { token: upd.token });

    expect(applied.is_noop).toBe(false);
    expect(applied.applied.event_count).toBe(2);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.calendar.events.map((e) => e.uid)).toEqual(["e1", "e3"]);
    expect(saved[0]?.message).toMatch(/1 added/);
    expect(saved[0]?.message).toMatch(/1 removed/);
  });

  it("returns is_noop without committing when the diff was empty", async () => {
    const seed = seedCalendar([soccerEvent("e1")]);
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1")],
    });
    const applied = await applyCalendarUpdate(store, { token: upd.token });

    expect(applied.is_noop).toBe(true);
    expect(saved).toHaveLength(0);
  });

  it("rejects unknown token", async () => {
    const seed = seedCalendar([]);
    const { store } = fakeStore(seed);
    await expect(
      applyCalendarUpdate(store, {
        token: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/unknown, expired, or already consumed/);
  });

  it("rejects token after first consumption (one-shot)", async () => {
    const seed = seedCalendar([soccerEvent("e1")]);
    const { store } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1"), soccerEvent("e2")],
    });
    await applyCalendarUpdate(store, { token: upd.token });
    await expect(
      applyCalendarUpdate(store, { token: upd.token }),
    ).rejects.toThrow(/unknown, expired, or already consumed/);
  });

  it("rejects empty token", async () => {
    const seed = seedCalendar([]);
    const { store } = fakeStore(seed);
    await expect(
      applyCalendarUpdate(store, { token: "" }),
    ).rejects.toThrow(/non-empty/);
  });

  it("commit message includes per-kind counts", async () => {
    const seed = seedCalendar([
      soccerEvent("e1", { title: "Old" }),
      soccerEvent("e2"),
    ]);
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1", { title: "New" }), soccerEvent("e3")],
    });
    await applyCalendarUpdate(store, { token: upd.token });

    expect(saved[0]?.message).toMatch(/1 added/);
    expect(saved[0]?.message).toMatch(/1 updated/);
    expect(saved[0]?.message).toMatch(/1 removed/);
  });
});

describe("update_calendar + apply_calendar_update merge policy round-trip", () => {
  it("preserves locally-set result while accepting source's schedule change", async () => {
    // Combine a local-result-protection case with an actual schedule
    // change. Without the title change the diff would be a no-op (the
    // result protection alone doesn't constitute a commit-worthy
    // change), so we'd never see the saved calendar to inspect.
    const seed = seedCalendar([
      soccerEvent("e1", {
        title: "Old Title",
        result: { home_score: 2, away_score: 1, notes: "rain delay" },
        status: "completed",
      }),
    ]);
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [
        soccerEvent("e1", {
          title: "New Title", // source wins on this
          result: { home_score: 2, away_score: 2 }, // local wins on this
          status: "completed",
        }),
      ],
    });
    await applyCalendarUpdate(store, { token: upd.token });

    const committedEvent = saved[0]?.calendar.events[0];
    expect(committedEvent?.title).toBe("New Title");
    expect(committedEvent?.result).toEqual({
      home_score: 2,
      away_score: 1,
      notes: "rain delay",
    });
  });

  it("preserves local_only events that source omits", async () => {
    const seed = seedCalendar([
      soccerEvent("e1"),
      soccerEvent("watch-party", { local_only: true }),
    ]);
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1")],
    });

    expect(upd.is_noop).toBe(true);
    const applied = await applyCalendarUpdate(store, { token: upd.token });
    expect(applied.is_noop).toBe(true);
    expect(saved).toHaveLength(0);
  });
});

describe("update_calendar — teams[] tracking", () => {
  function leagueSeed(
    teams: Array<{ id: string; name: string }>,
    events: ReturnType<typeof soccerEvent>[] = [],
  ): Calendar {
    const cal: Calendar = {
      id: "ucl-2026",
      name: "UCL 2026",
      category: "soccer",
      html_file: "ucl-2026.html",
      ics: { prodid: "-//x//EN", calscale: "GREGORIAN", method: "PUBLISH" },
      events,
    };
    (cal as Record<string, unknown>).teams = teams;
    return cal;
  }

  it("reports added/removed/renamed teams in teams_diff", async () => {
    const seed = leagueSeed(
      [
        { id: "psg", name: "PSG" },
        { id: "bayern", name: "Bayern Munich" },
      ],
      [soccerEvent("e1")],
    );
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1")],
      teams: [
        { id: "psg", name: "Paris Saint-Germain" }, // renamed
        // bayern removed
        { id: "real-madrid", name: "Real Madrid" }, // added
      ],
    });

    expect(upd.teams_diff).toBeDefined();
    expect(upd.teams_diff?.added).toEqual([
      { id: "real-madrid", name: "Real Madrid" },
    ]);
    expect(upd.teams_diff?.removed).toEqual([
      { id: "bayern", name: "Bayern Munich" },
    ]);
    expect(upd.teams_diff?.renamed).toEqual([
      { id: "psg", before: "PSG", after: "Paris Saint-Germain" },
    ]);
    expect(upd.is_noop).toBe(false); // teams changed → not no-op
    expect(saved).toHaveLength(0); // still review-then-commit
  });

  it("commits teams[] alongside events on apply", async () => {
    const seed = leagueSeed(
      [{ id: "psg", name: "PSG" }],
      [soccerEvent("e1", { title: "Old Title" })],
    );
    const { store, saved } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1", { title: "New Title" })],
      teams: [
        { id: "psg", name: "PSG" },
        { id: "bayern", name: "Bayern Munich" },
      ],
    });
    await applyCalendarUpdate(store, { token: upd.token });

    expect(saved).toHaveLength(1);
    const committed = saved[0]?.calendar as Record<string, unknown>;
    expect(committed["teams"]).toEqual([
      { id: "psg", name: "PSG" },
      { id: "bayern", name: "Bayern Munich" },
    ]);
  });

  it("is_noop=true when only events match and teams unchanged", async () => {
    const seed = leagueSeed(
      [{ id: "psg", name: "PSG" }],
      [soccerEvent("e1")],
    );
    const { store } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1")],
      teams: [{ id: "psg", name: "PSG" }],
    });
    expect(upd.is_noop).toBe(true);
    expect(upd.teams_diff?.added).toEqual([]);
    expect(upd.teams_diff?.removed).toEqual([]);
    expect(upd.teams_diff?.renamed).toEqual([]);
  });

  it("teams_diff omitted when teams[] not provided in input", async () => {
    const seed = leagueSeed([], [soccerEvent("e1")]);
    const { store } = fakeStore(seed);

    const upd = await updateCalendar(store, {
      id: "ucl-2026",
      events: [soccerEvent("e1")],
    });
    expect(upd.teams_diff).toBeUndefined();
  });

  it("rejects invalid team id format", async () => {
    const seed = leagueSeed([], [soccerEvent("e1")]);
    const { store } = fakeStore(seed);

    await expect(
      updateCalendar(store, {
        id: "ucl-2026",
        events: [soccerEvent("e1")],
        teams: [{ id: "BadID", name: "Bad" }],
      }),
    ).rejects.toThrow(/teams\[0\]\.id must match/);
  });
});
