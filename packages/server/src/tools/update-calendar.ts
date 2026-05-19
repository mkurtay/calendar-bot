// MCP tool: update_calendar. Computes a diff between the current
// calendar's events and a desired event list, applies the merge
// policy, and stashes the result under a one-shot token. Pair with
// apply_calendar_update to actually commit. The review-then-commit
// flow per Q1.

import type { Calendar, CalendarStore } from "../calendar-store.js";
import { diff, summarizeDiff } from "../diff/compute.js";
import type { CalendarDiff } from "../diff/types.js";
import { isKnownCategory, getCategoryModel } from "../models/registry.js";
import type { Event } from "../models/types.js";
import { updateTokens } from "./update-context.js";

interface Team {
  id: string;
  name: string;
}

export interface TeamsDiff {
  added: Team[];
  removed: Team[];
  renamed: Array<{ id: string; before: string; after: string }>;
}

export interface UpdateCalendarParams {
  id: string;
  events: unknown[];
  // Soccer-only: full desired team registry. When provided, the diff
  // engine surfaces additions, removals, and rename changes alongside
  // the event diff. type changes are NOT accepted — calendar type is
  // a one-shot at creation.
  teams?: Team[];
}

export interface UpdateCalendarResult {
  token: string;
  calendar_id: string;
  summary: string;
  is_noop: boolean;
  diff: CalendarDiff;
  expires_in_ms: number;
  // Present only when params.teams was provided.
  teams_diff?: TeamsDiff;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;

function computeTeamsDiff(current: Team[], incoming: Team[]): TeamsDiff {
  const currentById = new Map(current.map((t) => [t.id, t]));
  const incomingById = new Map(incoming.map((t) => [t.id, t]));

  const added: Team[] = [];
  const removed: Team[] = [];
  const renamed: Array<{ id: string; before: string; after: string }> = [];

  for (const inc of incoming) {
    const cur = currentById.get(inc.id);
    if (!cur) {
      added.push(inc);
    } else if (cur.name !== inc.name) {
      renamed.push({ id: inc.id, before: cur.name, after: inc.name });
    }
  }
  for (const cur of current) {
    if (!incomingById.has(cur.id)) {
      removed.push(cur);
    }
  }

  return { added, removed, renamed };
}

function teamsDiffSummary(d: TeamsDiff): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`${d.added.length} team(s) added`);
  if (d.renamed.length) parts.push(`${d.renamed.length} team(s) renamed`);
  if (d.removed.length) parts.push(`${d.removed.length} team(s) removed`);
  return parts.join(", ");
}

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
  if (params.teams !== undefined && !Array.isArray(params.teams)) {
    throw new Error("teams must be an array when provided");
  }

  const { calendar, sha } = await store.getCalendar(params.id);

  if (!isKnownCategory(calendar.category)) {
    throw new Error(
      `Calendar ${params.id} has unknown category "${calendar.category}"; cannot validate updates against an unknown model.`,
    );
  }
  const model = getCategoryModel(calendar.category);

  // Build the snapshot to validate (and later to commit). For soccer
  // we want the calendar-level validator to see incoming teams +
  // events together so home_id/away_id refs resolve correctly.
  const snapshot: Calendar = { ...calendar };
  if (params.teams !== undefined) {
    (snapshot as Record<string, unknown>).teams = params.teams;
  }
  snapshot.events = params.events as unknown as Calendar["events"];

  // Validate. Prefer calendar-level validator when available; this
  // covers cross-rules (type→stage, team-id refs). Fall back to
  // per-event for categories without one.
  if (model.validateCalendar) {
    const result = model.validateCalendar(snapshot);
    if (!result.ok) {
      throw new Error(
        `Invalid calendar for category "${calendar.category}":\n${result.errors.join("\n")}`,
      );
    }
  } else {
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
  }

  // Event diff via the engine.
  const current = calendar.events as unknown as Event[];
  const incoming = params.events as Event[];
  const computed = diff(current, incoming);

  // Teams diff (soccer-only, opt-in via params.teams).
  let teamsDiff: TeamsDiff | undefined;
  let teamsChanged = false;
  if (params.teams !== undefined) {
    const currentTeams =
      ((calendar as Record<string, unknown>)["teams"] as
        | Team[]
        | undefined) ?? [];
    teamsDiff = computeTeamsDiff(currentTeams, params.teams);
    teamsChanged =
      teamsDiff.added.length > 0 ||
      teamsDiff.removed.length > 0 ||
      teamsDiff.renamed.length > 0;
  }

  // Stash the pre-merge calendar (with new teams baked in if provided)
  // so apply_calendar_update writes both the new teams and the diff
  // resolved events in a single commit.
  const calendarForApply: Calendar = { ...calendar };
  if (params.teams !== undefined) {
    (calendarForApply as Record<string, unknown>).teams = params.teams;
  }

  const token = updateTokens.put({
    calendarId: params.id,
    diff: computed,
    calendar: calendarForApply,
    sha,
  });

  // Compose summary text. Events first, then teams suffix when relevant.
  let summary = summarizeDiff(computed);
  const isNoop = computed.isNoop && !teamsChanged;
  if (teamsDiff && teamsChanged) {
    const ts = teamsDiffSummary(teamsDiff);
    summary = computed.isNoop
      ? `Events unchanged. ${ts}.`
      : `${summary} ${ts}.`;
  }

  return {
    token,
    calendar_id: params.id,
    summary,
    is_noop: isNoop,
    diff: computed,
    expires_in_ms: TOKEN_TTL_MS,
    ...(teamsDiff ? { teams_diff: teamsDiff } : {}),
  };
}

export const UPDATE_CALENDAR_TOOL = {
  name: "update_calendar",
  description:
    "Compute a diff between a calendar's current events and a new desired event list, returning a token + summary for review. Does NOT commit — call apply_calendar_update with the token to commit.\n\nMerge policy (auto-applied):\n- Source (your events list) wins on schedule fields: start, end, location, title, teams.\n- Local result is preserved if set; source result fills only when local is null.\n- Events with local_only:true in the current calendar are kept regardless of source presence.\n- Events in current but missing from your list are detected as removals.\n\nGuidance:\n- The events array is the FULL desired event list, not a delta. Include every event you want to keep.\n- You don't need to include local_only events — they're sticky.\n- You don't need to include preserved-result fields — local results are kept automatically.\n- For soccer calendars with a team registry, optionally pass teams: [{ id, name }, ...]. The diff response then includes a teams_diff with adds/removes/renames; calendar-level type is one-shot at creation and not accepted here.\n- Token expires after 10 minutes; call apply_calendar_update before then.\n- If is_noop is true, no commit is needed (apply_calendar_update would be a no-op).",
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
      teams: {
        type: "array",
        description:
          "Soccer-only. Full desired team registry. Diff engine surfaces adds/removes/renames in the response.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
          },
          required: ["id", "name"],
          additionalProperties: false,
        },
      },
    },
    required: ["id", "events"],
    additionalProperties: false,
  },
} as const;
