import { describe, expect, it } from "vitest";

import { createForgeGateAgentSpec, invariantCandidateSchema, scenarioPlanSchema, validateAnalystArtifacts } from "../src/agent-spec.js";

describe("ForgeGate agent specification", () => {
  it("enables only the configured GitHub tools and gates commits", () => {
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b")).toMatchObject({
      config: {
        dynamicSubAgents: { enabled: true },
        sandbox: { enabled: true, fileDownloads: true },
      },
      mcpServers: [
        {
          enableTools: [
            "get_pull_request",
            "get_pull_request_files",
            "get_file",
            "get_checks",
            "get_qodo_reviews",
            "get_review_comments",
            "commit_files",
          ],
          name: "forgegate-github",
          requireApprovalForTools: ["commit_files"],
        },
      ],
      model: { name: "ollama-local/qwen35-4b" },
      skills: [],
    });
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").model.params).toMatchObject({ max_tokens: 4096 });
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").responseFormat).toMatchObject({
      type: "json_schema",
      jsonSchema: { name: "forgegate_investigation", strict: true },
    });
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("InvariantCandidate"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("ScenarioPlan"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("exactly two visible dynamic subagents"));
  });

  it("requires an invariant to cite two files at the tested SHA", () => {
    const candidate = {
      confidence: 0.95,
      evidence: [
        { endLine: 84, path: "apps/forgegate/src/payment-lab.ts", sha: "a".repeat(40), startLine: 50 },
        { endLine: 102, path: "apps/forgegate/test/payment-lab.test.ts", sha: "a".repeat(40), startLine: 82 },
      ],
      id: "payment-one-charge",
      statement: "One payment intent produces exactly one charge.",
      testedSha: "a".repeat(40),
    };

    expect(invariantCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(invariantCandidateSchema.safeParse({ ...candidate, evidence: candidate.evidence.slice(0, 1) }).success).toBe(false);
    expect(invariantCandidateSchema.safeParse({ ...candidate, testedSha: "master" }).success).toBe(false);
  });

  it("requires a deterministic scenario tied to the tested SHA", () => {
    const scenario = {
      expectedOutcome: "one payment intent must produce one charge",
      injectedFaults: ["provider timeout", "duplicate webhook", "concurrent retry"],
      invariantId: "payment-one-charge",
      ordering: ["charge", "timeout", "retry", "webhook"],
      seed: 42,
      testedSha: "a".repeat(40),
    };

    expect(scenarioPlanSchema.parse(scenario)).toEqual(scenario);
    expect(scenarioPlanSchema.safeParse({ ...scenario, seed: 1.5 }).success).toBe(false);
    expect(scenarioPlanSchema.safeParse({ ...scenario, injectedFaults: [] }).success).toBe(false);
  });

  it("accepts only scenarios linked to validated invariant artifacts", () => {
    const sha = "a".repeat(40);
    const invariant = {
      confidence: 0.95,
      evidence: [
        { endLine: 84, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 50 },
        { endLine: 102, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 82 },
      ],
      id: "payment-one-charge",
      statement: "One payment intent produces exactly one charge.",
      testedSha: sha,
    };
    const scenario = {
      expectedOutcome: "one payment intent must produce one charge",
      injectedFaults: ["provider timeout"],
      invariantId: invariant.id,
      ordering: ["charge", "timeout"],
      seed: 42,
      testedSha: sha,
    };

    expect(validateAnalystArtifacts({ invariants: [invariant], scenarios: [scenario] })).toEqual({ invariants: [invariant], scenarios: [scenario] });
    expect(() => validateAnalystArtifacts({ invariants: [invariant], scenarios: [{ ...scenario, invariantId: "unknown" }] })).toThrow("accepted invariant");
  });
});
