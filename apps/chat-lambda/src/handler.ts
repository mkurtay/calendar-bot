import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { verifyAuth } from "./clerk.js";
import { makeSseWriter } from "./sse.js";
import { makePendingConfirmations, runAgent } from "./agent.js";

/**
 * Lambda Function URL handler — streaming response. The function URL
 * is wrapped with `awslambda.streamifyResponse` which CloudFront sits
 * in front of via a `/api/*` ordered cache behavior.
 *
 * Endpoints:
 *   POST /api/chat
 *     Body: { message: string }
 *     Auth: Authorization: Bearer <clerk-jwt>
 *     Response: text/event-stream with the SDK message replay
 *
 *   POST /api/chat/confirm/<id>
 *     Body: { approved: boolean }
 *     Auth: same as above
 *     Response: 204 No Content
 *     (Used by the /chat UI to resolve a `canUseTool` confirmation.)
 *
 * Confirmation registry is per-process (per-Lambda-container), which
 * means a single chat session must complete on the SAME container.
 * Lambda's warm-container reuse usually achieves this when the user
 * is actively chatting; cold-start would lose the pending state but
 * the UI can detect that and re-prompt.
 */

// awslambda is a global injected by the Lambda runtime when
// streamifyResponse is used. The type isn't declared by @types/aws-lambda
// yet, so we shim it.
declare const awslambda: {
  streamifyResponse: <T>(
    fn: (event: T, responseStream: NodeJS.WritableStream) => Promise<void>,
  ) => unknown;
  HttpResponseStream: {
    from(
      stream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers?: Record<string, string> },
    ): NodeJS.WritableStream;
  };
};

// Module-scope shared confirmations — survives across requests on a
// warm container so the /confirm endpoint can resolve a pending
// canUseTool promise from the original /chat request.
const confirmations = makePendingConfirmations();

/** Write a one-shot JSON response through the streamify wrapper and end. */
function writeJson(
  stream: NodeJS.WritableStream,
  statusCode: number,
  body: unknown,
): void {
  const rs = awslambda.HttpResponseStream.from(stream, {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
  rs.write(JSON.stringify(body));
  rs.end();
}

/**
 * POST /api/request — public (no auth). Creates a GitHub issue on the
 * calendar repo so anyone can request a calendar. The owner moderates
 * via labels; 👍 reactions are the upvotes. A honeypot field + length
 * caps are the only spam guards — owner moderation (nothing goes
 * "public" until labeled `approved`) is the real filter.
 */
async function handleCalendarRequest(
  event: APIGatewayProxyEventV2,
  stream: NodeJS.WritableStream,
): Promise<void> {
  try {
    const body = JSON.parse(event.body || "{}") as {
      title?: unknown;
      description?: unknown;
      website?: unknown; // honeypot — real users never fill this
    };
    // Honeypot: bots fill hidden fields. Pretend success, create nothing.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      writeJson(stream, 200, { ok: true });
      return;
    }
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    if (!title) {
      writeJson(stream, 400, { error: "Title is required" });
      return;
    }
    if (title.length > 120 || description.length > 2000) {
      writeJson(stream, 400, { error: "Title or description too long" });
      return;
    }
    const ghToken = process.env.GH_TOKEN;
    const owner = process.env.GITHUB_OWNER ?? "mkurtay";
    // Requests go to a DEDICATED PUBLIC repo (not the private calendar
    // repo) so external folks can view/upvote/subscribe to the issues.
    // Override via REQUESTS_REPO if ever renamed.
    const repo = process.env.REQUESTS_REPO ?? "cal-requests";
    if (!ghToken) {
      writeJson(stream, 500, { error: "Server missing credentials" });
      return;
    }
    const issueBody =
      `_Requested via cal.kurtays.com_\n\n` +
      (description || "_(no description provided)_") +
      `\n\n---\n👍 this issue to upvote. Subscribe to get notified if it's added.`;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ghToken}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "cal-kurtays-request-form",
        },
        body: JSON.stringify({
          title: `[Calendar request] ${title}`,
          body: issueBody,
          labels: ["calendar-request"],
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      writeJson(stream, 502, { error: `GitHub: ${res.status} ${text.slice(0, 200)}` });
      return;
    }
    const issue = (await res.json()) as { html_url: string; number: number };
    writeJson(stream, 200, { ok: true, url: issue.html_url, number: issue.number });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    writeJson(stream, 500, { error: message });
  }
}

export const handler = awslambda.streamifyResponse(
  async (event: APIGatewayProxyEventV2, stream: NodeJS.WritableStream): Promise<void> => {
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;

    // Public, non-streaming JSON route — handled before the SSE wrapper
    // since it returns application/json, not text/event-stream.
    if (method === "POST" && path === "/api/request") {
      await handleCalendarRequest(event, stream);
      return;
    }

    // Wrap the raw response stream so the Lambda runtime prepends
    // HTTP metadata (status + SSE headers) to the response. Without
    // this, browsers see the body as application/octet-stream and
    // the EventSource parser refuses to fire.
    const responseStream = awslambda.HttpResponseStream.from(stream, {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
    const sse = makeSseWriter(responseStream);
    try {
      const authHeader = event.headers["authorization"] || event.headers["Authorization"];

      // Auth gates both endpoints. userId is used as a key for the
      // per-session conversation history in runAgent.
      const verified = await verifyAuth(authHeader);

      // Routing
      const confirmMatch = path.match(/^\/api\/chat\/confirm\/(.+)$/);
      if (method === "POST" && confirmMatch) {
        const id = confirmMatch[1];
        if (!id) {
          sse.send({ type: "error", message: "Missing confirmation id" });
          sse.close();
          return;
        }
        const body = JSON.parse(event.body || "{}");
        const approved = !!body.approved;
        confirmations.resolve(id, approved);
        // 204 — for a fetch() the client doesn't read the body.
        // streamifyResponse doesn't expose statusCode directly; emit
        // a single SSE event so the client knows it worked.
        sse.send({ type: "delta", text: "" }); // no-op to flush
        sse.close();
        return;
      }

      if (method === "POST" && path === "/api/chat") {
        const body = JSON.parse(event.body || "{}");
        const userMessage = String(body.message || "").trim();
        if (!userMessage) {
          sse.send({ type: "error", message: "Empty message" });
          sse.close();
          return;
        }
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const ghToken = process.env.GH_TOKEN;
        if (!anthropicApiKey || !ghToken) {
          sse.send({ type: "error", message: "Server missing API credentials" });
          sse.close();
          return;
        }
        // football-data is optional — the four fetch_* tools throw a
        // clear "FOOTBALL_DATA_TOKEN not set" error if called without
        // it, which the agent will surface as a tool-result. So we
        // don't block startup on its absence.
        const footballDataToken = process.env.FOOTBALL_DATA_TOKEN;
        await runAgent({
          userId: verified.userId,
          userMessage,
          sse,
          confirmations,
          ghToken,
          anthropicApiKey,
          footballDataToken,
        });
        sse.close();
        return;
      }

      sse.send({ type: "error", message: `No route for ${method} ${path}` });
      sse.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      sse.send({ type: "error", message });
      sse.close();
    }
  },
);
