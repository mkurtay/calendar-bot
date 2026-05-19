import { validateSoccerCalendar } from "../../models/soccer/validators.js";
import type {
  SoccerCalendar,
  SoccerEvent,
} from "../../models/soccer/index.js";

function event(
  uid: string,
  overrides: Partial<SoccerEvent> & {
    soccer?: Partial<SoccerEvent["soccer"]>;
  } = {},
): SoccerEvent {
  return {
    uid,
    title: overrides.title ?? "Match",
    start: overrides.start ?? "2026-04-28T19:00:00Z",
    end: overrides.end ?? "2026-04-28T21:00:00Z",
    soccer: {
      home: overrides.soccer?.home ?? "Team A",
      away: overrides.soccer?.away ?? "Team B",
      stage: overrides.soccer?.stage ?? "R16",
      ...overrides.soccer,
    },
  };
}

function calendar(overrides: Partial<SoccerCalendar> = {}): SoccerCalendar {
  return {
    id: overrides.id ?? "test-cal",
    name: overrides.name ?? "Test",
    category: "soccer",
    html_file: overrides.html_file ?? "test.html",
    events: overrides.events ?? [],
    ...(overrides.type ? { type: overrides.type } : {}),
    ...(overrides.teams ? { teams: overrides.teams } : {}),
  } as SoccerCalendar;
}

describe("validateSoccerCalendar — backward compatibility", () => {
  it("accepts a calendar without type or teams (legacy shape)", () => {
    const c = calendar({
      events: [
        event("e1", { soccer: { home: "PSG", away: "Bayern", stage: "R16" } }),
      ],
    });
    expect(validateSoccerCalendar(c).ok).toBe(true);
  });

  it("accepts an existing UCL/WC-style calendar with stage but no type", () => {
    const c = calendar({
      events: [
        event("g1", {
          soccer: {
            home: "Brazil",
            away: "Argentina",
            stage: "Group",
            group: "A",
          },
        }),
        event("f1", {
          soccer: { home: "Brazil", away: "Argentina", stage: "Final" },
        }),
      ],
    });
    expect(validateSoccerCalendar(c).ok).toBe(true);
  });
});

describe("validateSoccerCalendar — type discriminator", () => {
  it("rejects unknown type values", () => {
    const c = calendar({ type: "premier" as never, events: [] });
    const r = validateSoccerCalendar(c);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("type must be"))).toBe(true);
  });

  describe("type=league", () => {
    it("accepts a pure-league calendar with LeaguePlay events", () => {
      const c = calendar({
        type: "league",
        events: [
          event("mw1", {
            soccer: {
              home: "Manchester City",
              away: "Liverpool",
              stage: "LeaguePlay",
              matchday: 1,
            },
          }),
        ],
      });
      expect(validateSoccerCalendar(c).ok).toBe(true);
    });

    it("rejects type=league with knockout-stage events", () => {
      const c = calendar({
        type: "league",
        events: [
          event("ko1", { soccer: { home: "X", away: "Y", stage: "R16" } }),
        ],
      });
      const r = validateSoccerCalendar(c);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes('must be "LeaguePlay"'))).toBe(
        true,
      );
    });

    it("rejects type=league with Group-stage events", () => {
      const c = calendar({
        type: "league",
        events: [
          event("g1", {
            soccer: { home: "X", away: "Y", stage: "Group", group: "A" },
          }),
        ],
      });
      expect(validateSoccerCalendar(c).ok).toBe(false);
    });
  });

  describe("type=cup_groups", () => {
    it("accepts group + matchday on Group events", () => {
      const c = calendar({
        type: "cup_groups",
        events: [
          event("g1", {
            soccer: {
              home: "Brazil",
              away: "Argentina",
              stage: "Group",
              group: "A",
              matchday: 1,
            },
          }),
          event("ko", {
            soccer: { home: "Brazil", away: "France", stage: "R16" },
          }),
        ],
      });
      expect(validateSoccerCalendar(c).ok).toBe(true);
    });

    it("rejects Group-stage events without group letter", () => {
      const c = calendar({
        type: "cup_groups",
        events: [
          event("g1", {
            soccer: { home: "X", away: "Y", stage: "Group", matchday: 1 },
          }),
        ],
      });
      const r = validateSoccerCalendar(c);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes("group required"))).toBe(true);
    });

    it("rejects Group-stage events without matchday", () => {
      const c = calendar({
        type: "cup_groups",
        events: [
          event("g1", {
            soccer: { home: "X", away: "Y", stage: "Group", group: "A" },
          }),
        ],
      });
      const r = validateSoccerCalendar(c);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes("matchday required"))).toBe(true);
    });

    it("rejects type=cup_groups with LeaguePhase events", () => {
      const c = calendar({
        type: "cup_groups",
        events: [
          event("lp", {
            soccer: { home: "X", away: "Y", stage: "LeaguePhase" },
          }),
        ],
      });
      expect(validateSoccerCalendar(c).ok).toBe(false);
    });
  });

  describe("type=cup_swiss", () => {
    it("accepts LeaguePhase + matchday plus knockout events", () => {
      const c = calendar({
        type: "cup_swiss",
        events: [
          event("lp1", {
            soccer: {
              home: "Real Madrid",
              away: "Bayern",
              stage: "LeaguePhase",
              matchday: 1,
            },
          }),
          event("r16-1", {
            soccer: { home: "Real Madrid", away: "PSG", stage: "R16" },
          }),
        ],
      });
      expect(validateSoccerCalendar(c).ok).toBe(true);
    });

    it("rejects LeaguePhase events without matchday", () => {
      const c = calendar({
        type: "cup_swiss",
        events: [
          event("lp1", {
            soccer: { home: "X", away: "Y", stage: "LeaguePhase" },
          }),
        ],
      });
      const r = validateSoccerCalendar(c);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes("matchday required"))).toBe(true);
    });

    it("rejects type=cup_swiss with Group or LeaguePlay events", () => {
      const c1 = calendar({
        type: "cup_swiss",
        events: [
          event("g1", {
            soccer: { home: "X", away: "Y", stage: "Group", group: "A" },
          }),
        ],
      });
      expect(validateSoccerCalendar(c1).ok).toBe(false);

      const c2 = calendar({
        type: "cup_swiss",
        events: [
          event("lp", {
            soccer: { home: "X", away: "Y", stage: "LeaguePlay" },
          }),
        ],
      });
      expect(validateSoccerCalendar(c2).ok).toBe(false);
    });
  });
});

