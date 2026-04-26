// MCP tool: update_calendar. Computes a diff between the current
// calendar's events and a desired event list, applies the merge
// policy, and stashes the result under a one-shot token. Pair with
// apply_calendar_update to actually commit. The review-then-commit
// flow per Q1.

import type { CalendarStore } from "../calendar-store.js";
import { diff, summarizeDiff } from "../diff/compute.js";
import type { CalendarDiff } from "../diff/types.js";
import { isKnownCategory, getCategoryModel } from "../models/registry.js";
import type { Event } from "../models/types.js";
import { updateTokens } from "./update-context.js";

export interface UpdateCalendarParams {
  id: string;
  events: unknown[];
}

export interface UpdateCalendarResult {
  token: string;
  calendar_id: string;
  summary: string;
  is_noop: boolean;
  diff: CalendarDiff;
  expires_in_ms: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;

export async function updateCalendar(
  store: CalendarStore,
  params: UpdateCalendarParams,
): Promise<UpdateCalendarResult> {
  if (typeof params.id !== "string" || params.id.length === 0) {
    throw new Error("id must be a non-empty string");
  }
  if (!Array.isArray(params.events)) {
    throw new Error("events must be an array");
  }

  const { calendar, sha } = await store.getCalendar(params.id);

  if (!isKnownCategory(calendar.category)) {
    throw new Error(
      `Calendar ${params.id} has unknown category "${calendar.category}"; cannot validate updates against an unknown model.`,
    );
  }
  const model = getCategoryModel(calendar.category);

  const errors: string[] = [];
  for (let i = 0; i < params.events.length; i++) {
    const result = model.validate(params.events[i]);
    if (!result.ok) {
      errors.push(`event[${i}]: ${result.errors.join("; ")}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid events for category "${calendar.category}":\n${errors.join("\n")}`,
    );
  }

  // The diff engine works on Event[] (the model-layer type). The
  // calendar's CalendarEvent[] is structurally compatible — same
  // fields plus optional extras — so we pass through as Event[].
  const current = calendar.events as unknown as Event[];
  const incoming = params.events as Event[];
  const computed = diff(current, incoming);

  const token = updateTokens.put({
    calendarId: params.id,
    diff: computed,
    calendar,
    sha,
  });

  return {
    token,
    calendar_id: params.id,
    summary: summarizeDiff(computed),
    is_noop: computed.isNoop,
    diff: computed,
    expires_in_ms: TOKEN_TTL_MS,
  };
}

export const UPDATE_CALENDAR_TOOL = {
  name: "update_calendar",
  description:
    "Compute a diff between a calendar's current events and a new desired event list, returning a token + summary for review. Does NOT commit — call apply_calendar_update with the token to commit.\n\nMerge policy (auto-applied):\n- Source (your events list) wins on schedule fields: start, end, location, title, teams.\n- Local result is preserved if set; source result fills only when local is null.\n- Events with local_only:true in the current calendar are kept regardless of source presence.\n- Events in current but missing from your list are detected as removals.\n\nGuidance:\n- The events array is the FULL desired event list, not a delta. Include every event you want to keep.\n- You don't need to include local_only events — they're sticky.\n- You don't need to include preserved-result fields — local results are kept automatically.\n- Token expires after 10 minutes; call apply_calendar_update before then.\n- If is_noop is true, no commit is needed (apply_calendar_update would be a no-op).",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Calendar id, e.g. 'champions-league-2026'.",
      },
      events: {
        type: "array",
        description:
          "Full desired event list. Validated against the calendar's category model.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["id", "events"],
    additionalProperties: false,
  },
} as const;
