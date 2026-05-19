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
 */

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

  function frame(event: SseEvent): string {
    // SSE: "event: <type>\ndata: <json>\n\n"
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
      try {
        stream.write(frame({ type: "done" }));
        stream.end();
      } catch {
        /* stream already torn down */
      }
    },
  };
}
