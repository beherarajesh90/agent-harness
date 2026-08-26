import { describe, expect, it } from "vitest";

import {
  GitHubPolicyError,
  assertGitHubMutationAllowed,
  createGitHubMutationPolicy,
} from "../src/github-policy.js";

const policy = {
  branchPrefix: "forgegate/demo-",
  maxBytes: 250_000,
  maxFiles: 10,
  pathPrefix: "payment-lab/",
  repository: "beherarajesh90/agent-harness",
};
const sha = "a".repeat(40);

describe("assertGitHubMutationAllowed", () => {
  it("allows an in-scope commit at the tested PR head", () => {
    expect(() =>
      assertGitHubMutationAllowed(policy, {
        actualHeadSha: sha,
        branch: "forgegate/demo-payment-retry",
        expectedHeadSha: sha,
        files: [{ content: "export const retry = true;", path: "payment-lab/retry.ts" }],
        operation: "commit_files",
        repository: "beherarajesh90/agent-harness",
      }),
    ).not.toThrow();
  });

  it("allows a Qodo review request without changed files", () => {
    expect(() =>
      assertGitHubMutationAllowed(policy, {
        actualHeadSha: sha,
        branch: "forgegate/demo-payment-retry",
        expectedHeadSha: sha,
        files: [],
        operation: "request_qodo_review",
        repository: "beherarajesh90/agent-harness",
      }),
    ).not.toThrow();
  });

  it.each([
    ["a different repository", { repository: "attacker/other" }],
    ["a branch outside the demo prefix", { branch: "main" }],
    ["a stale tested SHA", { actualHeadSha: "b".repeat(40) }],
    ["an unapproved GitHub operation", { operation: "merge_pull_request" }],
    ["a workflow path", { files: [{ content: "name: unsafe", path: ".github/workflows/pwn.yml" }] }],
    ["a traversal path", { files: [{ content: "x", path: "payment-lab/../README.md" }] }],
    ["more than ten files", { files: Array.from({ length: 11 }, (_, index) => ({ content: "x", path: `payment-lab/${index}.ts` })) }],
    ["a payload above the byte limit", { files: [{ content: "x".repeat(250_001), path: "payment-lab/large.ts" }] }],
  ])("rejects %s", (_description, override) => {
    expect(() =>
      assertGitHubMutationAllowed(policy, {
        actualHeadSha: sha,
        branch: "forgegate/demo-payment-retry",
        expectedHeadSha: sha,
        files: [{ content: "export const retry = true;", path: "payment-lab/retry.ts" }],
        operation: "commit_files",
        repository: "beherarajesh90/agent-harness",
        ...override,
      }),
    ).toThrow(GitHubPolicyError);
  });
});

describe("createGitHubMutationPolicy", () => {
  it.each([
    ["an empty branch prefix", { branchPrefix: "" }],
    ["an empty path prefix", { pathPrefix: "" }],
    ["a NaN file limit", { maxFiles: Number.NaN }],
    ["an infinite byte limit", { maxBytes: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_description, override) => {
    expect(() => createGitHubMutationPolicy({ ...policy, ...override })).toThrow(GitHubPolicyError);
  });
});
