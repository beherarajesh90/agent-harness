import { describe, expect, it } from "vitest";

import { createForgeGateAgentSpec, invariantCandidateSchema } from "../src/agent-spec.js";

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
      responseFormat: { type: "json_object" },
      skills: [{ name: "forgegate" }],
    });
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
});
