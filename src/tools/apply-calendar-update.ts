// MCP tool: apply_calendar_update. Consumes a token issued by
// update_calendar, rebuilds the post-merge calendar from the stashed
// pre-merge snapshot + diff.resolved events, and commits via
// CalendarStore.saveCalendar. Tokens are one-shot (consume removes
// the entry) and expire after 10 minutes.

import type { Calendar, CalendarStore } from "../calendar-store.js";
import { updateTokens, type PendingUpdate } from "./update-context.js";

export interface ApplyCalendarUpdateParams {
  token: string;
}

export interface ApplyCalendarUpdateResult {
  applied: {
    calendar_id: string;
    event_count: number;
    summary: string;
  };
  commit_sha: string;
  commit_url: string;
  is_noop: boolean;
}

export async function applyCalendarUpdate(
  store: CalendarStore,
  params: ApplyCalendarUpdateParams,
): Promise<ApplyCalendarUpdateResult> {
  if (typeof params.token !== "string" || params.token.length === 0) {
    throw new Error("token must be a non-empty string");
  }

  const pending: PendingUpdate | null = updateTokens.consume(params.token);
  if (!pending) {
    throw new Error(
      "Token is unknown, expired, or already consumed. Call update_calendar again to get a fresh token.",
    );
  }

  if (pending.diff.isNoop) {
    return {
      applied: {
        calendar_id: pending.calendarId,
        event_count: pending.calendar.events.length,
        summary: "No changes (diff was a no-op).",
      },
      commit_sha: pending.sha,
      commit_url: "",
      is_noop: true,
    };
  }

  // Rebuild the calendar with resolved events. Cast through unknown:
  // the diff engine emits Event[] (model-layer); CalendarStore.Calendar
  // expects CalendarEvent[]. Same structural shape; the cast keeps the
  // type system honest about the layer crossing.
  const merged: Calendar = {
    ...pending.calendar,
    events: pending.diff.resolved as unknown as Calendar["events"],
  };

  const message = buildCommitMessage(pending);
  const { sha, commitUrl } = await store.saveCalendar(
    merged,
    pending.sha,
    message,
  );

  return {
    applied: {
      calendar_id: pending.calendarId,
      event_count: merged.events.length,
      summary: message,
    },
    commit_sha: sha,
    commit_url: commitUrl,
    is_noop: false,
  };
}

function buildCommitMessage(pending: PendingUpdate): string {
  const counts = { added: 0, removed: 0, updated: 0 };
  for (const entry of pending.diff.entries) {
    if (entry.kind === "added") counts.added++;
    else if (entry.kind === "removed") counts.removed++;
    else if (entry.kind === "updated") counts.updated++;
  }
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.updated) parts.push(`${counts.updated} updated`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  return `Update ${pending.calendarId}: ${parts.join(", ")}`;
}

export const APPLY_CALENDAR_UPDATE_TOOL = {
  name: "apply_calendar_update",
  description:
    "Commit a calendar update previously prepared by update_calendar. Pass the token returned from that call. Tokens are one-shot (a second call with the same token fails) and expire 10 minutes after they're issued.\n\nGuidance:\n- Always show the user the diff summary from update_calendar BEFORE calling this tool. The user might want to abort.\n- If the update_calendar response had is_noop:true, you can skip this call — there's nothing to commit.\n- If the token has expired, call update_calendar again to get a fresh one.",
  inputSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "Token returned by update_calendar.",
      },
    },
    required: ["token"],
    additionalProperties: false,
  },
} as const;