describe("validateSoccerCalendar — teams[] registry", () => {
  it("accepts valid teams with kebab-case ids and names", () => {
    const c = calendar({
      teams: [
        { id: "barcelona", name: "FC Barcelona" },
        { id: "man-city", name: "Manchester City" },
      ],
    });
    expect(validateSoccerCalendar(c).ok).toBe(true);
  });

  it("rejects ids that don't match the slug regex", () => {
    const c = calendar({
      teams: [{ id: "Manchester City", name: "Manchester City" }],
    });
    expect(validateSoccerCalendar(c).ok).toBe(false);
  });

  it("rejects ids with leading or trailing hyphens", () => {
    expect(
      validateSoccerCalendar(calendar({ teams: [{ id: "-x", name: "X" }] })).ok,
    ).toBe(false);
    expect(
      validateSoccerCalendar(calendar({ teams: [{ id: "x-", name: "X" }] })).ok,
    ).toBe(false);
  });

  it("rejects duplicate team ids", () => {
    const c = calendar({
      teams: [
        { id: "psg", name: "PSG" },
        { id: "psg", name: "Paris Saint-Germain" },
      ],
    });
    const r = validateSoccerCalendar(c);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicated"))).toBe(true);
  });

  it("rejects empty team names", () => {
    const c = calendar({ teams: [{ id: "x", name: "" }] });
    expect(validateSoccerCalendar(c).ok).toBe(false);
  });

  it("rejects home_id referencing a team not in teams[]", () => {
    const c = calendar({
      teams: [{ id: "psg", name: "PSG" }],
      events: [
        event("e1", {
          soccer: {
            home: "Bayern",
            away: "PSG",
            stage: "R16",
            home_id: "bayern",
            away_id: "psg",
          },
        }),
      ],
    });
    const r = validateSoccerCalendar(c);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.includes('"bayern"') && e.includes("not in teams[]"),
      ),
    ).toBe(true);
  });

  it("accepts when home_id and away_id both resolve", () => {
    const c = calendar({
      teams: [
        { id: "psg", name: "PSG" },
        { id: "bayern", name: "Bayern Munich" },
      ],
      events: [
        event("e1", {
          soccer: {
            home: "Bayern",
            away: "PSG",
            stage: "R16",
            home_id: "bayern",
            away_id: "psg",
          },
        }),
      ],
    });
    expect(validateSoccerCalendar(c).ok).toBe(true);
  });

  it("does not enforce id refs when teams[] is omitted (backward compat)", () => {
    const c = calendar({
      events: [
        event("e1", {
          soccer: {
            home: "Bayern",
            away: "PSG",
            stage: "R16",
            home_id: "bayern",
            away_id: "psg",
          },
        }),
      ],
    });
    expect(validateSoccerCalendar(c).ok).toBe(true);
  });
});

describe("validateSoccerCalendar — combined valid league example", () => {
  it("accepts a full Premier-League-shaped calendar", () => {
    const c = calendar({
      id: "premier-league-2025-26",
      name: "Premier League 2025-26",
      type: "league",
      teams: [
        { id: "man-city", name: "Manchester City" },
        { id: "liverpool", name: "Liverpool" },
        { id: "arsenal", name: "Arsenal" },
      ],
      events: [
        event("mw1-mci-liv", {
          soccer: {
            home: "Manchester City",
            away: "Liverpool",
            home_id: "man-city",
            away_id: "liverpool",
            stage: "LeaguePlay",
            matchday: 1,
          },
        }),
        event("mw1-ars-mci", {
          start: "2025-08-23T14:00:00Z",
          end: "2025-08-23T16:00:00Z",
          soccer: {
            home: "Arsenal",
            away: "Manchester City",
            home_id: "arsenal",
            away_id: "man-city",
            stage: "LeaguePlay",
            matchday: 2,
          },
        }),
      ],
    });
    expect(validateSoccerCalendar(c).ok).toBe(true);
  });
});
