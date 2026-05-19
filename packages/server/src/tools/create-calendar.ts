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
  // Soccer-only competition-format discriminator.
  type?: "league" | "cup_groups" | "cup_swiss";
  // Soccer-only team registry. Each event's home_id/away_id (if set)
  // must reference an entry here.
  teams?: { id: string; name: string }[];
  events: unknown[];
}

export interface CreateCalendarResult {
  created: {
    id: string;
    name: string;
    category: Category;
    path: string;
    event_count: number;
    type?: string;
    team_count?: number;
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

  // Soccer-only fields. type and teams are silently ignored on
  // non-soccer categories (the runtime validator wouldn't accept
  // them anyway and we want to keep the LLM's input forgiving).
  if (category === "soccer") {
    if (params.type !== undefined) {
      (calendar as Record<string, unknown>).type = params.type;
    }
    if (params.teams !== undefined) {
      (calendar as Record<string, unknown>).teams = params.teams;
    }
  }

  // Validate. Prefer the calendar-level validator (covers cross-rules
  // like type→stage compatibility, team-id refs); fall back to
  // per-event for categories that don't define one.
  if (model.validateCalendar) {
    const result = model.validateCalendar(calendar);
    if (!result.ok) {
      throw new Error(
        `Invalid calendar for category "${category}":\n${result.errors.join("\n")}`,
      );
    }
  } else {
    const eventErrors: string[] = [];
    for (let i = 0; i < calendar.events.length; i++) {
      const result = model.validate(calendar.events[i]);
      if (!result.ok) {
        eventErrors.push(`event[${i}]: ${result.errors.join("; ")}`);
      }
    }
    if (eventErrors.length > 0) {
      throw new Error(
        `Invalid events for category "${category}":\n${eventErrors.join("\n")}`,
      );
    }
  }

  const { commitUrl, sha, path } = await store.create(
    calendar,
    `Create calendar: ${params.name}`,
  );

  const cal = calendar as Record<string, unknown>;
  return {
    created: {
      id,
      name: params.name,
      category,
      path,
      event_count: calendar.events.length,
      ...(typeof cal["type"] === "string" ? { type: cal["type"] } : {}),
      ...(Array.isArray(cal["teams"])
        ? { team_count: (cal["teams"] as unknown[]).length }
        : {}),
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
    "Create a new calendar in the kurtays.com hub. Scaffolds the JSON file at data/<id>.json with the given metadata and initial events. The whole-calendar high-level alternative to add_event for setting up a new competition or season.\n\nGuidance:\n- category must be exactly 'soccer' or 'formula1' (lowercase). Examples: 'UEFA Champions League 2025-26' → 'soccer', 'Formula 1 2026' → 'formula1'.\n- id is optional; if omitted, it's auto-derived from name via slugify (e.g. 'Champions League 2026' → 'champions-league-2026').\n- html_file defaults to '<id>.html' if omitted.\n- Soccer-only fields:\n  - type: \"league\" (Premier League, Süper Lig), \"cup_groups\" (World Cup), or \"cup_swiss\" (UCL 2024-25+). Determines renderer layout. Optional but recommended for new soccer calendars.\n  - teams: array of { id, name }. id is a stable lowercase slug (e.g. \"barcelona\", \"man-city\"). Each event's soccer.home_id / away_id (if set) must reference a team in this array.\n- For soccer events, each needs a `soccer` typed_block: { home, away, stage, group?, leg?, match_number?, matchday?, home_id?, away_id? }. Stage is one of: Group (cup_groups), LeaguePhase (cup_swiss), LeaguePlay (league), R32, R16, Quarterfinal, Semifinal, ThirdPlace, Final. home/away may be null for pre-draw fixtures (TBD slots). matchday is the round number (within-group for cup_groups, season-wide for league/cup_swiss).\n- For formula1 events, each needs a `formula1` typed_block: { round, gp_name, session, circuit?, city?, country?, is_sprint_weekend? }.\n- Fails if a calendar with the same id already exists.\n\nExample (soccer league with teams):\n{\n  name: \"Premier League 2025-26\",\n  category: \"soccer\",\n  type: \"league\",\n  teams: [{ id: \"man-city\", name: \"Manchester City\" }, { id: \"liverpool\", name: \"Liverpool\" }],\n  events: [\n    {\n      uid: \"epl-2526-mw1-mci-liv\",\n      title: \"Man City vs Liverpool\",\n      start: \"2025-08-16T14:00:00Z\",\n      end: \"2025-08-16T16:00:00Z\",\n      soccer: { home: \"Manchester City\", away: \"Liverpool\", home_id: \"man-city\", away_id: \"liverpool\", stage: \"LeaguePlay\", matchday: 1 }\n    }\n  ]\n}",
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
      type: {
        type: "string",
        enum: ["league", "cup_groups", "cup_swiss"],
        description:
          "Soccer-only competition-format discriminator. Drives renderer layout.",
      },
      teams: {
        type: "array",
        description:
          "Soccer-only team registry. ids must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ and be unique within the calendar.",
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
