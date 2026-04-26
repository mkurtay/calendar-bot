// Shapes for the calendar diff/merge subsystem. Nothing in this file
// mutates state — it only describes the shapes the engine produces.

import type { Event } from "../models/types.js";

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

// Each entry describes one event-level outcome of a diff. The full
// list captures everything we need to render a human-readable summary
// for the review-then-commit flow (Q1).
export type DiffEntry =
  | { kind: "added"; event: Event }
  | { kind: "removed"; event: Event }
  | {
      kind: "updated";
      before: Event;
      after: Event;
      changes: FieldChange[];
    }
  | {
      // Source omitted this event but it's marked local_only — keep it.
      kind: "preserved-local-only";
      event: Event;
    }
  | {
      // Source had a different result than the local one already
      // recorded; we kept the local one (Q2-B). Recorded for audit.
      kind: "preserved-result";
      event: Event;
      sourceResult: Event["result"];
    };

export interface CalendarDiff {
  entries: DiffEntry[];
  // The full event list to commit if the diff is applied.
  resolved: Event[];
  // True when there's nothing to commit (no adds, removes, or updates).
  isNoop: boolean;
}

export interface PendingDiff {
  calendarId: string;
  diff: CalendarDiff;
  // Unix-ms when the entry expires.
  expiresAt: number;
}
