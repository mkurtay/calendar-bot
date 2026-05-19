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
};

// Module-scope shared confirmations — survives across requests on a
// warm container so the /confirm endpoint can resolve a pending
// canUseTool promise from the original /chat request.
const confirmations = makePendingConfirmations();

export const handler = awslambda.streamifyResponse(
  async (event: APIGatewayProxyEventV2, stream: NodeJS.WritableStream): Promise<void> => {
    const sse = makeSseWriter(stream);
    try {
      const method = event.requestContext.http.method;
      const path = event.requestContext.http.path;
      const authHeader = event.headers["authorization"] || event.headers["Authorization"];

      // Auth gates both endpoints.
      await verifyAuth(authHeader);

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
        await runAgent({
          userMessage,
          sse,
          confirmations,
          ghToken,
          anthropicApiKey,
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
