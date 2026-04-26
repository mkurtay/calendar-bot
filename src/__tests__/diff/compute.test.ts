import type { Event } from "../../models/types.js";
import { diff, summarizeDiff } from "../../diff/compute.js";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    uid: overrides.uid ?? "test-uid",
    title: overrides.title ?? "Test Match",
    start: overrides.start ?? "2026-04-28T19:00:00Z",
    end: overrides.end ?? "2026-04-28T21:00:00Z",
    ...overrides,
  };
}

describe("diff()", () => {
  it("detects no changes when arrays are identical", () => {
    const a = [makeEvent({ uid: "e1" }), makeEvent({ uid: "e2" })];
    const b = [makeEvent({ uid: "e1" }), makeEvent({ uid: "e2" })];
    const result = diff(a, b);
    expect(result.isNoop).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.resolved).toHaveLength(2);
  });

  it("detects added events (in incoming, not current)", () => {
    const current = [makeEvent({ uid: "e1" })];
    const incoming = [makeEvent({ uid: "e1" }), makeEvent({ uid: "e2" })];
    const result = diff(current, incoming);
    expect(result.isNoop).toBe(false);
    expect(result.entries.filter((e) => e.kind === "added")).toHaveLength(1);
    expect(result.resolved.map((e) => e.uid)).toEqual(["e1", "e2"]);
  });

  it("detects removed events (in current, not incoming, not local_only)", () => {
    const current = [makeEvent({ uid: "e1" }), makeEvent({ uid: "e2" })];
    const incoming = [makeEvent({ uid: "e1" })];
    const result = diff(current, incoming);
    expect(result.isNoop).toBe(false);
    const removed = result.entries.filter((e) => e.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(result.resolved.map((e) => e.uid)).toEqual(["e1"]);
  });

  it("detects updated events with field-level changes", () => {
    const current = [
      makeEvent({ uid: "e1", title: "Old", start: "2026-04-28T19:00:00Z" }),
    ];
    const incoming = [
      makeEvent({ uid: "e1", title: "New", start: "2026-04-28T18:00:00Z" }),
    ];
    const result = diff(current, incoming);
    expect(result.isNoop).toBe(false);
    const updated = result.entries.filter((e) => e.kind === "updated");
    expect(updated).toHaveLength(1);
    if (updated[0]?.kind === "updated") {
      const fields = updated[0].changes.map((c) => c.field);
      expect(fields).toContain("title");
      expect(fields).toContain("start");
    }
  });

  describe("local_only handling (Q2-C)", () => {
    it("preserves local_only events that source omits", () => {
      const current = [
        makeEvent({ uid: "e1" }),
        makeEvent({ uid: "watch-party", local_only: true }),
      ];
      const incoming = [makeEvent({ uid: "e1" })];
      const result = diff(current, incoming);
      const preserved = result.entries.filter(
        (e) => e.kind === "preserved-local-only",
      );
      expect(preserved).toHaveLength(1);
      expect(result.resolved.map((e) => e.uid)).toContain("watch-party");
      expect(result.isNoop).toBe(true);
    });

    it("preserves local_only event verbatim even if source returns same uid", () => {
      const localCopy = makeEvent({
        uid: "e1",
        local_only: true,
        title: "My Custom Title",
      });
      const sourceCopy = makeEvent({ uid: "e1", title: "Source's Title" });
      const result = diff([localCopy], [sourceCopy]);
      expect(result.entries.filter((e) => e.kind === "updated")).toHaveLength(0);
      expect(result.resolved[0]?.title).toBe("My Custom Title");
    });
  });

  describe("preserved-result audit (Q2-B)", () => {
    it("records audit entry when source had different result than local", () => {
      const current = [
        makeEvent({
          uid: "e1",
          result: { home_score: 2, away_score: 1, notes: "rain delay" },
        }),
      ];
      const incoming = [
        makeEvent({ uid: "e1", result: { home_score: 2, away_score: 2 } }),
      ];
      const result = diff(current, incoming);
      const preservedResult = result.entries.filter(
        (e) => e.kind === "preserved-result",
      );
      expect(preservedResult).toHaveLength(1);
    });

    it("does not record audit when local result matches source's", () => {
      const current = [
        makeEvent({ uid: "e1", result: { home_score: 1, away_score: 0 } }),
      ];
      const incoming = [
        makeEvent({ uid: "e1", result: { home_score: 1, away_score: 0 } }),
      ];
      const result = diff(current, incoming);
      const preservedResult = result.entries.filter(
        (e) => e.kind === "preserved-result",
      );
      expect(preservedResult).toHaveLength(0);
    });
  });

  it("preserves event order in resolved (current first, adds appended)", () => {
    const current = [makeEvent({ uid: "a" }), makeEvent({ uid: "b" })];
    const incoming = [
      makeEvent({ uid: "c" }),
      makeEvent({ uid: "a" }),
      makeEvent({ uid: "b" }),
    ];
    const result = diff(current, incoming);
    expect(result.resolved.map((e) => e.uid)).toEqual(["a", "b", "c"]);
  });
});

describe("summarizeDiff()", () => {
  it("reports no-op", () => {
    const a = [makeEvent({ uid: "e1" })];
    const result = diff(a, a);
    expect(summarizeDiff(result)).toMatch(/^No changes/);
  });

  it("reports counts for adds, updates, removes", () => {
    const current = [
      makeEvent({ uid: "e1", title: "Old" }),
      makeEvent({ uid: "e2" }),
    ];
    const incoming = [
      makeEvent({ uid: "e1", title: "New" }),
      makeEvent({ uid: "e3" }),
    ];
    const result = diff(current, incoming);
    const summary = summarizeDiff(result);
    expect(summary).toContain("1 added");
    expect(summary).toContain("1 updated");
    expect(summary).toContain("1 removed");
  });
});
