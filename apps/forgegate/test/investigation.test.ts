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

  it("projects analyst roles and sandbox execution into truthful stages", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { sequence: 1, threadId: "invariant-thread", title: "invariant-analyst", type: "thread.created" }, turnId: "turn-1" },
      { event: { sequence: 2, threadId: "invariant-thread", type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 3, threadId: "failure-thread", title: "failure-mode-analyst", type: "thread.created" }, turnId: "turn-1" },
      { event: { sequence: 4, threadId: "failure-thread", type: "thread.done" }, turnId: "turn-1" },
      { event: { sequence: 5, type: "sandbox.created" }, turnId: "turn-1" },
      { event: { sequence: 6, type: "sandbox.command.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.events.map((event) => event.stage)).toEqual(["INVARIANTS", "INVARIANTS", "HYPOTHESES", "HYPOTHESES", "EXPERIMENT", "TESTING"]);
  });

  it("records a non-mutating subagent tool violation as a warning", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { threadId: "analyst-1", title: "invariant-analyst", type: "thread.created" }, turnId: "turn-1" },
      { event: { threadId: "analyst-1", toolCalls: [{ id: "tools-1", function: { arguments: "{}", name: "get_tool_info" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { threadId: "analyst-1", toolCallId: "tools-1", content: "{}", type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "BLOCKED" }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.warnings).toEqual(["SUBAGENT_TOOL_POLICY_VIOLATION"]);
  });

  it("allows a native exact-SHA get_file call from the invariant analyst", () => {
    const sha = "a".repeat(40);
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 2, threadId: "analyst-1", title: "invariant-analyst", type: "thread.created" }, turnId: "turn-1" },
      { event: { sequence: 3, threadId: "analyst-1", toolCalls: [{ id: "tools-1", function: { arguments: JSON.stringify({ path: "apps/forgegate/src/payment-lab.ts", ref: sha }), name: "get_file" } }], type: "model.message" }, turnId: "turn-1" },
      { event: { sequence: 4, threadId: "analyst-1", toolCallId: "tools-1", content: "{}", type: "tool.response" }, turnId: "turn-1" },
    ]);

    expect(snapshot.warnings).toBeUndefined();
  });

  it("accepts native primary MCP calls when validating complete evidence", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const reads = [
      ["get_pull_request", { pull_number: 7 }],
      ["get_pull_request_files", { pull_number: 7 }],
      ["get_file", { path: "apps/forgegate/src/payment-lab.ts", ref: sha }],
      ["get_file", { path: "apps/forgegate/test/payment-lab.test.ts", ref: sha }],
      ["get_checks", { ref: sha }],
      ["get_qodo_reviews", { pull_number: 7 }],
      ["get_review_comments", { pull_number: 7 }],
    ] as const;
    const events = reads.flatMap(([toolName, input], index) => {
      const id = `native-call-${index}`;
      return [
        { event: { sequence: index * 2 + 1, type: "model.message", toolCalls: [{ function: { arguments: JSON.stringify(input), name: toolName }, id }] }, turnId: "turn-1" },
        { event: { content: JSON.stringify(toolName === "get_pull_request" ? { head: { sha } } : toolName === "get_pull_request_files" ? { complete: true, files: [] } : toolName === "get_file" ? { content: "source", sha: "c".repeat(40) } : toolName === "get_checks" ? { check_runs: [] } : toolName === "get_qodo_reviews" ? { complete: true, reviews: [] } : { comments: [] }), sequence: index * 2 + 2, toolCallId: id, type: "tool.response" }, turnId: "turn-1" },
      ];
    });
    const snapshot = projectInvestigation("session-1", "url", [
      ...events,
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 15, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 16, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 17, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, sequence: 18, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("READY");
    expect(snapshot.decision).toBe("READY");
  });

  it("labels every threaded analyst event as a subagent event", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { sequence: 1, threadId: "invariant-thread", type: "thread.created" }, turnId: "turn-1" },
      { event: { sequence: 2, threadId: "invariant-thread", type: "model.message", content: "analysis" }, turnId: "turn-1" },
      { event: { sequence: 3, threadId: "invariant-thread", type: "tool.response", content: "read result" }, turnId: "turn-1" },
    ]);

    expect(snapshot.events.map((event) => event.source)).toEqual(["SUBAGENT", "SUBAGENT", "SUBAGENT"]);
  });

  it("does not project READY after a subagent attempts an invalid MCP call", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: "Tool call failed: Tool 'list_tools' is not allowed", sequence: 5, threadId: "subagent-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 6, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).status).toBe("UNCERTAIN");
  });

  it("projects known structured artifacts from event payloads", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "payment-one-charge", ordering: ["charge", "timeout"], seed: 42, testedSha: "a".repeat(40) }, artifactType: "ScenarioPlan", type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: { id: "payment-one-charge" }, artifactType: "Unknown", type: "tool.response" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts).toEqual([{ data: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "payment-one-charge", ordering: ["charge", "timeout"], seed: 42, testedSha: "a".repeat(40) }, type: "ScenarioPlan" }]);
  });

  it("projects validated sandbox result arrays as experiment artifacts", () => {
    const testedSha = "a".repeat(40);
    const baselineSha = "b".repeat(40);
    const result = {
      artifactLinks: ["payment-lab:evidence"],
      expected: { charges: 1, intents: 1, ledgerEntries: 1 },
      observed: { charges: 2, intents: 1, ledgerEntries: 1 },
      scenarioId: "s1",
      seed: 1,
      testedSha,
      verdict: "fail",
    };
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ base: { sha: baselineSha }, head: { sha: testedSha } }), type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha }, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, response: { exitCode: 0, result: JSON.stringify([result]) } }), type: "tool.response" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts).toContainEqual({ type: "ExperimentResult", data: { ...result, baselineSha, repetitions: 1 } });
  });

  it("accepts a null singular result beside the plural result representation", () => {
    const sha = "a".repeat(40);
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" };
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "BLOCKED", experimentResult: null, experimentResults: [result], invariants: [invariant], scenarios: [scenario] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts).toContainEqual({ type: "ExperimentResult", data: result });
  });

  it("extracts and validates analyst JSON from completed thread output", () => {
    const sha = "a".repeat(40);
    const snapshot = projectInvestigation("session-1", "url", [
      {
        event: {
          payload: undefined,
          state: { output: { content: `\`\`\`json\n[{\"confidence\":0.9,\"evidence\":[{\"endLine\":2,\"path\":\"apps/forgegate/src/payment-lab.ts\",\"sha\":\"${sha}\",\"startLine\":1},{\"endLine\":4,\"path\":\"apps/forgegate/test/payment-lab.test.ts\",\"sha\":\"${sha}\",\"startLine\":3}],\"id\":\"one-charge\",\"statement\":\"one charge\",\"testedSha\":\"${sha}\"}]\n\`\`\`` } },
          title: "invariant-analyst",
          type: "thread.done",
        },
        turnId: "turn-1",
      },
    ]);

    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]!.type).toBe("InvariantCandidate");
  });

  it("does not project READY before a primary-agent decision", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "timeout"], seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 100, intents: 100, ledgerEntries: 100 }, observed: { charges: 100, intents: 100, ledgerEntries: 100 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).status).toBe("UNCERTAIN");
  });

  it("does not project BLOCKED without a valid primary-agent decision", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, state: { output: { content: "not-json" }, status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];

    const snapshot = projectInvestigation("session-1", "url", items);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
  });

  it("reconciles failed evidence to BLOCKED when the decision is on the completed turn output", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const final = JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] });
    const reads = [
      ["get_pull_request", { pull_number: 7 }],
      ["get_pull_request_files", { pull_number: 7 }],
      ["get_checks", { pull_number: 7, ref: sha }],
      ["get_qodo_reviews", { pull_number: 7 }],
      ["get_review_comments", { pull_number: 7 }],
      ["get_file", { path: "apps/forgegate/src/payment-lab.ts", ref: sha }],
      ["get_file", { path: "apps/forgegate/test/payment-lab.test.ts", ref: sha }],
    ].flatMap(([toolName, input], index) => {
      const id = `read-${index}`;
      return [
        { event: { sequence: index * 2 + 1, type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input, mcp_server: "forgegate-github", tool_name: toolName }), name: "call_tool" }, id }] } }, turnId: "turn-1" },
        { event: { content: JSON.stringify({ head: { sha }, success: true }), sequence: index * 2 + 2, toolCallId: id, type: "tool.response" }, turnId: "turn-1" },
      ];
    });
    const snapshot = projectInvestigation("session-1", "url", [
      ...reads,
      { event: { artifact: invariant, artifactType: "InvariantCandidate", sequence: 15, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: scenario, artifactType: "ScenarioPlan", sequence: 16, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: { ...scenario, scenarioId: "intermediate-only", seed: 99 }, artifactType: "ScenarioPlan", sequence: 17, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: result, artifactType: "ExperimentResult", sequence: 18, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ response: { exitCode: 0, result: "experiment complete" }, success: true }), sequence: 19, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: final, sequence: 20, type: "model.message" }, turnId: "turn-1" },
      { event: { sequence: 21, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("BLOCKED");
    expect(snapshot.decision).toBe("BLOCKED");
  });

  it("does not accept a final decision after the latest sandbox command fails", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ response: { exitCode: 1, result: "ts-node failed" }, success: true }), sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 3, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
  });

  it("does not accept a final decision when a subagent executes a sandbox command", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ response: { exitCode: 0, result: "primary evidence" }, success: true }), sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ response: { exitCode: 0, result: "subagent command" }, success: true }), sequence: 3, threadId: "subagent-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 4, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
  });

  it("does not accept a final decision when recorded GitHub review reads are incomplete", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { sequence: 1, type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input: { pull_number: 7 }, mcp_server: "forgegate-github", tool_name: "get_pull_request" }), name: "call_tool" }, id: "call-pr" }] } }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 2, toolCallId: "call-pr", type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 3, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
  });

  it("accepts a read-only subagent MCP read but rejects subagent sandbox execution", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const reads = [
      ["get_pull_request", { pull_number: 7 }],
      ["get_pull_request_files", { pull_number: 7 }],
      ["get_file", { path: "apps/forgegate/src/payment-lab.ts", ref: sha }],
      ["get_file", { path: "apps/forgegate/test/payment-lab.test.ts", ref: sha }],
      ["get_checks", { ref: sha }],
      ["get_qodo_reviews", { pull_number: 7 }],
      ["get_review_comments", { pull_number: 7 }],
    ] as const;
    const events = reads.flatMap(([toolName, input], index) => {
      const id = `call-${index}`;
      return [
        { event: { sequence: index * 2 + 1, type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input, mcp_server: "forgegate-github", tool_name: toolName }), name: "call_tool" }, id }] } }, turnId: "turn-1" },
        { event: { content: index === 0 ? JSON.stringify({ head: { sha }, success: true }) : JSON.stringify({ response: {}, success: true }), sequence: index * 2 + 2, toolCallId: id, type: "tool.response" }, turnId: "turn-1" },
      ];
    });
    const subagentCallId = "subagent-read";
    const subagentEvents = [
      { event: { sequence: 16, threadId: "subagent-1", type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input: { path: "apps/forgegate/src/payment-lab.ts", ref: sha }, mcp_server: "forgegate-github", tool_name: "get_file" }), name: "call_tool" }, id: subagentCallId }] } }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, content: "supplemental evidence" }), sequence: 17, threadId: "subagent-1", toolCallId: subagentCallId, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 18, threadId: "subagent-1", type: "model.message", toolCalls: [{ function: { arguments: JSON.stringify({ command: "nl -ba apps/forgegate/src/payment-lab.ts | sed -n '150,260p'", cwd: "/" }), name: "exec" }, id: "subagent-inspection" }] }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, response: { exitCode: 0, result: "150 source line" } }), sequence: 19, threadId: "subagent-1", toolCallId: "subagent-inspection", type: "tool.response" }, turnId: "turn-1" },
    ];
    const finalDecision = { event: { sequence: 18, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" };
    const acceptedSnapshot = projectInvestigation("session-1", "url", [
      ...events,
      { event: { sequence: 15, threadId: "subagent-1", title: "invariant-analyst", type: "thread.created" }, turnId: "turn-1" },
      ...subagentEvents.slice(0, 2),
      finalDecision,
    ]);

    expect(acceptedSnapshot.status).toBe("READY");
    expect(acceptedSnapshot.decision).toBe("READY");

    const rejectedSnapshot = projectInvestigation("session-1", "url", [
      ...events,
      ...subagentEvents,
      { ...finalDecision, event: { ...finalDecision.event, sequence: 20 } },
    ]);

    expect(rejectedSnapshot.status).toBe("UNCERTAIN");
    expect(rejectedSnapshot.decision).toBeUndefined();
  });

  it("does not let subagent GitHub reads establish the trusted PR evidence", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const reads = [
      ["get_pull_request", { pull_number: 7 }],
      ["get_pull_request_files", { pull_number: 7 }],
      ["get_file", { path: "apps/forgegate/src/payment-lab.ts", ref: sha }],
      ["get_file", { path: "apps/forgegate/test/payment-lab.test.ts", ref: sha }],
      ["get_checks", { ref: sha }],
      ["get_qodo_reviews", { pull_number: 7 }],
      ["get_review_comments", { pull_number: 7 }],
    ] as const;
    const events = reads.flatMap(([toolName, input], index) => {
      const id = `subagent-call-${index}`;
      return [
        { event: { sequence: index * 2 + 1, threadId: "subagent-1", type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input, mcp_server: "forgegate-github", tool_name: toolName }), name: "call_tool" }, id }] } }, turnId: "turn-1" },
        { event: { content: index === 0 ? JSON.stringify({ head: { sha } }) : "[]", sequence: index * 2 + 2, threadId: "subagent-1", toolCallId: id, type: "tool.response" }, turnId: "turn-1" },
      ];
    });

    const snapshot = projectInvestigation("session-1", "url", [
      ...events,
      { event: { sequence: 15, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
  });

  it.each([
    ["a disallowed path", { path: "README.md", ref: "a".repeat(40) }],
    ["a non-head ref", { path: "apps/forgegate/src/payment-lab.ts", ref: "b".repeat(40) }],
  ])("rejects a subagent read using %s", (_description, input) => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const reads = [
      ["get_pull_request", { pull_number: 7 }],
      ["get_pull_request_files", { pull_number: 7 }],
      ["get_file", { path: "apps/forgegate/src/payment-lab.ts", ref: sha }],
      ["get_file", { path: "apps/forgegate/test/payment-lab.test.ts", ref: sha }],
      ["get_checks", { ref: sha }],
      ["get_qodo_reviews", { pull_number: 7 }],
      ["get_review_comments", { pull_number: 7 }],
    ] as const;
    const events = reads.flatMap(([toolName, readInput], index) => {
      const id = `primary-call-${index}`;
      return [
        { event: { sequence: index * 2 + 1, type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input: readInput, mcp_server: "forgegate-github", tool_name: toolName }), name: "call_tool" }, id }] } }, turnId: "turn-1" },
        { event: { content: JSON.stringify(index === 0 ? { head: { sha } } : { success: true, response: {} }), sequence: index * 2 + 2, toolCallId: id, type: "tool.response" }, turnId: "turn-1" },
      ];
    });
    const subagentCallId = "invalid-subagent-read";
    const snapshot = projectInvestigation("session-1", "url", [
      ...events,
      { event: { sequence: 16, threadId: "subagent-1", type: "model.message", usage: { toolCalls: [{ function: { arguments: JSON.stringify({ input, mcp_server: "forgegate-github", tool_name: "get_file" }), name: "call_tool" }, id: subagentCallId }] } }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ success: true, content: "supplemental evidence" }), sequence: 17, threadId: "subagent-1", toolCallId: subagentCallId, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 18, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 19, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 20, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 21, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.status).toBe("UNCERTAIN");
    expect(snapshot.decision).toBeUndefined();
  });

  it("does not project READY when artifact relationships are inconsistent", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "wrong-id", ordering: ["charge"], seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 2, testedSha: sha, verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).status).toBe("UNCERTAIN");
  });

  it("does not project READY when an accepted invariant has no scenario", () => {
    const sha = "a".repeat(40);
    const invariant = (id: string) => ({ confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id, statement: "one charge", testedSha: sha });
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: invariant("i1"), artifactType: "InvariantCandidate", sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: invariant("i2"), artifactType: "InvariantCandidate", sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: scenario, artifactType: "ScenarioPlan", sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifact: result, artifactType: "ExperimentResult", sequence: 5, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 6, state: { output: { content: JSON.stringify({ decision: "READY", invariants: [invariant("i1"), invariant("i2")], scenarios: [scenario], experimentResults: [result] }) } }, type: "turn.done" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).status).toBe("UNCERTAIN");
  });

  it("projects artifacts from a valid final investigation bundle", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" },
    };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts.map((artifact) => artifact.type)).toEqual(["InvariantCandidate", "ScenarioPlan", "ExperimentResult"]);
    expect(snapshot.decision).toBe("BLOCKED");
  });

  it("preserves individually valid artifacts from an incomplete final bundle", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      experimentResults: [{ artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "fail" }],
    };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(bundle) } }, sequence: 2, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts.map((artifact) => artifact.type)).toEqual(["InvariantCandidate", "ExperimentResult"]);
    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("surfaces subagent tool responses without usage metadata", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: "forgegate-github: get_file", toolCallId: "subagent-call", sequence: 5, threadId: "subagent-1", type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 6, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).status).toBe("UNCERTAIN");
  });

  it("does not reconstruct a terminal decision from a rejected final bundle", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const rejected = { decision: "BLOCKED", invariants: [invariant], experimentResults: [result] };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, type: "model.message" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(rejected) } }, sequence: 6, type: "turn.done" }, turnId: "turn-1" },
      { event: { state: { status: "done" }, sequence: 6, type: "turn.done" }, turnId: "turn-2" },
    ]);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("does not reconcile BLOCKED when required reads or sandbox execution failed", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const rejected = { decision: "BLOCKED", experimentResult: result, invariants: [invariant], scenarios: [scenario], experimentResults: [result] };
    const events = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ response: { exitCode: 1 } }), sequence: 5, type: "tool.response" }, turnId: "turn-1" },
      { event: { usage: { toolCalls: [{ id: "get-file", function: { arguments: JSON.stringify({ input: { path: "apps/forgegate/src/payment-lab.ts", ref: sha }, mcp_server: "forgegate-github", tool_name: "get_file" }), name: "call_tool" } }] }, sequence: 6, type: "model.message" }, turnId: "turn-1" },
      { event: { content: JSON.stringify({ error: "read failed" }), toolCallId: "get-file", sequence: 7, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(rejected) } }, sequence: 8, type: "turn.done" }, turnId: "turn-1" },
    ];

    const snapshot = projectInvestigation("session-1", "url", events);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("does not reconcile BLOCKED without auditable GitHub reads", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const rejected = { decision: "BLOCKED", experimentResult: result, invariants: [invariant], scenarios: [scenario], experimentResults: [result] };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, type: "model.message" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(rejected) } }, sequence: 6, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("does not count failed GitHub responses as completed reads", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const };
    const rejected = { decision: "BLOCKED", experimentResult: result, invariants: [invariant], scenarios: [scenario], experimentResults: [result] };
    const calls = [
      ["get_pull_request", { pull_number: 7 }],
      ["get_pull_request_files", { pull_number: 7 }],
      ["get_checks", { ref: sha }],
      ["get_qodo_reviews", { pull_number: 7 }],
      ["get_review_comments", { pull_number: 7 }],
      ["get_file", { path: "apps/forgegate/src/payment-lab.ts", ref: sha }],
      ["get_file", { path: "apps/forgegate/test/payment-lab.test.ts", ref: sha }],
    ] as const;
    const toolCalls = calls.map(([toolName, input], index) => ({ id: `call-${index}`, function: { arguments: JSON.stringify({ input, mcp_server: "forgegate-github", tool_name: toolName }), name: "call_tool" } }));
    const events = [
      { event: { usage: { toolCalls }, sequence: 1, type: "model.message" }, turnId: "turn-1" },
      ...calls.map(([toolName, input], index) => ({ event: { content: toolName === "get_file" && input.path === "apps/forgegate/src/payment-lab.ts" ? JSON.stringify({ success: false, response: {} }) : JSON.stringify(toolName === "get_pull_request" ? { head: { sha } } : { success: true, response: {} }), isError: toolName === "get_file" && input.path === "apps/forgegate/src/payment-lab.ts", sequence: index + 2, toolCallId: `call-${index}`, type: "tool.response" }, turnId: "turn-1" })),
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 9, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 10, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 11, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(rejected) } }, sequence: 12, type: "turn.done" }, turnId: "turn-1" },
    ];

    const snapshot = projectInvestigation("session-1", "url", events);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("deduplicates repeated artifacts emitted by continuation turns", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha }],
      experimentResults: [{ artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" }],
    };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(bundle) } }, sequence: 2, type: "turn.done" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(bundle) } }, sequence: 3, type: "turn.done" }, turnId: "turn-2" },
    ]);

    expect(snapshot.artifacts).toHaveLength(3);
    expect(snapshot.status).toBe("BLOCKED");
  });

  it("does not silently overwrite conflicting results for the same scenario", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = (charges: number) => ({ artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" as const });

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result(2), sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result(3), sequence: 5, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 6, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts.filter((artifact) => artifact.type === "ExperimentResult")).toHaveLength(2);
    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("rejects conflicting invariants with the same identity", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const conflictingInvariant = { ...invariant, statement: "two charges are allowed" };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: conflictingInvariant, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 5, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 6, state: { status: "done" }, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("ignores experiment results that do not belong to an accepted scenario", () => {
    const sha = "a".repeat(40);
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = (scenarioId: string, seed: number) => ({ artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId, seed, testedSha: sha, verdict: "pass" as const });

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result("s3", 3), sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { ...result("s3", 3), observed: { charges: 2, intents: 1, ledgerEntries: 1 }, verdict: "fail" as const }, sequence: 5, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result("s1", 1), sequence: 6, type: "tool.response" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts.filter((artifact) => artifact.type === "ExperimentResult")).toHaveLength(1);
    expect(snapshot.status).toBe("RUNNING");
  });

  it("reconciles a partial final decision with persisted evidence", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "BLOCKED", experimentResults: [result] }) } }, sequence: 5, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("ignores decisions emitted by subagent turns", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "duplicate charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "BLOCKED", invariants: [invariant], scenarios: [scenario], experimentResults: [result] }) } }, sequence: 5, threadId: "subagent-1", type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("RUNNING");
  });

  it("honors an explicit UNCERTAIN decision from a consistent final bundle", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "UNCERTAIN",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" },
    };

    expect(projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 2, state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" },
    ])).toMatchObject({ decision: "UNCERTAIN", status: "UNCERTAIN" });
  });

  it("fails closed for an invalid explicit UNCERTAIN final", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha };
    const result = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" as const };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: invariant, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: scenario, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: result, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify({ decision: "UNCERTAIN", invalid: true }) } }, sequence: 5, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.decision).toBeUndefined();
    expect(snapshot.status).toBe("UNCERTAIN");
  });

  it("blocks a completed investigation when the experiment verdict fails", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" },
    };

    expect(projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 2, state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" },
    ]).status).toBe("BLOCKED");
  });

  it("reconciles a contradictory READY decision to BLOCKED when evidence fails", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "READY",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge", testedSha: sha }],
      scenarios: [{ expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "fail" },
    };

    expect(projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 2, state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" },
    ])).toMatchObject({ decision: "BLOCKED", status: "BLOCKED" });
  });

  it("blocks duplicate-payment evidence even when the model reports pass", () => {
    const sha = "a".repeat(40);
    const bundle = {
      decision: "BLOCKED",
      invariants: [{ confidence: 1, evidence: [{ endLine: 2, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 4, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 3 }], id: "i1", statement: "one charge per intent", testedSha: sha }],
      scenarios: [{ expectedOutcome: "one charge per intent", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge", "retry"], scenarioId: "s1", seed: 1, testedSha: sha }],
      experimentResult: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 102, intents: 100, ledgerEntries: 100 }, observed: { charges: 102, intents: 100, ledgerEntries: 100 }, repetitions: 1, scenarioId: "s1", seed: 1, testedSha: sha, verdict: "pass" },
    };

    expect(projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 2, state: { output: { content: JSON.stringify(bundle) } }, type: "turn.done" }, turnId: "turn-1" },
    ]).status).toBe("BLOCKED");
  });

  it("aggregates multiple experiment results and blocks when any scenario fails", () => {
    const sha = "a".repeat(40);
    const invariant = { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha };
    const scenarios = [
      { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha },
      { expectedOutcome: "one charge", injectedFaults: ["duplicate webhook"], invariantId: "i1", ordering: ["charge", "webhook"], scenarioId: "s2", seed: 2, testedSha: sha },
    ];
    const result = (scenarioId: string, seed: number, observedCharges: number, verdict: "pass" | "fail") => ({ artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: observedCharges, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId, seed, testedSha: sha, verdict });
    const bundle = { decision: "BLOCKED", invariants: [invariant], scenarios, experimentResults: [result("s1", 1, 1, "pass"), result("s2", 2, 2, "fail")] };

    const snapshot = projectInvestigation("session-1", "url", [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { state: { output: { content: JSON.stringify(bundle) } }, sequence: 2, type: "turn.done" }, turnId: "turn-1" },
    ]);

    expect(snapshot.artifacts.filter((artifact) => artifact.type === "ExperimentResult")).toHaveLength(2);
    expect(snapshot.status).toBe("BLOCKED");
  });

  it("rejects experiment evidence that does not match the PR head SHA", () => {
    const sha = "a".repeat(40);
    const items = [
      { event: { content: JSON.stringify({ head: { sha } }), sequence: 1, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "InvariantCandidate", artifact: { confidence: 1, evidence: [{ endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 }, { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 }], id: "i1", statement: "one charge", testedSha: sha }, sequence: 2, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ScenarioPlan", artifact: { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], seed: 1, testedSha: sha }, sequence: 3, type: "tool.response" }, turnId: "turn-1" },
      { event: { artifactType: "ExperimentResult", artifact: { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 2, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 1, testedSha: "0".repeat(40), verdict: "fail" }, sequence: 4, type: "tool.response" }, turnId: "turn-1" },
      { event: { sequence: 5, state: { status: "blocked" }, type: "turn.done" }, turnId: "turn-1" },
    ];

    expect(projectInvestigation("session-1", "url", items).artifacts.map((artifact) => artifact.type).sort()).toEqual(["InvariantCandidate", "ScenarioPlan"]);
    expect(projectInvestigation("session-1", "url", items).status).toBe("UNCERTAIN");
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

  it("merges model deltas into their base event", () => {
    const snapshot = projectInvestigation("session-1", "url", [
      { event: { baseEventId: "model-1", delta: { content: "complete" }, id: "delta-1", sequence: 2, type: "model.message.delta" }, turnId: "turn-1" },
      { event: { content: "partial", id: "model-1", sequence: 1, type: "model.message" }, turnId: "turn-1" },
    ]);

    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({ eventId: "model-1", payload: { content: "complete" }, sequence: 1 });
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
