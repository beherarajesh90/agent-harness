import Fastify, { type FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IdempotencyConflictError, InvestigationNotFoundError } from "./investigation.js";
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

  app.get("/", async (_request, reply) => {
    try {
      const path = resolve(process.cwd(), "apps/forgegate/public/index.html");
      const fallback = resolve(process.cwd(), "public/index.html");
      return reply.type("text/html").send(await readFile(path, "utf8").catch(() => readFile(fallback, "utf8")));
    } catch {
      return reply.code(404).send({ code: "UI_NOT_BUILT", message: "Control Room is unavailable" });
    }
  });

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
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ code: "IDEMPOTENCY_CONFLICT", message: error.message });
      }
      return sendServiceFailure(reply, error, "INVESTIGATION_FAILED", "investigation could not be started");
    }
  });

  app.get<{ Params: { sessionId: string } }>("/api/investigations/:sessionId", async (request, reply) => {
    if (!investigationService) return reply.code(503).send({ code: "UNAVAILABLE", message: "investigation service unavailable" });
    try {
      return await investigationService.get(request.params.sessionId);
    } catch (error) {
      if (error instanceof InvestigationNotFoundError) {
        return reply.code(404).send({ code: "NOT_FOUND", message: error.message });
      }
      return sendServiceFailure(reply, error, "INVESTIGATION_READ_FAILED", "investigation could not be read");
    }
  });

  app.post<{ Params: { sessionId: string } }>("/api/investigations/:sessionId/cancel", async (request, reply) => {
    if (!investigationService) return reply.code(503).send({ code: "UNAVAILABLE", message: "investigation service unavailable" });
    try {
      const snapshot = await investigationService.cancel(request.params.sessionId);
      return reply.code(202).send({ sessionId: snapshot.sessionId, status: snapshot.status });
    } catch (error) {
      if (error instanceof InvestigationNotFoundError) {
        return reply.code(404).send({ code: "NOT_FOUND", message: error.message });
      }
      return sendServiceFailure(reply, error, "INVESTIGATION_CANCEL_FAILED", "investigation could not be cancelled");
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    const pump = async () => {
      if (closed) return;
      try {
        const snapshot = await investigationService.get(request.params.sessionId);
        if (closed) return;
        for (const event of snapshot.events.filter((item) => item.sequence > cursor)) {
          if (closed) return;
          reply.raw.write(`id: ${event.sequence}\nevent: harness\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.sequence;
        }
        if (closed) return;
        if (["READY", "BLOCKED", "UNCERTAIN", "ERROR", "CANCELLED"].includes(snapshot.status)) {
          close();
          return;
        }
        timer = setTimeout(() => void pump(), 250);
      } catch {
        if (closed) return;
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "STREAM_FAILED", message: "event stream failed" })}\n\n`);
        close();
      }
    };
    request.raw.on("close", close);
    await pump();
  });

  return app;
}

function sendServiceFailure(reply: FastifyReply, error: unknown, code: string, message: string) {
  const unavailable = isUnavailableError(error);
  return reply.code(unavailable ? 503 : 502).send({
    code: unavailable ? "DEPENDENCY_UNAVAILABLE" : code,
    message: unavailable ? "TrueForge is unavailable" : message,
  });
}

function isUnavailableError(error: unknown) {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
  return statusCode === 408 || statusCode === 429 || statusCode === 503 || statusCode === 504
    || (error instanceof Error && /timeout|timed out|unavailable|connection refused|econn/i.test(error.message));
}
