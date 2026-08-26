import Fastify from "fastify";
import type { InvestigationSnapshot } from "./investigation.js";

type InvestigationService = {
  cancel: (sessionId: string) => Promise<InvestigationSnapshot>;
  create: (pullRequestUrl: string, idempotencyKey?: string) => Promise<{ sessionId: string; turnId: string }>;
  get: (sessionId: string) => Promise<InvestigationSnapshot>;
};

export function buildApp({
  isTrueForgeReady = async () => true,
  investigationService,
}: {
  isTrueForgeReady?: () => Promise<boolean>;
  investigationService?: InvestigationService;
} = {}) {
  const app = Fastify();

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    if (await isTrueForgeReady()) {
      return { status: "ok" };
    }

    return reply.code(503).send({ status: "unavailable" });
  });

  app.post<{ Body: { pullRequestUrl?: string } }>("/api/investigations", async (request, reply) => {
    if (!investigationService || typeof request.body?.pullRequestUrl !== "string" || !request.body.pullRequestUrl.trim()) {
      return reply.code(400).send({ code: "INVALID_REQUEST", message: "pullRequestUrl is required" });
    }

    try {
      const idempotencyKey = request.headers["idempotency-key"];
      const key = Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;
      const result = await investigationService.create(request.body.pullRequestUrl, key);
      return reply.code(202).send({ ...result, status: "QUEUED" });
    } catch {
      return reply.code(422).send({ code: "INVESTIGATION_REJECTED", message: "investigation could not be started" });
    }
  });

  app.get<{ Params: { sessionId: string } }>("/api/investigations/:sessionId", async (request, reply) => {
    if (!investigationService) return reply.code(503).send({ code: "UNAVAILABLE", message: "investigation service unavailable" });
    try {
      return await investigationService.get(request.params.sessionId);
    } catch {
      return reply.code(404).send({ code: "NOT_FOUND", message: "investigation not found" });
    }
  });

  app.post<{ Params: { sessionId: string } }>("/api/investigations/:sessionId/cancel", async (request, reply) => {
    if (!investigationService) return reply.code(503).send({ code: "UNAVAILABLE", message: "investigation service unavailable" });
    try {
      const snapshot = await investigationService.cancel(request.params.sessionId);
      return reply.code(202).send({ sessionId: snapshot.sessionId, status: snapshot.status });
    } catch {
      return reply.code(404).send({ code: "NOT_FOUND", message: "investigation not found" });
    }
  });

  app.get<{ Params: { sessionId: string }; Headers: { "last-event-id"?: string } }>("/api/investigations/:sessionId/events", async (request, reply) => {
    if (!investigationService) return reply.code(503).send({ code: "UNAVAILABLE", message: "investigation service unavailable" });
    const after = Number(request.headers["last-event-id"] ?? 0);
    if (!Number.isInteger(after) || after < 0) return reply.code(400).send({ code: "INVALID_CURSOR", message: "Last-Event-ID must be a non-negative integer" });

    reply.hijack();
    reply.raw.writeHead(200, { "cache-control": "no-cache", connection: "keep-alive", "content-type": "text/event-stream" });
    let cursor = after;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    const pump = async () => {
      try {
        const snapshot = await investigationService.get(request.params.sessionId);
        for (const event of snapshot.events.filter((item) => item.sequence > cursor)) {
          reply.raw.write(`id: ${event.sequence}\nevent: harness\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.sequence;
        }
        if (["READY", "BLOCKED", "UNCERTAIN", "ERROR", "CANCELLED"].includes(snapshot.status)) close();
      } catch {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "STREAM_FAILED", message: "event stream failed" })}\n\n`);
        close();
      }
    };
    const timer = setInterval(() => void pump(), 250);
    request.raw.on("close", close);
    await pump();
  });

  return app;
}
