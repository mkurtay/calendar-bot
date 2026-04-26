import { validateSoccerResult } from "../../models/soccer/result.js";

describe("validateSoccerResult", () => {
  it("accepts a minimal valid result", () => {
    expect(validateSoccerResult({ home_score: 2, away_score: 1 })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("accepts ft / aet / pen status values", () => {
    expect(
      validateSoccerResult({ home_score: 1, away_score: 1, status: "ft" }).ok,
    ).toBe(true);
    expect(
      validateSoccerResult({ home_score: 1, away_score: 1, status: "aet" }).ok,
    ).toBe(true);
    expect(
      validateSoccerResult({
        home_score: 1,
        away_score: 1,
        status: "pen",
        penalties: { home: 5, away: 4 },
      }).ok,
    ).toBe(true);
  });

  it("rejects unknown status", () => {
    const r = validateSoccerResult({
      home_score: 0,
      away_score: 0,
      status: "draw",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("requires non-negative integer scores", () => {
    expect(
      validateSoccerResult({ home_score: -1, away_score: 0 }).ok,
    ).toBe(false);
    expect(
      validateSoccerResult({ home_score: 1.5, away_score: 0 }).ok,
    ).toBe(false);
    expect(
      validateSoccerResult({ home_score: "2", away_score: 0 }).ok,
    ).toBe(false);
  });

  it("requires penalties when status is pen", () => {
    const r = validateSoccerResult({
      home_score: 1,
      away_score: 1,
      status: "pen",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("penalties is required"))).toBe(
      true,
    );
  });

  it("rejects penalties when status is not pen", () => {
    const r = validateSoccerResult({
      home_score: 2,
      away_score: 0,
      status: "ft",
      penalties: { home: 1, away: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("penalties is only allowed"))).toBe(
      true,
    );
  });

  it("rejects penalties when status is omitted", () => {
    const r = validateSoccerResult({
      home_score: 2,
      away_score: 2,
      penalties: { home: 4, away: 3 },
    });
    expect(r.ok).toBe(false);
  });

  it("validates penalties shape (non-negative integers)", () => {
    const r1 = validateSoccerResult({
      home_score: 1,
      away_score: 1,
      status: "pen",
      penalties: { home: -1, away: 0 },
    });
    expect(r1.ok).toBe(false);

    const r2 = validateSoccerResult({
      home_score: 1,
      away_score: 1,
      status: "pen",
      penalties: { home: "5", away: 0 },
    });
    expect(r2.ok).toBe(false);

    const r3 = validateSoccerResult({
      home_score: 1,
      away_score: 1,
      status: "pen",
      penalties: { home: 5 },
    });
    expect(r3.ok).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateSoccerResult(null).ok).toBe(false);
    expect(validateSoccerResult("2-1").ok).toBe(false);
    expect(validateSoccerResult(42).ok).toBe(false);
  });
});
