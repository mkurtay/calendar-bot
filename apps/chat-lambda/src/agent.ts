import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import type { SseWriter } from "./sse.js";

/**
 * Run a manual agent loop against Claude + the @calendar-bot/server
 * MCP server (spawned as a stdio subprocess) and stream events to the
 * provided SSE writer.
 *
 * We use Anthropic's bare Messages API rather than the Agent SDK
 * because the SDK bundles a self-contained Claude Code binary (~208MB)
 * that exceeds Lambda's 50MB direct-upload limit. The loop here is the
 * minimum needed: send a message → if Claude returns tool_use blocks,
 * call the MCP tools and append tool_result blocks → repeat until
 * Claude stops or we hit a turn limit.
 *
 * Mutation tools (apply_/create_/update_/delete_ prefixes) go through
 * canUseTool semantics: emit a `confirm` SSE event and wait for the
 * client to POST /api/chat/confirm/<id>. The confirmation registry is
 * the same per-warm-container Map used before.
 */

const MUTATION_PREFIXES = ["apply_", "create_", "update_", "delete_"];
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
// Defensive bound: stops a runaway tool-use loop. A real conversation
// rarely needs more than 5-10 turns.
const MAX_TURNS = 20;
const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 4096;

// System prompt establishing the bot's identity and the batching rule.
// The batching rule matters because per-event tools (set_result,
// add_event, update_event) each produce their own commit + deploy
// cycle on mkurtay/cal — N changes = N deploys, with GH Actions
// canceling all but the last. update_calendar produces ONE commit
// for an arbitrary number of changes, much friendlier.
const SYSTEM_PROMPT = `You are the calendar bot for cal.kurtays.com.
You help the user manage soccer and Formula 1 calendar JSON via the
@calendar-bot/server MCP tools.

Tool categories:
- Read tools (list_calendars, list_events, fetch_competition_matches,
  fetch_competition_standings, fetch_team_fixtures,
  fetch_competition_scorers) run silently — no confirmation needed.
- Write tools (create_calendar, update_calendar, apply_calendar_update,
  add_event, update_event, remove_event, set_result) prompt the user
  to approve each invocation.

BATCHING RULE (important): when the user asks for MULTIPLE changes to
the SAME calendar in one turn (e.g. "add results for all 4 semifinals",
"reschedule both legs and update the venue"), use the high-level
update_calendar tool instead of multiple per-event calls. update_calendar
takes a full desired event list, computes a single diff, and produces
ONE commit + ONE deploy. Per-event tools each commit separately —
4 set_result calls = 4 commits = 4 deploys, with GitHub Actions
canceling all but the last. That's wasteful and slow for the user.

Use per-event tools (set_result, add_event, update_event, remove_event)
ONLY when the user is changing EXACTLY ONE thing.

When you call update_calendar, ALWAYS show the user the diff summary
from its response BEFORE calling apply_calendar_update — they need to
review what will change.`;
// Roll the per-user conversation history at this many messages. ~15
// user turns assuming each turn writes one user + one assistant
// message (plus any tool_result/tool_use pairs Claude appends). Keeps
// the context window from filling up across a long session.
const HISTORY_LIMIT = 30;

// Per-warm-container conversation history, keyed by Clerk user id.
// Cold starts lose this — acceptable for a small allowlist where the
// warm container stays alive for the typical interactive session.
const chatHistory = new Map<string, Anthropic.Messages.MessageParam[]>();

export interface PendingConfirmations {
  resolve(id: string, approved: boolean): void;
  await(id: string): Promise<boolean>;
}

