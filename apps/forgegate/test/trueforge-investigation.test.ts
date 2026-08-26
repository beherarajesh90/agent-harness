import { describe, expect, it, vi } from "vitest";

import { createInvestigationPhaseController, createTrueForgeInvestigationLauncher } from "../src/trueforge-investigation.js";

describe("createTrueForgeInvestigationLauncher", () => {
  it("creates an agent-backed session and instructs two visible analysts", async () => {
    const sessions = {
      create: vi.fn(async () => ({ data: { id: "session-1" } })),
      createTurn: vi.fn(async () => ({ data: { id: "turn-1" } })),
    };
    const launch = createTrueForgeInvestigationLauncher({
      modelName: "ollama-local/qwen35-4b",
      repository: "beherarajesh90/agent-harness",
      sessions,
    });

    await expect(
      launch({
        pullRequestUrl: "https://github.com/beherarajesh90/agent-harness/pull/7",
      }),
    ).resolves.toEqual({ sessionId: "session-1", turnId: "turn-1" });
    expect(sessions.create).toHaveBeenCalledWith({
      agent: { spec: expect.objectContaining({ model: { name: "ollama-local/qwen35-4b" } }) },
    });
    expect(sessions.createTurn).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        input: [
          expect.objectContaining({
            content: expect.stringMatching(/Do not finish after setup[\s\S]*do not use raw GitHub curl responses[\s\S]*read payment-lab source[\s\S]*experimentResult[\s\S]*Completion predicate/),
            type: "user.message",
          }),
        ],
      }),
    );
  });

  it("rejects a pull request URL outside the configured repository", async () => {
    const sessions = { create: vi.fn(), createTurn: vi.fn() };
    const launch = createTrueForgeInvestigationLauncher({
      modelName: "ollama-local/qwen35-4b",
      repository: "beherarajesh90/agent-harness",
      sessions,
    });

    await expect(
      launch({
        pullRequestUrl: "https://github.com/other/repository/pull/7",
      }),
    ).rejects.toThrow("pull request URL is not in the configured repository");
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid configured repository", () => {
    expect(() =>
      createTrueForgeInvestigationLauncher({
        modelName: "ollama-local/qwen35-4b",
        repository: "other/repository/extra",
        sessions: { create: vi.fn(), createTurn: vi.fn() },
      }),
    ).toThrow("repository must be owner/repo");
  });

  it("advances turns until complete evidence exists", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [{ event: { type: "turn.done" }, turnId: "turn-1" }];
    let receivedPrompt = "";
    const createTurn = vi.fn(async (sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      receivedPrompt = request.input[0]!.content;
      void sessionId;
      events = [
        { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "a.ts", sha: "a".repeat(40), startLine: 1 }, { endLine: 2, path: "b.ts", sha: "a".repeat(40), startLine: 1 }], id: "i1", statement: "one charge", testedSha: "a".repeat(40) }, type: "tool.response" }, turnId: "turn-2" },
        { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "timeout"], seed: 1, testedSha: "a".repeat(40) }, type: "tool.response" }, turnId: "turn-2" },
        { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 100, intents: 100, ledgerEntries: 100 }, repetitions: 1, seed: 1, testedSha: "a".repeat(40), verdict: "pass" }, type: "tool.response" }, turnId: "turn-2" },
        { event: { type: "turn.done" }, turnId: "turn-2" },
      ];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(receivedPrompt).toContain("Phase INVARIANTS");
  });
});
