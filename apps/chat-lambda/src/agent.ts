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

// Confirmation TTL is kept for the unused /api/chat/confirm/<id>
// endpoint compat. Live mutations now use text-based "reply 'apply'"
// confirmation in chat instead — see the system prompt.
const CONFIRMATION_TTL_MS = 90 * 1000;
// Defensive bound: stops a runaway tool-use loop. A real conversation
// rarely needs more than 5-10 turns.
const MAX_TURNS = 20;
// Haiku 4.5 — 3-5x faster than Sonnet on tool-heavy agent loops, well
// within capability for fetch-then-propose-update_calendar workflows.
// Flip back to "claude-sonnet-4-5" if multi-step planning ever feels
// shallow; Opus 4.7 is also an option if the budget allows.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;

// System prompt establishing the bot's identity and the batching rule.
// The batching rule matters because per-event tools (set_result,
// add_event, update_event) each produce their own commit + deploy
// cycle on mkurtay/cal — N changes = N deploys, with GH Actions
// canceling all but the last. update_calendar produces ONE commit
// for an arbitrary number of changes, much friendlier.
const SYSTEM_PROMPT = `You are the calendar bot for cal.kurtays.com.
You manage soccer and Formula 1 calendar JSON via @calendar-bot/server
MCP tools.

# Tools

Read (run silently, no confirmation):
- list_calendars, list_events
- fetch_competition_matches, fetch_competition_standings
- fetch_team_fixtures, fetch_competition_scorers
- update_calendar (returns a DIFF + token, does NOT commit)

Write (each commits a file to GitHub):
- create_calendar, apply_calendar_update
- add_event, update_event, remove_event, set_result

# HARD RULES — follow these literally

1. BATCHING. If the user wants MULTIPLE changes to ONE calendar in one
   turn (e.g. "add 4 SF results", "fix both legs"), call update_calendar
   ONCE with the full new event list. NEVER chain multiple set_result /
   add_event / update_event calls — each is its own commit and N
   commits = N deploys with GH Actions canceling all but the last.
   Per-event tools ONLY when the user is changing EXACTLY ONE thing.

2. NARRATE BEFORE WRITE. Before calling ANY write tool, write a plain-
   English text message that:
   (a) describes what changes you're about to make (event by event,
       briefly),
   (b) ends with this EXACT literal sentence on its own line:
       Reply 'apply' to commit, or 'cancel' to discard.
       The frontend looks for this exact phrasing and renders clickable
       Apply / Cancel buttons. If you change the wording, the buttons
       won't appear and the user has to type the word manually.
   STOP and wait for the user's next message. Do NOT call the write
   tool in the same turn — the user needs a chance to review and say
   "apply" first.

3. APPLY WHEN INSTRUCTED. When the user replies with "apply", "yes",
   "go", "do it", "commit", or anything affirmative, call the write
   tool you previously described. Do NOT re-narrate; just call it.
   When the user replies "cancel", "no", "stop", "discard", or
   anything negative, do NOT call the tool. Ask what to do next.

4. update_calendar PATTERN. update_calendar is special: it returns a
   diff summary + a token. The flow is:
   - call update_calendar with the desired event list
   - render the diff summary it returned in plain text
   - end with "Reply 'apply' to commit, or describe what to change."
   - on user "apply", call apply_calendar_update with the token
   This is ALWAYS two turns minimum, never one.

5. POST-COMMIT MESSAGE. After ANY write tool succeeds, your response
   MUST end with: "Committed — should appear on cal.kurtays.com in
   about 2 minutes." This is non-negotiable; users have seen "silent
   success" before and lost trust.

6. ALWAYS RESPOND. Never finish a turn with empty text. If you've
   called a tool, narrate what you did and what you'll do next. Empty
   responses break the chat UI.`;
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
  /** Kept for handler signature compat; unused since the confirm-popup
   *  flow was removed in favor of text-based confirmation. */
  confirmations?: PendingConfirmations | undefined;
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

      // Call each tool. Previously mutation tools sent a `confirm` SSE
      // event and awaited an approve POST on /api/chat/confirm/<id>,
      // but module-scope state on Lambda doesn't survive cross-container
      // routing: the chat-stream request and the confirm POST can land
      // on different warm containers, so the resolver Map miss → TTL
      // timeout → auto-decline. Replaced with text-based confirmation
      // (bot asks the user in plain chat before calling apply_*).
      // Confirmations type/Map stays in this file for the unused
      // /api/chat/confirm/:id endpoint compat.
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
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
