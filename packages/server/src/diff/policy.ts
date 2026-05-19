// Merge policy for a single event pair. Encodes the locked Q2 rules:
// source wins on schedule fields, local wins on annotations, and
// `local_only` events are sticky (untouched by source updates).

import type { Event } from "../models/types.js";
import type { FieldChange } from "./types.js";

// Returns the event to commit when a current event and an incoming
// (source) event share the same uid. The current event is preserved
// verbatim if marked local_only — source can't update or remove it.
export function mergeEvent(current: Event, incoming: Event): Event {
  if (current.local_only) return current;

  // Q2-B: keep local result when set; let source fill only if local is null.
  const result =
    current.result !== undefined && current.result !== null
      ? current.result
      : (incoming.result ?? null);

  // Q2-A: source wins on schedule + typed_blocks. Local wins on the
  // annotation-shaped fields users typically edit by hand.
  const merged: Event = {
    ...incoming,
    result,
    description_lines: current.description_lines ?? incoming.description_lines,
    emoji: current.emoji ?? incoming.emoji,
  };

  // Strip local_only if it accidentally arrived in incoming (sources
  // shouldn't set it, but defend against a malformed feed).
  delete (merged as { local_only?: boolean }).local_only;

  return merged;
}

// Returns the field-level changes between `before` and `after`. Used
// for the review summary so users can see exactly what's about to
// change. Deep equality via JSON.stringify is fine for the JSON-only
// shape of Event.
export function describeChanges(before: Event, after: Event): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];

  for (const key of keys) {
    const b = (before as unknown as Record<string, unknown>)[key];
    const a = (after as unknown as Record<string, unknown>)[key];
    if (!deepEqual(b, a)) {
      changes.push({ field: key, before: b, after: a });
    }
  }

  // Stable order for snapshots and human review.
  changes.sort((x, y) => x.field.localeCompare(y.field));
  return changes;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Treat undefined and null as equivalent — both mean "no value" in
  // the event model, and the merge intentionally normalizes one to
  // the other for `result`. Distinguishing them here would produce
  // spurious diff entries on no-op merges.
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return true;
  }
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
