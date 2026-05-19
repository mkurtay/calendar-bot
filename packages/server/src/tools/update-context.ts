// Shared state for the review-then-commit flow (Q1). update_calendar
// stashes a PendingUpdate here; apply_calendar_update consumes it.
// Module-level singleton so both tool handlers see the same store
// across MCP calls within a server lifetime.

import type { Calendar } from "../calendar-store.js";
import { TokenStore } from "../diff/tokens.js";
import type { CalendarDiff } from "../diff/types.js";

export interface PendingUpdate {
  calendarId: string;
  diff: CalendarDiff;
  // Pre-merge snapshot of the calendar at update_calendar time.
  // apply_calendar_update rebuilds the post-merge calendar by
  // replacing this snapshot's events with `diff.resolved`.
  calendar: Calendar;
  // The blob sha of the calendar JSON at update time. Used by
  // saveCalendar() to detect concurrent modifications.
  sha: string;
}

export const updateTokens = new TokenStore<PendingUpdate>();
