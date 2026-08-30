import { describe, expect, it, vi } from "vitest";

import { hasSubagentToolPolicyViolation } from "../src/investigation.js";
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
            content: expect.stringMatching(/Do not finish after setup[\s\S]*do not use raw GitHub curl responses[\s\S]*approved repository evidence[\s\S]*experimentResult[\s\S]*Completion predicate/),
            type: "user.message",
          }),
        ],
      }),
    );
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("ScenarioPlan ordering is also a non-empty string[]");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("ScenarioPlan seed is a non-negative integer");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("When creating failure-mode-analyst, include this exact output contract");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("return only a raw JSON array");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("execution with entrypoint, inputs, and assertions");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Use cwd / for sandbox commands; /workspace does not exist");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Evidence reference sha must equal the exact PR head commit SHA");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("never count, transform, pad, truncate, or retry get_file with an alternate SHA");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("The final decision response must include invariants, scenarios, experimentResults, and decision");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Set experimentResult to null");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Subagents receive the repository, PR URL, exact head SHA");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("derive the approved path list from its exact returned filenames");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("must fetch only approved evidence through read-only MCP calls");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("invariant-analyst delegated input must allow bounded read-only forgegate-github tools");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("failure-mode-analyst delegated input must state exactly");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).not.toContain("Pass bounded literal excerpts");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("The invariant analyst may use bounded sandbox exec");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Create failure-mode-analyst only after invariant-analyst thread.done");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("pass the exact validated invariant JSON and repository capability map in its input");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Do not create the subagent if this boundary is absent");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Each ScenarioPlan must include execution.entrypoint, execution.inputs, and one or more execution.assertions");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("compile or type-check the temporary runner");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("A runner/import/setup/preflight failure is an untestable scenario, not a product failure");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("phase=preflight, status=pass");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("sole source for ExperimentResult.expected");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("concrete preflightArtifactLink");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Never run recursive repository scans");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("build a repository capability map from exact-SHA evidence");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("pass the exact validated invariant JSON and repository capability map");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Execute every accepted ScenarioPlan exactly once using a preflighted temporary runner generated from that plan");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("without injected faults");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Reuse that exact baseline measurement set as expected in every ExperimentResult");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("You have no tools. Reason only from the supplied invariant JSON and repository capability map.");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Every accepted invariant must have at least one ScenarioPlan");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("every scenario must target a behavior changed by the PR");
    expect(sessions.createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("combine the complete interaction in one ScenarioPlan");
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
        { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "timeout"], scenarioId: "s1", seed: 1, testedSha: "a".repeat(40) }, sequence: 3, type: "tool.response" }, turnId: "turn-2" },
        { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 100, intents: 100, ledgerEntries: 100 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: "a".repeat(40), verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-2" },
        { event: { sequence: 5, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [{ confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha: "a".repeat(40), startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha: "a".repeat(40), startLine: 1 }], id: "i1", statement: "one charge", testedSha: "a".repeat(40) }], scenarios: [{ expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "timeout"], scenarioId: "s1", seed: 1, testedSha: "a".repeat(40) }], experimentResults: [{ artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 100, intents: 100, ledgerEntries: 100 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: "a".repeat(40), verdict: "pass" }] }) }, status: "done" }, type: "turn.done" }, turnId: "turn-2" },
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

  it("stops after a subagent tool-policy violation", async () => {
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const listEvents = vi.fn(async () => [
      { event: { threadId: "analyst-1", title: "invariant-analyst", type: "thread.created" }, turnId: "turn-1" },
      { event: { threadId: "analyst-1", toolCalls: [{ id: "exec-1", function: { arguments: JSON.stringify({ command: "curl -s https://example.com" }), name: "exec" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "BLOCKED" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);
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
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Set experimentResult to null");
  });

  it("does not select DECISION for an inconsistent complete artifact set", async () => {
    const sha = "a".repeat(40);
    const artifact = (artifactType: string, value: Record<string, unknown>) => ({ event: { artifactType, artifact: value, type: "tool.response" }, turnId: "turn-1" });
    const createTurn = vi.fn(async (sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void sessionId;
      void request;
      return { data: { id: "turn-2" } };
    });
    const listEvents = async () => [
      artifact("InvariantCandidate", { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }),
      artifact("ScenarioPlan", { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }),
      artifact("ExperimentResult", { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 2, testedSha: sha, verdict: "pass" }),
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Evidence consistency failed");
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).not.toContain("Phase DECISION");
  });

  it("hands exact invariant and capability-map JSON to the failure-mode analyst phase", async () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const map = { operations: [{ entrypoint: "processPayment", inputs: { amount: 500 }, supportedFaults: ["timeout-after-charge"] }], testedSha: sha };
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { content: JSON.stringify({ head: { sha } }), type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "RepositoryCapabilityMap", artifact: map, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      expect(request.input[0]?.content).toContain("Phase HYPOTHESES");
      expect(request.input[0]?.content).toContain(`<invariant-candidates>${JSON.stringify([invariant])}</invariant-candidates>`);
      expect(request.input[0]?.content).toContain(`<repository-capability-map>${JSON.stringify(map)}</repository-capability-map>`);
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("collects a capability map before retrying scenario analysis", async () => {
    const sha = "a".repeat(40);
    const events = [
      { event: { content: JSON.stringify({ head: { sha } }), type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "src/payment.ts", sha, startLine: 1 }, { endLine: 2, path: "test/payment.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, _request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      void _request;
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("Do not create the analyst yet");
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).toContain("capabilityMap containing a JSON-encoded object");
  });

  it("repairs invariant evidence that uses a file blob SHA", async () => {
    const testedSha = "a".repeat(40);
    const invariant = {
      confidence: 1,
      evidence: [
        { endLine: 2, path: "src/payment-lab.ts", sha: "b".repeat(40), startLine: 1 },
        { endLine: 4, path: "src/payment-lab.ts", sha: "b".repeat(40), startLine: 3 },
      ],
      id: "i1",
      statement: "one charge",
      testedSha,
    };
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { stage: "INVARIANTS", state: { output: { content: JSON.stringify([invariant]) } }, threadId: "analyst-1", type: "thread.done" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      expect(request.input[0]?.content).toContain("blob SHA");
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("does not repeat blob-SHA recovery after a corrected invariant output", async () => {
    const testedSha = "a".repeat(40);
    const evidence = [
      { endLine: 2, path: "src/payment-lab.ts", sha: testedSha, startLine: 1 },
      { endLine: 4, path: "src/payment-lab.ts", sha: testedSha, startLine: 3 },
    ];
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { stage: "INVARIANTS", state: { output: { content: JSON.stringify([{ confidence: 1, evidence: evidence.map((reference) => ({ ...reference, sha: "b".repeat(40) })), id: "i1", statement: "one charge", testedSha }]) } }, threadId: "analyst-1", type: "thread.done" }, turnId: "turn-1" },
      { event: { stage: "INVARIANTS", state: { output: { content: JSON.stringify([{ confidence: 1, evidence, id: "i1", statement: "one charge", testedSha }]) } }, threadId: "analyst-2", type: "thread.done" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      expect(request.input[0]?.content).not.toContain("file blob SHA");
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("retries a Markdown failure-mode analyst response as raw JSON", async () => {
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { stage: "HYPOTHESES", state: { output: { content: "| scenario | fault |\n|---|---|\n| s1 | timeout |" } }, threadId: "analyst-1", type: "thread.done" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      expect(request.input[0]?.content).toContain("ONLY a JSON array");
      expect(request.input[0]?.content).toContain("validated invariant JSON");
      expect(request.input[0]?.content).toContain("execution { entrypoint, inputs, assertions }");
      expect(request.input[0]?.content).toContain("No Markdown, prose, code fences");
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("retries a schema-invalid scenario array", async () => {
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { stage: "HYPOTHESES", state: { output: { content: JSON.stringify([{ expectedOutcome: "one charge", injectedFaults: [], invariantId: "i1", ordering: ["runScenarioFixture"], scenarioId: "s1", seed: 1, testedSha: "a".repeat(40) }]) } }, threadId: "analyst-1", type: "thread.done" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      expect(request.input[0]?.content).toContain("at least one supported injected fault");
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("stops after the same incomplete decision response repeats", async () => {
    const incomplete = JSON.stringify({ decision: "BLOCKED", invariants: [], scenarios: [], experimentResults: [] });
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { state: { output: { content: incomplete } }, type: "turn.done" }, turnId: "turn-1" },
      { event: { state: { output: { content: incomplete } }, type: "turn.done" }, turnId: "turn-2" },
    ];
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-2");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("continues experiment recovery before stopping repeated incomplete decisions", async () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "src/payment-lab.ts", sha, startLine: 2 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const incomplete = JSON.stringify({ decision: "READY", experimentResults: [], invariants: [], scenarios: [] });
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { artifact: invariant, artifactType: "InvariantCandidate", type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: scenario, artifactType: "ScenarioPlan", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: incomplete } }, type: "turn.done" }, turnId: "turn-1" },
      { event: { state: { output: { content: incomplete } }, type: "turn.done" }, turnId: "turn-2" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      expect(request.input[0]?.content).toContain("Missing scenario IDs: s1");
      return { data: { id: "turn-3" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-2");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("repairs an incomplete decision after evidence is complete", async () => {
    const sha = "a".repeat(40);
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [{}], experimentResults: [{}] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      expect(request.input[0]?.content).toContain("Final response rejected");
      expect(request.input[0]?.content).toContain('"scenarioId":"s1"');
      events.push({ event: { sequence: 6, state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [events[1]!.event.artifact], scenarios: [events[2]!.event.artifact], experimentResults: [events[3]!.event.artifact] }) } }, type: "turn.done" }, turnId: "turn-2" });
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("uses the newest primary decision when TrueForge returns newest-first events", async () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { sequence: 6, state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-2" },
      { event: { sequence: 5, state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [{}], experimentResults: [{}] }) } }, type: "turn.done" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async () => ({ data: { id: "unexpected" } }));
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-2");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("stops after one failed decision repair instead of issuing generic decision turns", async () => {
    const sha = "a".repeat(40);
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [{}], experimentResults: [{}] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async () => {
      events.push({ event: { sequence: 6, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [{}], experimentResults: [{}] }) } }, type: "turn.done" }, turnId: "turn-2" });
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
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
      { event: { threadId: "subagent-1", toolCalls: [{ id: "invalid-1", function: { arguments: "{}", name: "list_tools" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ error: [{ type: "text", text: "Tool call failed: Tool 'list_tools' is not allowed" }] }), threadId: "subagent-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ]);
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).not.toHaveBeenCalled();
  });

  it("recovers once from a subagent get_file placeholder ref", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { threadId: "analyst-1", type: "tool.response", content: JSON.stringify({ error: [{ type: "text", text: "ref must be a full commit SHA at ref" }] }) }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      expect(request.input[0]?.content).toContain("exact full 40-character PR head commit SHA");
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("does not classify a rejected subagent placeholder ref as a hard violation", () => {
    const sha = "a".repeat(40);
    expect(hasSubagentToolPolicyViolation([
      { event: { toolCalls: [{ id: "files-1", function: { arguments: JSON.stringify({ mcp_server: "forgegate-github", tool_name: "get_pull_request_files", input: { pull_number: 1 } }), name: "call_tool" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, files: [{ filename: "apps/forgegate/src/payment-lab.ts" }] }), toolCallId: "files-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { toolCalls: [{ id: "pr-1", function: { arguments: JSON.stringify({ mcp_server: "forgegate-github", tool_name: "get_pull_request", input: { pull_number: 1 } }), name: "call_tool" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, head: { sha } }), toolCallId: "pr-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { threadId: "analyst-1", title: "invariant-analyst", type: "thread.created" }, turnId: "turn-1" },
      { event: { threadId: "analyst-1", toolCalls: [{ id: "read-1", function: { arguments: JSON.stringify({ path: "apps/forgegate/src/payment-lab.ts", ref: "PR_HEAD" }), name: "get_file" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ error: [{ type: "text", text: "ref must be a full commit SHA at ref" }] }), threadId: "analyst-1", toolCallId: "read-1", type: "tool.response" }, turnId: "turn-1" },
    ])).toBe(false);
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

  it("does not recover an unrelated failed sandbox command as a scenario failure", async () => {
    const createTurn = vi.fn(async (_sessionId: string, _request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      void _request;
      return { data: { id: "unexpected" } };
    });
    const listEvents = vi.fn(async () => [
      { event: { toolCalls: [{ id: "setup-1", function: { arguments: JSON.stringify({ command: "pnpm lint", cwd: "/", intent: "repository setup" }), name: "exec" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, response: { exitCode: 1, result: "lint failed" } }), toolCallId: "setup-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);
    const controller = createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalled();
    expect(createTurn.mock.calls[0]?.[1].input[0]?.content).not.toContain("scenario runner or preflight failed");
  });

  it("repairs one failed scenario preflight without treating it as a product failure", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { toolCalls: [{ id: "preflight-1", function: { arguments: JSON.stringify({ command: "node runner.js", cwd: "/", intent: "preflight: scenario runner" }), name: "exec" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, response: { exitCode: 1, result: "unsupported payment fault: missing-provider-charge" } }), toolCallId: "preflight-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      expect(request.input[0]?.content).toContain("scenario runner or preflight failed");
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("repairs an experiment whose expected measurements differ from its preflight", async () => {
    let events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { toolCalls: [{ id: "preflight-2", function: { arguments: JSON.stringify({ command: "node preflight.js", cwd: "/", intent: "preflight: scenario runner" }), name: "exec" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, response: { exitCode: 0, result: JSON.stringify({ artifactLink: "sandbox:preflight", entrypoint: "processPayment", measurements: { charges: 1 }, phase: "preflight", status: "pass" }) } }), toolCallId: "preflight-2", type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["sandbox:experiment"], baselineSha: "b".repeat(40), expected: { charges: 2 }, observed: { charges: 2 }, preflightArtifactLink: "sandbox:preflight", repetitions: 1, seed: 1, testedSha: "a".repeat(40), verdict: "pass" }, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      expect(request.input[0]?.content).toContain("scenario runner or preflight failed");
      events = [{ event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-2" }];
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
  });

  it("rejects preflight evidence from a different scenario entrypoint", async () => {
    const sha = "a".repeat(40);
    const scenario = { execution: { assertions: ["charges === 1"], entrypoint: "runScenarioFixture", inputs: { seed: 1 } }, expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["sandbox:experiment"], baselineSha: "b".repeat(40), expected: { charges: 1 }, observed: { charges: 2 }, preflightArtifactLink: "sandbox:preflight", repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const preflight = { artifactLink: "sandbox:preflight", entrypoint: "processPayment", measurements: { charges: 1 }, phase: "preflight", scenarioId: "s1", seed: 1, status: "pass" };
    const events: { event: Record<string, unknown>; turnId: string }[] = [
      { event: { artifact: scenario, artifactType: "ScenarioPlan", type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: result, artifactType: "ExperimentResult", type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, response: { exitCode: 0, result: JSON.stringify(preflight) } }), type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];
    const createTurn = vi.fn(async (_sessionId: string, request: { input: { content: string; type: "user.message" }[] }) => {
      void _sessionId;
      expect(request.input[0]?.content).toContain("scenario runner or preflight failed");
      return { data: { id: "turn-2" } };
    });
    const controller = createInvestigationPhaseController({ createTurn, listEvents: async () => events, pollIntervalMs: 0, maxPolls: 1 });

    await controller.continue("session-1", "turn-1");

    expect(createTurn).toHaveBeenCalledOnce();
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
