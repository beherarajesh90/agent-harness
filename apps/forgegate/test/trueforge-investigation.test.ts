import { describe, expect, it, vi } from "vitest";

import { createInvestigationPhaseController, createTrueForgeInvestigationLauncher } from "../src/trueforge-investigation.js";

describe("createTrueForgeInvestigationLauncher", () => {
  it("creates an agent-backed session and instructs two visible analysts", async () => {
    const sessions = {
      create: vi.fn(async () => ({ data: { id: "session-1" } })),
      createTurn: vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
        void request;
        return { data: { id: "turn-1" } };
      }),
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
      agent: { spec: expect.objectContaining({ model: { name: "ollama-local/qwen35-4b", params: { max_tokens: 4096 } } }) },
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
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("ScenarioPlan ordering is also a non-empty string[]");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("ScenarioPlan seed is a non-negative integer");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Use cwd / for sandbox commands; /workspace does not exist");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Evidence reference sha must equal the exact PR head commit SHA");
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
        { event: { content: JSON.stringify({ head: { sha: "a".repeat(40) } }), sequence: 1, type: "tool.response" }, turnId: "turn-2" },
        { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha: "a".repeat(40), startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha: "a".repeat(40), startLine: 1 }], id: "i1", statement: "one charge", testedSha: "a".repeat(40) }, sequence: 2, type: "tool.response" }, turnId: "turn-2" },
        { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "timeout"], seed: 1, testedSha: "a".repeat(40) }, sequence: 3, type: "tool.response" }, turnId: "turn-2" },
        { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 100, intents: 100, ledgerEntries: 100 }, repetitions: 1, seed: 1, testedSha: "a".repeat(40), verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-2" },
        { event: { sequence: 5, state: { status: "done" }, type: "turn.done" }, turnId: "turn-2" },
      ];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(receivedPrompt).toContain("Phase INVARIANTS");
  });

  it.each(["cancelled", "error", "blocked"])("does not continue a %s terminal turn", async (status) => {
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const listEvents = vi.fn(async () => [{ event: { state: { status }, type: "turn.done" }, turnId: "turn-1" }]);
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("does not continue after an explicit UNCERTAIN decision", async () => {
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const listEvents = vi.fn(async () => [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" }]);
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("continues an UNCERTAIN turn when partial evidence can still be completed", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 102, intents: 100, ledgerEntries: 100 }, repetitions: 1, seed: 1, testedSha: "a".repeat(40), verdict: "fail" }, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void request;
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Phase INVARIANTS");
  });

  it("continues to experiments when scenarios exist without results", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: "a".repeat(40) }, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void request;
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Phase EXPERIMENT");
  });

  it("continues to experiments when some scenarios are still missing results", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: "a".repeat(40) }, sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["duplicate webhook"], invariantId: "i1", ordering: ["charge", "webhook"], scenarioId: "s2", seed: 2, testedSha: "a".repeat(40) }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: "a".repeat(40), verdict: "pass" }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s3", seed: 3, testedSha: "a".repeat(40), verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void request;
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Phase EXPERIMENT");
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("s2");
  });

  it("recovers once from an invalid MCP tool name with the canonical tool list", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { content: JSON.stringify({ error: [{ type: "text", text: '{"error":"Tool call failed: Tool \'get_pr\' is not allowed"}' }] }), type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const prompts: string[] = [];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      prompts.push(request.input[0]!.content);
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(prompts[0]).toContain("get_pull_request");
    expect(prompts[0]).toContain("Do not call list_tools");
  });

  it("does not recover an invalid MCP call made by a subagent", async () => {
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const listEvents = vi.fn(async () => [
      { event: { content: JSON.stringify({ error: [{ type: "text", text: "Tool call failed: Tool 'list_tools' is not allowed" }] }), threadId: "subagent-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ]);
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("retries one transient sandbox startup failure before accepting UNCERTAIN", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { content: JSON.stringify({ success: true, response: { exitCode: -1, result: "fork/exec /usr/bin/bash: no such file or directory" } }), type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void request;
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Retry the same sandbox command once");
  });

  it("does not treat GitHub response text as a sandbox failure", async () => {
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const listEvents = vi.fn(async () => [
      { event: { content: "GitHub file contains fork/exec /usr/bin/bash: no such file or directory", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("surfaces phase controller failures through the launcher callback", async () => {
    const onControllerError = vi.fn();
    const launch = createTrueForgeInvestigationLauncher({
      modelName: "ollama-local/qwen35-4b",
      repository: "beherarajesh90/agent-harness",
      sessions: {
        create: vi.fn(async () => ({ data: { id: "session-1" } })),
        createTurn: vi.fn(async () => ({ data: { id: "turn-1" } })),
      },
      listEvents: async () => {
        throw new Error("controller unavailable");
      },
      onControllerError,
    });

    await launch({ pullRequestUrl: "https://github.com/beherarajesh90/agent-harness/pull/7" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onControllerError).toHaveBeenCalledWith(expect.objectContaining({ message: "controller unavailable" }));
  });
});
