/**
 * Server-Sent Events writer for Lambda's response stream.
 *
 * The Function URL stream API (`responseStream`) is a writable stream;
 * this wraps it with event-typed `write` helpers and ensures each
 * frame is properly delimited per the SSE spec.
 *
 * Event types we emit:
 *   - `delta`  — incremental text from the model
 *   - `tool`   — tool invocation started or completed
 *   - `confirm` — tool requires user confirmation (canUseTool gate)
 *   - `error`  — non-fatal stream error
 *   - `done`   — stream is closing normally
 *
 * Keep-alives:
 *   Browsers (notably Safari) abort SSE streams that go idle for too
 *   long after headers arrive. Same for CloudFront's origin-read
 *   timeout. We write a `:` comment frame every KEEPALIVE_INTERVAL_MS
 *   to keep the wire warm during agent "thinking" gaps (Anthropic
 *   stream init, MCP tool calls, etc.). Per the SSE spec, lines
 *   starting with `:` are comments and clients drop them silently.
 */

const KEEPALIVE_INTERVAL_MS = 10_000;

export type SseEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; toolName: string; state: "started" | "completed"; result?: unknown }
  | { type: "confirm"; id: string; toolName: string; input: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

export interface SseWriter {
  send(event: SseEvent): void;
  close(): void;
}

export function makeSseWriter(stream: NodeJS.WritableStream): SseWriter {
  let closed = false;
  // Send an initial comment immediately so the client sees bytes
  // before any real event is emitted — defeats some browsers' "first
  // byte" idle timer that fires before headers are even parsed.
  try {
    stream.write(": stream-open\n\n");
  } catch {
    /* stream gone already */
  }

  const keepalive = setInterval(() => {
    if (closed) return;
    try {
      stream.write(": keep-alive\n\n");
    } catch {
      /* stream gone — close() will clean up the interval */
    }
  }, KEEPALIVE_INTERVAL_MS);

  function frame(event: SseEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  return {
    send(event: SseEvent): void {
      if (closed) return;
      stream.write(frame(event));
    },
    close(): void {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      try {
        stream.write(frame({ type: "done" }));
        stream.end();
      } catch {
        /* stream already torn down */
      }
    },
  };
}
