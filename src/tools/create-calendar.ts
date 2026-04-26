// MCP tool: create_calendar. Scaffolds a new calendar at data/<id>.json
// with category-validated events. The high-level entry point envisioned
// in phase-1-architecture.md — replaces the per-event add_event flow
// for whole-calendar creation.

import type { Calendar, CalendarStore } from "../calendar-store.js";
import {
  getCategoryModel,
  isKnownCategory,
  slugify,
  type Category,
} from "../models/registry.js";

export interface CreateCalendarParams {
  name: string;
  category: string;
  id?: string;
  html_file?: string;
  presentation?: {
    subtitle?: string;
    badge_label?: string;
    accent_color?: string;
    icon?: string;
  };
  events: unknown[];
}

export interface CreateCalendarResult {
  created: {
    id: string;
    name: string;
    category: Category;
    path: string;
    event_count: number;
  };
  commit_sha: string;
  commit_url: string;
}

const DEFAULT_ICS = {
  prodid: "-//kurtays.com//EN",
  calscale: "GREGORIAN",
  method: "PUBLISH",
};

export async function createCalendar(
  store: CalendarStore,
  params: CreateCalendarParams,
): Promise<CreateCalendarResult> {
  if (!isKnownCategory(params.category)) {
    throw new Error(
      `Unknown category "${params.category}". Must be one of: soccer, formula1.`,
    );
  }
  const category = params.category;
  const model = getCategoryModel(category);

  if (typeof params.name !== "string" || params.name.trim().length === 0) {
    throw new Error("name must be a non-empty string");
  }
  if (!Array.isArray(params.events)) {
    throw new Error("events must be an array");
  }

  const id = (params.id ?? slugify(params.name)).trim();
  if (id.length === 0) {
    throw new Error(
      `Could not derive a valid id from name "${params.name}". Pass an explicit id.`,
    );
  }

  // Validate every event up front so the user sees one consolidated error.
  const eventErrors: string[] = [];
  for (let i = 0; i < params.events.length; i++) {
    const result = model.validate(params.events[i]);
    if (!result.ok) {
      eventErrors.push(`event[${i}]: ${result.errors.join("; ")}`);
    }
  }
  if (eventErrors.length > 0) {
    throw new Error(
      `Invalid events for category "${category}":\n${eventErrors.join("\n")}`,
    );
  }

  // Build the calendar shape the store expects. Default ics fields and
  // ensure each event has the legacy-required status/result so the
  // shape round-trips through saveCalendar/getCalendar later.
  const html_file = params.html_file ?? `${id}.html`;
  const calendar: Calendar = {
    id,
    name: params.name,
    category,
    html_file,
    ics: { ...DEFAULT_ICS },
    events: (params.events as Array<Record<string, unknown>>).map((e) => ({
      uid: String(e.uid),
      title: String(e.title),
      start: String(e.start),
      end: String(e.end),
      status:
        (e.status as "scheduled" | "completed" | "cancelled" | undefined) ??
        "scheduled",
      result: (e.result as unknown) ?? null,
      ...(e.location ? { location: String(e.location) } : {}),
      ...(e.emoji ? { emoji: String(e.emoji) } : {}),
      ...(e.description_lines
        ? { description_lines: e.description_lines as string[] }
        : {}),
      ...(category === "soccer" && e.soccer ? { soccer: e.soccer } : {}),
      ...(category === "formula1" && e.formula1
        ? { formula1: e.formula1 }
        : {}),
      ...(e.local_only ? { local_only: true } : {}),
    })),
  };

  if (params.presentation) {
    (calendar as Record<string, unknown>).presentation = params.presentation;
  }

  const { commitUrl, sha, path } = await store.create(
    calendar,
    `Create calendar: ${params.name}`,
  );

  return {
    created: {
      id,
      name: params.name,
      category,
      path,
      event_count: calendar.events.length,
    },
    commit_sha: sha,
    commit_url: commitUrl,
  };
}

// Tool definition for MCP registration. Co-located with the handler
// so adding/removing categories or tweaking guidance touches one file.
export const CREATE_CALENDAR_TOOL = {
  name: "create_calendar",
  description:
    "Create a new calendar in the kurtays.com hub. Scaffolds the JSON file at data/<id>.json with the given metadata and initial events. The whole-calendar high-level alternative to add_event for setting up a new competition or season.\n\nGuidance:\n- category must be exactly 'soccer' or 'formula1' (lowercase). Examples: 'UEFA Champions League 2025-26' → 'soccer', 'Formula 1 2026' → 'formula1'.\n- id is optional; if omitted, it's auto-derived from name via slugify (e.g. 'Champions League 2026' → 'champions-league-2026').\n- html_file defaults to '<id>.html' if omitted.\n- For soccer events, each event needs a `soccer` typed_block: { home, away, stage, group?, leg?, match_number? }. Stage is one of: Group, LeaguePhase, R32, R16, Quarterfinal, Semifinal, ThirdPlace, Final. home/away may be null for pre-draw fixtures (TBD slots).\n- For formula1 events, each needs a `formula1` typed_block: { round, gp_name, session, circuit?, city?, country?, is_sprint_weekend? }.\n- Fails if a calendar with the same id already exists.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Human-readable calendar name, e.g. 'UEFA Champions League 2025-26'.",
      },
      category: {
        type: "string",
        enum: ["soccer", "formula1"],
        description: "Calendar category. Determines event validation rules.",
      },
      id: {
        type: "string",
        description:
          "Optional kebab-case slug. Auto-derived from name via slugify if omitted.",
      },
      html_file: {
        type: "string",
        description: "Optional HTML page filename. Defaults to '<id>.html'.",
      },
      presentation: {
        type: "object",
        description: "Editorial card metadata for the index page.",
        properties: {
          subtitle: { type: "string" },
          badge_label: {
            type: "string",
            description:
              "Short category label, e.g. 'Football' or 'Motorsport'.",
          },
          accent_color: {
            type: "string",
            description: "CSS color, e.g. '#1a73e8'.",
          },
          icon: { type: "string" },
        },
        additionalProperties: false,
      },
      events: {
        type: "array",
        description:
          "Initial events, validated per category. May be empty for an empty-shell calendar.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["name", "category", "events"],
    additionalProperties: false,
  },
} as const;
