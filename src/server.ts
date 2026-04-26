#!/usr/bin/env node
// MCP server entry point. Phase 1 ships stdio transport only; phase 2
// will add HTTP transport for remote callers (Claude.ai web, Telegram
// bot Lambda) using the same tool definitions and dispatch.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GitHub } from "./github.js";
import { CalendarStore } from "./calendar-store.js";
import * as tools from "./tools.js";
import { ConfigError, loadConfig } from "./config.js";

const TOOL_DEFINITIONS = [
  {
    name: "list_calendars",
    description:
      "List all calendars in the kurtays.com hub. Returns id, display name, category, total event count, and upcoming-event count for each.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_events",
    description:
      "List events in a single calendar, optionally filtered by date range. Use this to see what's currently scheduled before adding/updating.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Calendar id slug, e.g. 'champions-league-2026', 'world-cup-2026', 'formula-1-2026'.",
        },
        from: {
          type: "string",
          description:
            "Optional ISO-8601 UTC lower bound on event.start (e.g. '2026-05-01T00:00:00Z').",
        },
        to: {
          type: "string",
          description:
            "Optional ISO-8601 UTC upper bound on event.end (e.g. '2026-06-01T00:00:00Z').",
        },
      },
      required: ["calendar_id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_event",
    description:
      "Add a new event to a calendar. Produces a real commit on mkurtay/kurtays-calendar; CI then renders & deploys. Generates a UID if not provided. The typed_block parameter carries sport-specific fields like soccer.{home, away, stage, group, leg} or formula1.{round, gp_name, circuit, city, country, session, is_sprint_weekend}.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        title: {
          type: "string",
          description:
            "Display title without the leading emoji (pass emoji separately). E.g. 'Miami GP', 'UCL SF: PSG vs Bayern München (1st Leg)'.",
        },
        start: {
          type: "string",
          description: "ISO-8601 UTC, must end in 'Z'. E.g. '2026-04-28T19:00:00Z'.",
        },
        end: {
          type: "string",
          description: "ISO-8601 UTC, must end in 'Z'.",
        },
        uid: {
          type: "string",
          description:
            "Optional stable identifier (e.g. 'ucl-sf-1-1@cl26'). Auto-generated if omitted.",
        },
        emoji: {
          type: "string",
          description:
            "Optional leading emoji like '⚽', '🏁', '🏆'. The renderer joins this with title in the iCal SUMMARY.",
        },
        location: {
          type: "string",
          description: "Optional 'Venue, City' string, e.g. 'Parc des Princes, Paris'.",
        },
        description_lines: {
          type: "array",
          items: { type: "string" },
          description: "Optional multi-line description (joined with iCal '\\n' escapes).",
        },
        typed_block: {
          type: "object",
          description:
            "Optional sport-specific block. For soccer: { soccer: { home, away, stage, group, leg, match_number } }. For F1: { formula1: { round, gp_name, circuit, city, country, session, is_sprint_weekend } }.",
        },
      },
      required: ["calendar_id", "title", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "update_event",
    description:
      "Update one or more fields of an existing event. The patch object is shallow-merged into the event (top-level fields replaced, nested objects replaced wholesale). Use list_events first to find the UID.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        uid: { type: "string" },
        patch: {
          type: "object",
          description:
            "Fields to update. E.g. { start: '2026-04-29T19:00:00Z', end: '2026-04-29T21:00:00Z' } to reschedule.",
        },
      },
      required: ["calendar_id", "uid", "patch"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_event",
    description: "Remove an event from a calendar.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        uid: { type: "string" },
      },
      required: ["calendar_id", "uid"],
      additionalProperties: false,
    },
  },
  {
    name: "set_result",
    description:
      "Record the result of a completed event and (by default) mark its status as 'completed'. The result object is sport-appropriate: soccer might be { home_score: 2, away_score: 1, notes: '...' }; F1 might be { winner_driver: '...', winner_team: '...', podium: [...] }.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        uid: { type: "string" },
        result: {
          type: "object",
          description: "Sport-appropriate result data. Pass null to clear.",
        },
        mark_completed: {
          type: "boolean",
          description: "If false, leave status alone. Default true.",
        },
      },
      required: ["calendar_id", "uid", "result"],
      additionalProperties: false,
    },
  },
];

function createServer(store: CalendarStore): McpServer {
  const mcp = new McpServer(
    { name: "calendar-bot", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatch(name, args ?? {}, store);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: `Error in ${name}: ${msg}` }],
      };
    }
  });

  return mcp;
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  store: CalendarStore,
): Promise<unknown> {
  switch (name) {
    case "list_calendars":
      return tools.listCalendars(store);
    case "list_events":
      return tools.listEvents(store, args as unknown as tools.ListEventsParams);
    case "add_event":
      return tools.addEvent(store, args as unknown as tools.AddEventParams);
    case "update_event":
      return tools.updateEvent(store, args as unknown as tools.UpdateEventParams);
    case "remove_event":
      return tools.removeEvent(store, args as unknown as tools.RemoveEventParams);
    case "set_result":
      return tools.setResult(store, args as unknown as tools.SetResultParams);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  const config = loadConfig();
  const gh = new GitHub(config.github);
  const store = new CalendarStore(gh);
  const mcp = createServer(store);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error("MCP server crashed:", err);
  }
  process.exit(1);
});
