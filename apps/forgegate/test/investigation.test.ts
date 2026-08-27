import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { createInvestigationService, IdempotencyConflictError, InvestigationNotFoundError, projectInvestigation } from "../src/investigation.js";

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
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.stage).toBe("DECISION");
  });

  it("projects known structured artifacts from event payloads", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "payment-one-charge", ordering: ["charge", "timeout"], seed: 42, testedSha: "a".repeat(40) }, artifactType: "ScenarioPlan", type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: { id: "payment-one-charge" }, artifactType: "Unknown", type: "tool.response" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts).toEqual([{ data: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "payment-one-charge", ordering: ["charge", "timeout"], seed: 42, testedSha: "a".repeat(40) }, type: "ScenarioPlan" }]);
  });

  it("extracts and validates analyst JSON from completed thread output", () => {
    const sha = "a".repeat(40);
    const snapshot = projectInvestigation("session-1", "url", [
      {
        event: {
          payload: undefined,
          state: { output: { content: `\`\`\`json\n[{\"confidence\":0.9,\"evidence\":[{\"endLine\":2,\"path\":\"a.ts\",\"sha\":\"${sha}\",\"startLine\":1},{\"endLine\":4,\"path\":\"b.ts\",\"sha\":\"${sha}\",\"startLine\":3}],\"id\":\"one-charge\",\"statement\":\"one charge\",\"testedSha\":\"${sha}\"}]\n\`\`\`` } },
          title: "invariant-analyst",
          type: "thread.done",
        },
        turnId: "turn-1",
      },
    ]);

    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]!.type).toBe("InvariantCandidate");
  });

  it("requires all evidence artifact types before projecting READY", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "a.ts", sha, startLine: 1 }, { endLine: 2, path: "b.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "timeout"], seed: 1, testedSha: sha }, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 100, intents: 100, ledgerEntries: 100 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "pass" }, type: "tool.response" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).status).toBe("READY");
  });

  it("projects artifacts from a valid final investigation bundle", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "a.ts", sha, startLine: 1 }, { endLine: 4, path: "b.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "fail" },
    };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts.map((artifact) => artifact.type)).toEqual(["InvariantCandidate", "ScenarioPlan", "ExperimentResult"]);
  });

  it("blocks a completed investigation when the experiment verdict fails", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "a.ts", sha, startLine: 1 }, { endLine: 4, path: "b.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "fail" },
    };

    expect(projectInvestigation("session-1", "url", [{ event: { state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" }]).status).toBe("BLOCKED");
  });

  it("uses TrueForge sequence as the canonical event sequence and ignores duplicates", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { id: "event-2", sequence: 2, type: "turn.done" }, turnId: "turn-1" },
      { event: { id: "event-1", sequence: 1, type: "turn.created" }, turnId: "turn-1" },
      { event: { id: "duplicate-event-2", sequence: 2, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.events.map((event) => ({ eventId: event.eventId, sequence: event.sequence }))).toEqual([
      { eventId: "event-1", sequence: 1 },
      { eventId: "event-2", sequence: 2 },
    ]);
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

  it("replays an idempotency key only for the same normalized PR URL", async () => {
    const gateway = {
      cancel: vi.fn(),
      launch: vi.fn(async () => ({ sessionId: "session-1", turnId: "turn-1" })),
      listEvents: vi.fn(async () => []),
    };
    const service = createInvestigationService(gateway);
    const url = "https://github.com/acme/demo/pull/1";

    await service.create(url, "request-1");
    await expect(service.create(`${url}#same`, "request-1")).resolves.toEqual({ sessionId: "session-1", turnId: "turn-1" });
    await expect(service.create("https://github.com/acme/demo/pull/2", "request-1")).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(gateway.launch).toHaveBeenCalledOnce();
  });

  it("shares an in-flight launch and releases the key after failure", async () => {
    let resolveLaunch!: (value: { sessionId: string; turnId: string }) => void;
    const gateway = {
      cancel: vi.fn(),
      launch: vi.fn(() => new Promise<{ sessionId: string; turnId: string }>((resolve) => { resolveLaunch = resolve; })),
      listEvents: vi.fn(async () => []),
    };
    const service = createInvestigationService(gateway);
    const url = "https://github.com/acme/demo/pull/1";
    const first = service.create(url, "request-1");
    const second = service.create(`${url}#same`, "request-1");

    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveLaunch({ sessionId: "session-1", turnId: "turn-1" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { sessionId: "session-1", turnId: "turn-1" },
      { sessionId: "session-1", turnId: "turn-1" },
    ]);
    expect(gateway.launch).toHaveBeenCalledOnce();

    gateway.launch.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(service.create(url, "request-2")).rejects.toThrow("provider unavailable");
    gateway.launch.mockResolvedValueOnce({ sessionId: "session-2", turnId: "turn-2" });
    await expect(service.create(url, "request-2")).resolves.toEqual({ sessionId: "session-2", turnId: "turn-2" });
    expect(gateway.launch).toHaveBeenCalledTimes(3);
  });

  it("rejects a conflicting PR while the idempotent launch is still in flight", async () => {
    let resolveLaunch!: (value: { sessionId: string; turnId: string }) => void;
    const gateway = {
      cancel: vi.fn(),
      launch: vi.fn(() => new Promise<{ sessionId: string; turnId: string }>((resolve) => { resolveLaunch = resolve; })),
      listEvents: vi.fn(async () => []),
    };
    const service = createInvestigationService(gateway);
    const first = service.create("https://github.com/acme/demo/pull/1", "request-1");

    await expect(service.create("https://github.com/acme/demo/pull/2", "request-1")).rejects.toBeInstanceOf(IdempotencyConflictError);
    resolveLaunch({ sessionId: "session-1", turnId: "turn-1" });
    await first;
  });

  it("recovers a durable idempotency result after service recreation", async () => {
    const gateway = {
      cancel: vi.fn(),
      findByRequestFingerprint: vi.fn(async () => ({ pullRequestUrl: "https://github.com/acme/demo/pull/1", result: { sessionId: "session-1", turnId: "turn-1" } })),
      launch: vi.fn(),
      listEvents: vi.fn(async () => []),
    };
    const service = createInvestigationService(gateway);

    await expect(service.create("https://github.com/acme/demo/pull/1", "request-1")).resolves.toEqual({ sessionId: "session-1", turnId: "turn-1" });
    expect(gateway.launch).not.toHaveBeenCalled();
    expect(gateway.findByRequestFingerprint).toHaveBeenCalledOnce();
  });

  it("exposes create, snapshot, and cancel endpoints", async () => {
    const service = {
      cancel: vi.fn(async () => ({ artifacts: [], events: [], pullRequestUrl: "url", sessionId: "session-1", stage: "CONTEXT" as const, status: "CANCELLED" as const, turnId: "turn-1" })),
      create: vi.fn(async () => ({ sessionId: "session-1", turnId: "turn-1" })),
      get: vi.fn(async () => ({ artifacts: [], events: [], pullRequestUrl: "url", sessionId: "session-1", stage: "CONTEXT" as const, status: "RUNNING" as const, turnId: "turn-1" })),
    };
    const app = buildApp({ investigationService: service });

    await expect(app.inject({ method: "POST", payload: { pullRequestUrl: "url" }, url: "/api/investigations" })).resolves.toMatchObject({ statusCode: 202 });
    service.create.mockRejectedValueOnce(new IdempotencyConflictError());
    await expect(app.inject({ headers: { "idempotency-key": "request-1" }, method: "POST", payload: { pullRequestUrl: "other-url" }, url: "/api/investigations" })).resolves.toMatchObject({ statusCode: 409 });
    await expect(app.inject({ method: "GET", url: "/api/investigations/session-1" })).resolves.toMatchObject({ statusCode: 200 });
    await expect(app.inject({ method: "POST", url: "/api/investigations/session-1/cancel" })).resolves.toMatchObject({ statusCode: 202 });
    await app.close();
  });

  it("classifies service failures without hiding them as not found", async () => {
    const snapshot = { artifacts: [], events: [], pullRequestUrl: "url", sessionId: "session-1", stage: "CONTEXT" as const, status: "RUNNING" as const, turnId: "turn-1" };
    const service = {
      cancel: vi.fn(async () => snapshot),
      create: vi.fn(async () => ({ sessionId: "session-1", turnId: "turn-1" })),
      get: vi.fn(async () => snapshot),
    };
    const app = buildApp({ investigationService: service });

    service.get.mockRejectedValueOnce(new InvestigationNotFoundError());
    await expect(app.inject({ method: "GET", url: "/api/investigations/missing" })).resolves.toMatchObject({ statusCode: 404 });
    service.get.mockRejectedValueOnce(new Error("database failed"));
    await expect(app.inject({ method: "GET", url: "/api/investigations/session-1" })).resolves.toMatchObject({ statusCode: 502 });
    service.get.mockRejectedValueOnce(new Error("TrueForge timeout"));
    await expect(app.inject({ method: "GET", url: "/api/investigations/session-1" })).resolves.toMatchObject({ statusCode: 503 });

    service.create.mockRejectedValueOnce(new Error("provider failed"));
    await expect(app.inject({ method: "POST", payload: { pullRequestUrl: "url" }, url: "/api/investigations" })).resolves.toMatchObject({ statusCode: 502 });
    service.create.mockRejectedValueOnce(new Error("TrueForge unavailable"));
    await expect(app.inject({ method: "POST", payload: { pullRequestUrl: "url" }, url: "/api/investigations" })).resolves.toMatchObject({ statusCode: 503 });

    service.cancel.mockRejectedValueOnce(new InvestigationNotFoundError());
    await expect(app.inject({ method: "POST", url: "/api/investigations/session-1/cancel" })).resolves.toMatchObject({ statusCode: 404 });
    service.cancel.mockRejectedValueOnce(new Error("cancel failed"));
    await expect(app.inject({ method: "POST", url: "/api/investigations/session-1/cancel" })).resolves.toMatchObject({ statusCode: 502 });
    service.cancel.mockRejectedValueOnce(new Error("TrueForge timeout"));
    await expect(app.inject({ method: "POST", url: "/api/investigations/session-1/cancel" })).resolves.toMatchObject({ statusCode: 503 });

    await app.close();
  });

  it("resumes SSE after the Last-Event-ID cursor", async () => {
    const app = buildApp({
      investigationService: {
        cancel: vi.fn(),
        create: vi.fn(),
        get: vi.fn(async () => ({
          artifacts: [],
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