interface PendingEntry {
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export function makePendingConfirmations(): PendingConfirmations {
  const pending = new Map<string, PendingEntry>();
  function evict(id: string): PendingEntry | undefined {
    const entry = pending.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  }
  return {
    resolve(id, approved) {
      const entry = evict(id);
      entry?.resolve(approved);
    },
    await(id) {
      return new Promise<boolean>((resolveFn) => {
        const timer = setTimeout(() => {
          if (pending.delete(id)) resolveFn(false);
        }, CONFIRMATION_TTL_MS);
        pending.set(id, { resolve: resolveFn, timer });
      });
    },
  };
}

interface RunAgentArgs {
  userId: string;
  userMessage: string;
  sse: SseWriter;
  confirmations: PendingConfirmations;
  ghToken: string;
  anthropicApiKey: string;
  /** Optional — if provided, forwarded to the MCP subprocess so the
   *  football-data fetch_* tools can call football-data.org. */
  footballDataToken?: string | undefined;
}

export async function runAgent({
  userId,
  userMessage,
  sse,
  confirmations,
  ghToken,
  anthropicApiKey,
  footballDataToken,
}: RunAgentArgs): Promise<void> {
  const taskRoot = process.env.LAMBDA_TASK_ROOT || resolve(import.meta.dirname || ".", "..");
  const serverEntry = resolve(taskRoot, "server", "server.js");

  // Spawn the MCP server as a stdio subprocess.
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...(process.env as Record<string, string>),
      GH_TOKEN: ghToken,
      ...(footballDataToken ? { FOOTBALL_DATA_TOKEN: footballDataToken } : {}),
    },
  });
  const mcp = new Client({ name: "cal-chat-lambda", version: "0.1.0" });

  // Hoisted so the `finally` block can persist whatever this turn
  // accumulated (and so it's safe to read even if mcp.connect throws
  // before the messages literal below would have run).
  const messages: Anthropic.Messages.MessageParam[] = [
    ...(chatHistory.get(userId) ?? []),
    { role: "user", content: userMessage },
  ];

  try {
    await mcp.connect(transport);

    // List the MCP server's tools and convert each to Anthropic's
    // Tool shape. MCP `inputSchema` is JSON Schema, which is what
    // Anthropic's input_schema also expects.
    const mcpTools = await mcp.listTools();
    const anthropicTools: Anthropic.Messages.Tool[] = mcpTools.tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      input_schema: t.inputSchema as Anthropic.Messages.Tool["input_schema"],
    }));

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        tools: anthropicTools,
      });

      // Forward text deltas to SSE as they arrive.
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          sse.send({ type: "delta", text: event.delta.text });
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          sse.send({
            type: "tool",
            toolName: event.content_block.name,
            state: "started",
          });
        }
      }

      const finalMessage = await stream.finalMessage();
      messages.push({ role: "assistant", content: finalMessage.content });

      // Collect any tool_use blocks. If there are none, the model is
      // done answering — exit the loop.
      const toolUses = finalMessage.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0 || finalMessage.stop_reason === "end_turn") {
        return;
      }

      // Call each tool. Mutations gate on canUseTool semantics.
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const isMutation = MUTATION_PREFIXES.some((p) => use.name.startsWith(p));
        if (isMutation) {
          const confirmId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          sse.send({ type: "confirm", id: confirmId, toolName: use.name, input: use.input });
          const approved = await confirmations.await(confirmId);
          if (!approved) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: "User declined the tool invocation.",
              is_error: true,
            });
            continue;
          }
        }

        try {
          const result = await mcp.callTool({
            name: use.name,
            arguments: use.input as Record<string, unknown>,
          });
          // Extract text content from MCP result blocks. MCP supports
          // text/image/embedded-resource block types; for tool_result
          // we hand back text only — images would need a separate
          // pipeline.
          const text = Array.isArray(result.content)
            ? result.content
                .filter((c: { type?: string }): c is { type: "text"; text: string } =>
                  c.type === "text" && typeof (c as { text?: unknown }).text === "string",
                )
                .map((c) => c.text)
                .join("\n")
            : "";
          sse.send({
            type: "tool",
            toolName: use.name,
            state: "completed",
            result: text,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: text,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: message,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    sse.send({
      type: "error",
      message: `Hit max turn budget of ${MAX_TURNS} without a final answer.`,
    });
  } finally {
    // Persist the conversation. The trailing `messages` array contains
    // the new user message plus every assistant/tool exchange this
    // turn produced — exactly the right shape for Claude to pick up
    // on next request. Cap to avoid unbounded growth across long
    // sessions; drops the oldest messages but keeps the most recent
    // context. The cap is on whole MessageParam entries, not tokens,
    // which is approximate but cheap to compute.
    const trimmed =
      messages.length > HISTORY_LIMIT ? messages.slice(-HISTORY_LIMIT) : messages;
    chatHistory.set(userId, trimmed);

    await mcp.close().catch(() => {
      // Subprocess teardown is best-effort. The Lambda container will
      // eventually be recycled anyway.
    });
  }
}
