import { deriveLegs } from "../../models/soccer/legs.js";
import {
  isSoccerStage,
  normalizeStage,
  stageRank,
  type SoccerStage,
} from "../../models/soccer/stages.js";
import { isTBD, tbdTitle } from "../../models/soccer/tbd.js";
import type { SoccerEvent } from "../../models/soccer/index.js";
import { validateSoccerEvent } from "../../models/soccer/validators.js";

function makeEvent(
  overrides: Partial<SoccerEvent> & {
    soccer?: Partial<SoccerEvent["soccer"]>;
  },
): SoccerEvent {
  return {
    uid: overrides.uid ?? "test-uid",
    title: overrides.title ?? "Test Match",
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

describe("normalizeStage", () => {
  it("returns canonical stages unchanged", () => {
    expect(normalizeStage("R16")).toBe("R16");
    expect(normalizeStage("Final")).toBe("Final");
    expect(normalizeStage("LeaguePhase")).toBe("LeaguePhase");
  });

  it("maps football-data.org enum values", () => {
    expect(normalizeStage("LAST_16")).toBe("R16");
    expect(normalizeStage("LAST_32")).toBe("R32");
    expect(normalizeStage("QUARTER_FINALS")).toBe("Quarterfinal");
    expect(normalizeStage("SEMI_FINALS")).toBe("Semifinal");
    expect(normalizeStage("LEAGUE_STAGE")).toBe("LeaguePhase");
    expect(normalizeStage("GROUP_STAGE")).toBe("Group");
    expect(normalizeStage("THIRD_PLACE")).toBe("ThirdPlace");
    expect(normalizeStage("FINAL")).toBe("Final");
  });

  it("maps api-football and prose strings", () => {
    expect(normalizeStage("Round of 16")).toBe("R16");
    expect(normalizeStage("Round of 32")).toBe("R32");
    expect(normalizeStage("Quarter-finals")).toBe("Quarterfinal");
    expect(normalizeStage("Semifinals")).toBe("Semifinal");
    expect(normalizeStage("Group Stage")).toBe("Group");
    expect(normalizeStage("League Phase")).toBe("LeaguePhase");
  });

  it("is case-insensitive on aliases", () => {
    expect(normalizeStage("last_16")).toBe("R16");
    expect(normalizeStage("round of 16")).toBe("R16");
  });

  it("throws on unknown stage", () => {
    expect(() => normalizeStage("playoffs")).toThrow(/Unknown soccer stage/);
    expect(() => normalizeStage("")).toThrow(/Unknown soccer stage/);
  });
});

describe("isSoccerStage", () => {
  it("accepts canonical stages", () => {
    expect(isSoccerStage("R16")).toBe(true);
    expect(isSoccerStage("Final")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isSoccerStage("LAST_16")).toBe(false);
    expect(isSoccerStage("playoffs")).toBe(false);
    expect(isSoccerStage(undefined)).toBe(false);
    expect(isSoccerStage(42)).toBe(false);
  });
});

describe("stageRank", () => {
  it("orders stages chronologically", () => {
    expect(stageRank("Group")).toBeLessThan(stageRank("R16"));
    expect(stageRank("R16")).toBeLessThan(stageRank("Quarterfinal"));
    expect(stageRank("Semifinal")).toBeLessThan(stageRank("Final"));
  });
});

describe("deriveLegs", () => {
  it("assigns leg 1 and 2 to a UCL R16 tie ordered by start", () => {
    const events = [
      makeEvent({
        uid: "ucl-r16-2",
        start: "2026-03-12T19:00:00Z",
        end: "2026-03-12T21:00:00Z",
        soccer: { home: "Bayern", away: "PSG", stage: "R16" },
      }),
      makeEvent({
        uid: "ucl-r16-1",
        start: "2026-03-05T19:00:00Z",
        end: "2026-03-05T21:00:00Z",
        soccer: { home: "PSG", away: "Bayern", stage: "R16" },
      }),
    ];
    const result = deriveLegs(events);
    const byUid = Object.fromEntries(result.map((e) => [e.uid, e.soccer.leg]));
    expect(byUid["ucl-r16-1"]).toBe(1);
    expect(byUid["ucl-r16-2"]).toBe(2);
  });

  it("treats R32 ties (WC 2026 format) the same way", () => {
    const events = [
      makeEvent({
        uid: "wc-r32-1",
        start: "2026-06-30T18:00:00Z",
        end: "2026-06-30T20:00:00Z",
        soccer: { home: "USA", away: "Mexico", stage: "R32" },
      }),
      makeEvent({
        uid: "wc-r32-2",
        start: "2026-07-04T18:00:00Z",
        end: "2026-07-04T20:00:00Z",
        soccer: { home: "Mexico", away: "USA", stage: "R32" },
      }),
    ];
    const result = deriveLegs(events);
    expect(result.find((e) => e.uid === "wc-r32-1")?.soccer.leg).toBe(1);
    expect(result.find((e) => e.uid === "wc-r32-2")?.soccer.leg).toBe(2);
  });

  it("does not assign legs to single-match stages (Final, ThirdPlace)", () => {
    const events = [
      makeEvent({
        uid: "final",
        soccer: { home: "PSG", away: "Bayern", stage: "Final" },
      }),
    ];
    const result = deriveLegs(events);
    expect(result[0]?.soccer.leg).toBeUndefined();
  });

  it("skips TBD events (one team is null)", () => {
    const events = [
      makeEvent({
        uid: "tbd-1",
        soccer: { home: null, away: "PSG", stage: "R16" },
      }),
      makeEvent({
        uid: "tbd-2",
        soccer: { home: "PSG", away: null, stage: "R16" },
      }),
    ];
    const result = deriveLegs(events);
    expect(result[0]?.soccer.leg).toBeUndefined();
    expect(result[1]?.soccer.leg).toBeUndefined();
  });

  it("does not touch non-KO events (Group, LeaguePhase)", () => {
    const events = [
      makeEvent({
        uid: "group-1",
        soccer: { home: "PSG", away: "Bayern", stage: "Group", group: "A" },
      }),
    ];
    const result = deriveLegs(events);
    expect(result[0]?.soccer.leg).toBeUndefined();
  });

  it("preserves array length and order", () => {
    const events = [
      makeEvent({ uid: "e1" }),
      makeEvent({ uid: "e2" }),
      makeEvent({ uid: "e3" }),
    ];
    const result = deriveLegs(events);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.uid)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("isTBD / tbdTitle", () => {
  it("isTBD true when home or away is null", () => {
    expect(isTBD(makeEvent({ soccer: { home: null, away: "X", stage: "R16" } }))).toBe(true);
    expect(isTBD(makeEvent({ soccer: { home: "X", away: null, stage: "R16" } }))).toBe(true);
    expect(isTBD(makeEvent({ soccer: { home: null, away: null, stage: "R16" } }))).toBe(true);
  });

  it("isTBD false when both teams resolved", () => {
    expect(isTBD(makeEvent({ soccer: { home: "X", away: "Y", stage: "R16" } }))).toBe(false);
  });

  it("tbdTitle uses 'TBD' for null teams", () => {
    expect(tbdTitle(makeEvent({ soccer: { home: null, away: null, stage: "R16" } }))).toBe("TBD vs TBD");
    expect(tbdTitle(makeEvent({ soccer: { home: "Mexico", away: null, stage: "R32" } }))).toBe("Mexico vs TBD");
    expect(tbdTitle(makeEvent({ soccer: { home: "PSG", away: "Bayern", stage: "Final" } }))).toBe("PSG vs Bayern");
  });
});

describe("validateSoccerEvent", () => {
  function valid(): SoccerEvent {
    return makeEvent({});
  }

  it("accepts a fully-formed event", () => {
    expect(validateSoccerEvent(valid())).toEqual({ ok: true, errors: [] });
  });

  it("rejects non-objects", () => {
    expect(validateSoccerEvent(null).ok).toBe(false);
    expect(validateSoccerEvent("not an event").ok).toBe(false);
    expect(validateSoccerEvent(42).ok).toBe(false);
  });

  it("requires uid", () => {
    const e = { ...valid(), uid: "" };
    const r = validateSoccerEvent(e);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("uid must be a non-empty string");
  });

  it("requires ISO-UTC start/end with trailing Z", () => {
    const e = { ...valid(), start: "2026-04-28T19:00:00+02:00" };
    const r = validateSoccerEvent(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("start must be"))).toBe(true);
  });

  it("requires the soccer typed_block", () => {
    const e: Partial<SoccerEvent> = { ...valid() };
    delete (e as { soccer?: unknown }).soccer;
    const r = validateSoccerEvent(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("soccer typed_block"))).toBe(true);
  });

  it("rejects unknown stage values", () => {
    const e = makeEvent({
      soccer: { home: "X", away: "Y", stage: "Playoffs" as SoccerStage },
    });
    const r = validateSoccerEvent(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("stage"))).toBe(true);
  });

  it("accepts null home/away (TBD slot)", () => {
    const e = makeEvent({ soccer: { home: null, away: null, stage: "R32" } });
    expect(validateSoccerEvent(e).ok).toBe(true);
  });

  it("rejects leg values outside {1, 2}", () => {
    const e = makeEvent({
      soccer: { home: "X", away: "Y", stage: "R16", leg: 3 as 1 | 2 },
    });
    const r = validateSoccerEvent(e);
    expect(r.ok).toBe(false);
    expect(r.errors.some((msg) => msg.includes("leg"))).toBe(true);
  });
});
