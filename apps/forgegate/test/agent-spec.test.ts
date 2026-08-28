import { describe, expect, it } from "vitest";

import { createForgeGateAgentSpec, deduplicateScenarioPlans, experimentResultSchema, investigationResponseSchema, invariantCandidateSchema, scenarioPlanSchema, validateAnalystArtifacts, validateInvestigationArtifacts } from "../src/agent-spec.js";

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
          preload: true,
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
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("evidence objects use sha"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("injectedFaults is string[]"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("expectedOutcome is a string"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("payment-lab:evidence"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("Run the baseline payment test on master before checking out the exact PR head SHA"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("Mark the verdict fail when the observed counts violate an accepted invariant"));
    expect(createForgeGateAgentSpec("ollama-local/qwen35-4b").instructions).toMatchObject(expect.stringContaining("primary agent must complete all GitHub MCP reads and sandbox execution before spawning subagents"));
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
    expect(invariantCandidateSchema.safeParse({ ...candidate, evidence: [candidate.evidence[0], candidate.evidence[0]] }).success).toBe(false);
    expect(invariantCandidateSchema.safeParse({ ...candidate, evidence: [{ ...candidate.evidence[0], path: "README.md" }, candidate.evidence[1]] }).success).toBe(false);
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

  it("deduplicates scenarios by normalized execution identity and applies a bound", () => {
    const sha = "a".repeat(40);
    const scenarios = [
      { expectedOutcome: "one charge", injectedFaults: ["timeout", "retry"], invariantId: "i1", ordering: ["charge", "retry"], seed: 1, testedSha: sha },
      { expectedOutcome: "same scenario", injectedFaults: [" retry ", "timeout"], invariantId: "i1", ordering: ["charge", "retry"], seed: 1, testedSha: sha },
      { expectedOutcome: "different seed", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], seed: 2, testedSha: sha },
    ];

    expect(deduplicateScenarioPlans(scenarios, 2)).toHaveLength(2);
    expect(deduplicateScenarioPlans(scenarios, 2)[0]).toEqual(scenarios[0]);
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

  it("requires experiment evidence to match the accepted artifact set", () => {
    const sha = "a".repeat(40);
    const invariant = {
      confidence: 1,
      evidence: [
        { endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 },
        { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 },
      ],
      id: "i1",
      statement: "one charge",
      testedSha: sha,
    };
    const scenario = { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], seed: 1, testedSha: sha };
    const experimentResult = { artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, seed: 1, testedSha: sha, verdict: "pass" as const };

    expect(validateInvestigationArtifacts({ invariants: [invariant], scenarios: [scenario], experimentResult })).toMatchObject({ experimentResult });
    expect(investigationResponseSchema.safeParse({ decision: "BLOCKED", invariants: [invariant], scenarios: [scenario], experimentResults: [experimentResult] }).success).toBe(false);
    expect(investigationResponseSchema.safeParse({ decision: "BLOCKED", invariants: [invariant], scenarios: [scenario], experimentResult, experimentResults: [experimentResult] }).success).toBe(false);
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios: [scenario], experimentResult, experimentResults: [experimentResult] })).toThrow("choose either experimentResult or experimentResults");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios: [{ ...scenario, seed: 2 }], experimentResult })).toThrow("experiment seed");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios: [scenario], experimentResult: { ...experimentResult, baselineSha: sha } })).toThrow("baseline SHA");
  });

  it("validates one result for every uniquely identified scenario", () => {
    const sha = "a".repeat(40);
    const invariant = {
      confidence: 1,
      evidence: [
        { endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 },
        { endLine: 2, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 },
      ],
      id: "i1",
      statement: "one charge",
      testedSha: sha,
    };
    const scenarios = [
      { expectedOutcome: "one charge", injectedFaults: ["timeout"], invariantId: "i1", ordering: ["charge"], scenarioId: "s1", seed: 1, testedSha: sha },
      { expectedOutcome: "one charge", injectedFaults: ["duplicate webhook"], invariantId: "i1", ordering: ["charge", "webhook"], scenarioId: "s2", seed: 2, testedSha: sha },
    ];
    const result = (scenarioId: string, seed: number, verdict: "pass" | "fail") => ({
      artifactLinks: ["payment-lab:evidence"], baselineSha: "b".repeat(40), expected: { charges: 1, intents: 1, ledgerEntries: 1 }, observed: { charges: 1, intents: 1, ledgerEntries: 1 }, repetitions: 1, scenarioId, seed, testedSha: sha, verdict,
    });

    expect(validateInvestigationArtifacts({ invariants: [invariant], scenarios, experimentResults: [result("s1", 1, "pass"), result("s2", 2, "pass")] }).experimentResults).toHaveLength(2);
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios: [{ ...scenarios[0] }, { ...scenarios[1], scenarioId: "s1" }], experimentResults: [result("s1", 1, "pass"), result("s1", 1, "pass")] })).toThrow("duplicate scenario ID");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios, experimentResults: [result("s1", 1, "pass"), result("s1", 1, "pass")] })).toThrow("duplicate experiment result ID");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios, experimentResults: [result("s1", 1, "pass"), result("s2", 3, "pass")] })).toThrow("experiment seed");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios, experimentResults: [result("s1", 1, "pass"), { ...result("s2", 2, "pass"), expected: { charges: 2, intents: 1, ledgerEntries: 1 } }] })).toThrow("same baseline measurements");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios, experimentResults: [result("s1", 1, "pass"), { ...result("s2", 2, "pass"), baselineSha: "c".repeat(40) }] })).toThrow("same baseline SHA");
    expect(() => validateInvestigationArtifacts({ invariants: [invariant], scenarios, experimentResults: [result("s1", 1, "pass")] })).toThrow("every scenario");
  });

  it("allows UNCERTAIN without inventing unavailable evidence", () => {
    expect(investigationResponseSchema.parse({ decision: "UNCERTAIN" })).toEqual({ decision: "UNCERTAIN" });
  });

  it("rejects placeholder analyst artifacts", () => {
    const sha = "a".repeat(40);
    const placeholder = {
      confidence: 0,
      evidence: [
        { endLine: 1, path: "apps/forgegate/src/payment-lab.ts", sha, startLine: 1 },
        { endLine: 1, path: "apps/forgegate/test/payment-lab.test.ts", sha, startLine: 1 },
      ],
      id: "placeholder",
      statement: "Invariant placeholder",
      testedSha: sha,
    };

    expect(() => validateAnalystArtifacts({ invariants: [placeholder], scenarios: [] })).toThrow();
  });

  it("rejects prose in experiment artifact links", () => {
    const result = {
      artifactLinks: ["Please note that required evidence is missing."],
      expected: { charges: 102, intents: 100, ledgerEntries: 100 },
      observed: { charges: 102, intents: 100, ledgerEntries: 100 },
      repetitions: 20,
      seed: 103,
      testedSha: "a".repeat(40),
      verdict: "fail" as const,
    };

    expect(experimentResultSchema.safeParse(result).success).toBe(false);
  });
});
