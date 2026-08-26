import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { createInvestigationService, projectInvestigation } from "../src/investigation.js";

describe("investigation control plane", () => {
  it("projects newest-first TrueForge events into ordered SSE events", () => {
    const snapshot = projectInvestigation("session-1", "https://github.com/acme/demo/pull/1", [
      { event: { id: "event-2", type: "turn.done", createdAt: "2026-01-02T00:00:00Z", state: { status: "done" } }, turnId: "turn-1" },
      { event: { id: "event-1", type: "turn.created", createdAt: "2026-01-01T00:00:00Z" }, turnId: "turn-1" },
    ]);

    expect(snapshot.events.map((event) => ({ eventId: event.eventId, sequence: event.sequence }))).toEqual([
      { eventId: "event-1", sequence: 1 },
      { eventId: "event-2", sequence: 2 },
    ]);
    expect(snapshot.status).toBe("READY");
    expect(snapshot.stage).toBe("DECISION");
  });

  it("creates, reconstructs, and cancels an investigation", async () => {
    const gateway = {
      cancel: vi.fn(async () => undefined),
      launch: vi.fn(async () => ({ sessionId: "session-1", turnId: "turn-1" })),
      listEvents: vi.fn(async () => [{ event: { id: "event-1", type: "turn.created", createdAt: "2026-01-01T00:00:00Z" }, turnId: "turn-1" }]),
    };
    const service = createInvestigationService(gateway);

    await expect(service.create("https://github.com/acme/demo/pull/1")).resolves.toEqual({ sessionId: "session-1", turnId: "turn-1" });
    await expect(service.get("session-1")).resolves.toMatchObject({ sessionId: "session-1", status: "RUNNING" });
    await expect(service.cancel("session-1")).resolves.toMatchObject({ sessionId: "session-1" });
    expect(gateway.cancel).toHaveBeenCalledWith("session-1");
  });

  it("exposes create, snapshot, and cancel endpoints", async () => {
    const service = {
      cancel: vi.fn(async () => ({ events: [], pullRequestUrl: "url", sessionId: "session-1", stage: "CONTEXT" as const, status: "CANCELLED" as const, turnId: "turn-1" })),
      create: vi.fn(async () => ({ sessionId: "session-1", turnId: "turn-1" })),
      get: vi.fn(async () => ({ events: [], pullRequestUrl: "url", sessionId: "session-1", stage: "CONTEXT" as const, status: "RUNNING" as const, turnId: "turn-1" })),
    };
    const app = buildApp({ investigationService: service });

    await expect(app.inject({ method: "POST", payload: { pullRequestUrl: "url" }, url: "/api/investigations" })).resolves.toMatchObject({ statusCode: 202 });
    await expect(app.inject({ method: "GET", url: "/api/investigations/session-1" })).resolves.toMatchObject({ statusCode: 200 });
    await expect(app.inject({ method: "POST", url: "/api/investigations/session-1/cancel" })).resolves.toMatchObject({ statusCode: 202 });
    await app.close();
  });

  it("resumes SSE after the Last-Event-ID cursor", async () => {
    const app = buildApp({
      investigationService: {
        cancel: vi.fn(),
        create: vi.fn(),
        get: vi.fn(async () => ({
          events: [
            { eventId: "event-1", occurredAt: "2026-01-01T00:00:00Z", payload: {}, sequence: 1, sessionId: "session-1", source: "SYSTEM" as const, stage: "CONTEXT" as const, turnId: "turn-1", type: "turn.created" },
            { eventId: "event-2", occurredAt: "2026-01-01T00:00:01Z", payload: {}, sequence: 2, sessionId: "session-1", source: "SYSTEM" as const, stage: "DECISION" as const, turnId: "turn-1", type: "turn.done" },
          ],
          pullRequestUrl: "url",
          sessionId: "session-1",
          stage: "DECISION" as const,
          status: "READY" as const,
          turnId: "turn-1",
        })),
      },
    });

    const response = await app.inject({ headers: { "last-event-id": "1" }, method: "GET", url: "/api/investigations/session-1/events" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("id: 2");
    expect(response.body).not.toContain("id: 1");
    await app.close();
  });
});
