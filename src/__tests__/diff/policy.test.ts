import type { Event } from "../../models/types.js";
import { describeChanges, mergeEvent } from "../../diff/policy.js";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    uid: "test-uid",
    title: "Test Match",
    start: "2026-04-28T19:00:00Z",
    end: "2026-04-28T21:00:00Z",
    ...overrides,
  };
}

describe("mergeEvent", () => {
  describe("Q2-A: source wins on schedule", () => {
    it("uses source's start, end, location, title", () => {
      const current = makeEvent({
        title: "Old Title",
        start: "2026-04-28T19:00:00Z",
        end: "2026-04-28T21:00:00Z",
        location: "Old Stadium",
      });
      const incoming = makeEvent({
        title: "New Title",
        start: "2026-04-28T18:00:00Z",
        end: "2026-04-28T20:00:00Z",
        location: "New Stadium",
      });
      const merged = mergeEvent(current, incoming);
      expect(merged.title).toBe("New Title");
      expect(merged.start).toBe("2026-04-28T18:00:00Z");
      expect(merged.end).toBe("2026-04-28T20:00:00Z");
      expect(merged.location).toBe("New Stadium");
    });

    it("uses source's typed_block (e.g. soccer.home/away)", () => {
      const current = {
        ...makeEvent(),
        soccer: { home: "Old", away: "Other", stage: "R16" },
      } as Event & { soccer: { home: string; away: string; stage: string } };
      const incoming = {
        ...makeEvent(),
        soccer: { home: "New", away: "Other", stage: "R16" },
      } as Event & { soccer: { home: string; away: string; stage: string } };
      const merged = mergeEvent(current, incoming) as Event & {
        soccer: { home: string };
      };
      expect(merged.soccer.home).toBe("New");
    });
  });

  describe("Q2-B: local result preserved", () => {
    it("keeps local result when set; ignores source's", () => {
      const current = makeEvent({
        result: { home_score: 2, away_score: 1, notes: "rain-shortened" },
      });
      const incoming = makeEvent({
        result: { home_score: 2, away_score: 2 },
      });
      const merged = mergeEvent(current, incoming);
      expect(merged.result).toEqual({
        home_score: 2,
        away_score: 1,
        notes: "rain-shortened",
      });
    });

    it("uses source's result when local is null", () => {
      const current = makeEvent({ result: null });
      const incoming = makeEvent({ result: { home_score: 2, away_score: 1 } });
      const merged = mergeEvent(current, incoming);
      expect(merged.result).toEqual({ home_score: 2, away_score: 1 });
    });

    it("uses source's result when local is undefined", () => {
      const current = makeEvent({});
      const incoming = makeEvent({ result: { home_score: 1, away_score: 0 } });
      const merged = mergeEvent(current, incoming);
      expect(merged.result).toEqual({ home_score: 1, away_score: 0 });
    });

    it("emits null when both are null/undefined", () => {
      const current = makeEvent({});
      const incoming = makeEvent({});
      const merged = mergeEvent(current, incoming);
      expect(merged.result).toBeNull();
    });
  });

  describe("Q2-C: local_only is sticky", () => {
    it("returns current verbatim when local_only is true", () => {
      const current = makeEvent({
        local_only: true,
        title: "My Watch Party",
      });
      const incoming = makeEvent({
        title: "Source Wants This Title",
      });
      const merged = mergeEvent(current, incoming);
      expect(merged).toBe(current);
      expect(merged.title).toBe("My Watch Party");
    });
  });

  describe("Annotation fields preserved (description_lines, emoji)", () => {
    it("keeps local description_lines when set", () => {
      const current = makeEvent({ description_lines: ["My private note"] });
      const incoming = makeEvent({
        description_lines: ["Source description"],
      });
      const merged = mergeEvent(current, incoming);
      expect(merged.description_lines).toEqual(["My private note"]);
    });

    it("uses source description_lines when local is undefined", () => {
      const current = makeEvent({});
      const incoming = makeEvent({ description_lines: ["From source"] });
      const merged = mergeEvent(current, incoming);
      expect(merged.description_lines).toEqual(["From source"]);
    });

    it("keeps local emoji over source's", () => {
      const current = makeEvent({ emoji: "🎉" });
      const incoming = makeEvent({ emoji: "⚽" });
      const merged = mergeEvent(current, incoming);
      expect(merged.emoji).toBe("🎉");
    });
  });

  it("strips local_only from merged output (defends malformed source)", () => {
    const current = makeEvent({});
    const incoming = makeEvent({ local_only: true });
    const merged = mergeEvent(current, incoming);
    expect(merged.local_only).toBeUndefined();
  });
});

describe("describeChanges", () => {
  it("returns empty array when events are equal", () => {
    const e = makeEvent({});
    expect(describeChanges(e, { ...e })).toEqual([]);
  });

  it("captures changed fields with before/after", () => {
    const before = makeEvent({ title: "Old" });
    const after = makeEvent({ title: "New" });
    const changes = describeChanges(before, after);
    expect(changes).toContainEqual({
      field: "title",
      before: "Old",
      after: "New",
    });
  });

  it("captures added fields (undefined → value)", () => {
    const before = makeEvent({});
    const after = makeEvent({ location: "New Stadium" });
    const changes = describeChanges(before, after);
    expect(changes.some((c) => c.field === "location")).toBe(true);
  });

  it("returns changes in alphabetical order by field name", () => {
    const before = makeEvent({ title: "A" });
    const after = makeEvent({ title: "B", location: "X" });
    const changes = describeChanges(before, after);
    const fields = changes.map((c) => c.field);
    expect(fields).toEqual([...fields].sort());
  });

  it("compares nested objects deeply (typed_block changes detected)", () => {
    const before = {
      ...makeEvent(),
      soccer: { home: "A", away: "B", stage: "R16" },
    } as Event;
    const after = {
      ...makeEvent(),
      soccer: { home: "A", away: "B", stage: "Quarterfinal" },
    } as Event;
    const changes = describeChanges(before, after);
    expect(changes.some((c) => c.field === "soccer")).toBe(true);
  });
});
