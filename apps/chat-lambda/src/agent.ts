import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import type { SseWriter } from "./sse.js";

/**
 * Run an Agent SDK `query()` loop against the @calendar-bot/server MCP
 * server (spawned as a stdio subprocess) and stream events to the
 * provided SSE writer.
 *
 * The MCP server lives in `dist/server/` (staged there by the
 * chat-lambda's esbuild config). At runtime we point the Agent SDK at
 * `node dist/server/server.js` for stdio transport.
 *
 * Tool gating: any tool whose name starts with a mutation prefix
 * (e.g. `apply_`, `create_`, `update_`) goes through `canUseTool`,
 * which sends a `confirm` SSE event to the client and waits for the
 * user to POST `/api/chat/confirm/<id>` with approve/deny. The
 * confirmation registry lives in the handler's per-request context.
 */

const MUTATION_PREFIXES = ["apply_", "create_", "update_", "delete_"];

// How long a pending tool-confirmation lives before it's auto-declined
// and evicted from the in-memory Map. Bounds the worst case where a
// client opens the SSE stream, gets a confirm event, then disconnects
// without responding — without a TTL the resolver + its Promise stay
// pinned for the warm container's lifetime.
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface PendingConfirmations {
  /** Resolves a pending confirmation by id (called by the handler when
   *  the client POSTs to /api/chat/confirm/:id). */
  resolve(id: string, approved: boolean): void;
  /** Returns a Promise that the Agent SDK awaits before invoking the
   *  tool. Registers a pending entry the handler can resolve. */
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
          // TTL fired before the client confirmed — auto-decline so
          // the Agent SDK gets a definitive answer and the Map stays
          // bounded on long-lived warm containers.
          if (pending.delete(id)) resolveFn(false);
        }, CONFIRMATION_TTL_MS);
        pending.set(id, { resolve: resolveFn, timer });
      });
    },
  };
}

interface RunAgentArgs {
  userMessage: string;
  sse: SseWriter;
  confirmations: PendingConfirmations;
  ghToken: string;
  anthropicApiKey: string;
}

export async function runAgent({
  userMessage,
  sse,
  confirmations,
  ghToken,
  anthropicApiKey,
}: RunAgentArgs): Promise<void> {
  // Resolve the bundled MCP server entry point. Lambda's task root is
  // /var/task; our esbuild config stages the server at dist/server/.
  const taskRoot = process.env.LAMBDA_TASK_ROOT || resolve(import.meta.dirname || ".", "..");
  const serverEntry = resolve(taskRoot, "server", "src", "server.js");

  const iter = query({
    prompt: userMessage,
    options: {
      // Spawn the MCP server as a stdio subprocess. The Agent SDK's
      // tool-call routing automatically discovers tools from this server.
      mcpServers: {
        "calendar-bot": {
          type: "stdio",
          command: "node",
          args: [serverEntry],
          env: {
            GH_TOKEN: ghToken,
          },
        },
      },
      env: { ANTHROPIC_API_KEY: anthropicApiKey },
      // Tool-call gate: mutation tools must be approved by the user.
      canUseTool: async (toolName, input) => {
        const isMutation = MUTATION_PREFIXES.some((p) => toolName.startsWith(p));
        if (!isMutation) {
          return { behavior: "allow", updatedInput: input };
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sse.send({ type: "confirm", id, toolName, input });
        const approved = await confirmations.await(id);
        return approved
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "User declined the tool invocation" };
      },
    },
  });

  for await (const msg of iter) {
    forwardSdkMessage(msg, sse);
  }
}

function forwardSdkMessage(msg: SDKMessage, sse: SseWriter): void {
  // SDK messages come in a few shapes — we narrow + forward the ones
  // we care about. Tool calls + tool results are nested inside
  // assistant/user message content blocks, not top-level SDKMessage
  // variants. Anything else is dropped silently.
  if (typeof msg !== "object" || msg === null || !("type" in msg)) return;

  // Assistant: text deltas + tool_use blocks.
  if (msg.type === "assistant" && "message" in msg) {
    const message = msg.message as unknown as { content?: Array<Record<string, unknown>> };
    for (const block of message.content || []) {
      if (block.type === "text" && typeof block.text === "string") {
        sse.send({ type: "delta", text: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        sse.send({ type: "tool", toolName: block.name, state: "started" });
      }
    }
    return;
  }

  // User: tool_result echoes (the SDK loops tool outputs back through
  // the assistant as user-role messages).
  if (msg.type === "user" && "message" in msg) {
    const message = msg.message as unknown as { content?: Array<Record<string, unknown>> };
    for (const block of message.content || []) {
      if (block.type === "tool_result") {
        const name = typeof block.tool_name === "string" ? block.tool_name : "?";
        sse.send({
          type: "tool",
          toolName: name,
          state: "completed",
          result: block.content,
        });
      }
    }
    return;
  }
}
