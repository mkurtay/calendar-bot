// Base shapes shared by every category. Per-category models extend
// `Event` with a typed_block (e.g. `soccer`, `formula1`) and refine
// `Calendar` accordingly.

export type EventStatus =
  | "scheduled"
  | "live"
  | "completed"
  | "postponed"
  | "cancelled";

// Per-category result; opaque to base types, validated per-category.
export type EventResult = Record<string, unknown> | null;

// Editorial card metadata for the index page (Q4-a).
export interface Presentation {
  subtitle: string;
  badge_label: string;
  accent_color: string;
  icon?: string;
}

// Generic event base. `start`/`end` are ISO-8601 UTC ending in `Z`.
export interface Event {
  uid: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  emoji?: string;
  description_lines?: string[];
  status?: EventStatus;
  result?: EventResult;
  // Sticky local-only events (Q2-C). When true, source-side updates
  // skip this event entirely.
  local_only?: boolean;
}

// Generic calendar base. Per-category aliases narrow `category` and
// the events array element type.
export interface Calendar<E extends Event = Event> {
  id: string;
  name: string;
  category: string;
  html_file?: string;
  presentation?: Presentation;
  competition?: { name: string; season?: string };
  ics?: { prodid?: string; calscale?: string; method?: string };
  events: E[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// Accepts 2026-04-28T19:00:00Z and 2026-04-28T19:00:00.123Z; rejects
// offsets like +02:00, missing Z, etc.
export function isISOUTC(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s)
  );
}
