import { describe, expect, it, vi } from "vitest";

import { createGitHubReadClient } from "../src/github.js";
import { GitHubPolicyError } from "../src/github-policy.js";

const policy = {
  branchPrefix: "forgegate/demo-",
  maxBytes: 250_000,
  maxFiles: 10,
  allowedPaths: ["apps/forgegate/src/payment-lab.ts", "apps/forgegate/test/payment-lab.test.ts"],
  repository: "beherarajesh90/agent-harness",
};

describe("GitHub commit client", () => {
  it("uses the expected head in the atomic commit when the branch races", async () => {
    const expectedHeadSha = "a".repeat(40);
    let currentHeadSha = expectedHeadSha;
    const createBlob = vi.fn();
    const createCommit = vi.fn();
    const createTree = vi.fn();
    const getCommit = vi.fn();
    const updateRef = vi.fn();
    const graphql = vi.fn(async (_query: string, variables: { expectedHeadOid: string }) => {
      currentHeadSha = "b".repeat(40);
      expect(variables.expectedHeadOid).toBe(expectedHeadSha);
      if (variables.expectedHeadOid !== currentHeadSha) {
        throw new Error("expected head does not match branch head");
      }
    });
    const writeOctokit = {
      graphql,
      rest: {
        git: { createBlob, createCommit, createTree, getCommit, updateRef },
        repos: {
          getBranch: vi.fn(async () => ({ data: { commit: { sha: currentHeadSha } } })),
        },
      },
    };
    const client = createGitHubReadClient({
      octokit: { rest: { pulls: { get: vi.fn() } } } as never,
      policy,
      repository: policy.repository,
      token: "read-token",
      writeOctokit: writeOctokit as never,
      writeToken: "write-token",
    });

    await expect(
      client.commitFiles({
        branch: "forgegate/demo-payment-retry",
        expectedHeadSha,
        files: [{ content: "fix", path: "apps/forgegate/src/payment-lab.ts" }],
        message: "fix: enforce payment idempotency",
        repository: policy.repository,
      }),
    ).rejects.toThrow("expected head does not match branch head");
    expect(graphql).toHaveBeenCalledOnce();
    expect(createBlob).not.toHaveBeenCalled();
    expect(createTree).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    expect(updateRef).not.toHaveBeenCalled();
  });

  it("uses separate clients for GitHub reads and mutations", async () => {
    const readPullRequest = vi.fn(async () => ({ number: 3 }));
    const readOctokit = { rest: { pulls: { get: readPullRequest } } };
    const writeOctokit = {
      graphql: vi.fn(async () => ({
        createCommitOnBranch: { commit: { oid: "c".repeat(40), url: "https://github.com/commit/c" } },
      })),
      rest: {
        git: {
          createBlob: vi.fn(async () => ({ data: { sha: "b".repeat(40) } })),
          createCommit: vi.fn(async () => ({ data: { sha: "c".repeat(40) } })),
          createTree: vi.fn(async () => ({ data: { sha: "d".repeat(40) } })),
          getCommit: vi.fn(async () => ({ data: { tree: { sha: "e".repeat(40) } } })),
          updateRef: vi.fn(),
        },
        repos: {
          getBranch: vi.fn(async () => ({ data: { commit: { sha: "a".repeat(40) } } })),
        },
      },
    };
    const client = createGitHubReadClient({
      octokit: readOctokit as never,
      policy,
      repository: policy.repository,
      token: "read-token",
      writeOctokit: writeOctokit as never,
      writeToken: "write-token",
    });

    await client.getPullRequest(3);
    await client.commitFiles({
      branch: "forgegate/demo-payment-retry",
      expectedHeadSha: "a".repeat(40),
      files: [{ content: "fix", path: "apps/forgegate/src/payment-lab.ts" }],
      message: "fix: enforce payment idempotency",
      repository: policy.repository,
    });

    expect(readPullRequest).toHaveBeenCalledOnce();
    expect(writeOctokit.rest.repos.getBranch).toHaveBeenCalledOnce();
  });

  it("rejects an out-of-scope file before creating a Git blob", async () => {
    const createBlob = vi.fn();
    const octokit = {
      rest: {
        git: { createBlob },
        repos: {
          getBranch: vi.fn(async () => ({ data: { commit: { sha: "a".repeat(40) } } })),
        },
      },
    };
    const client = createGitHubReadClient({
      octokit: octokit as never,
      policy,
      repository: policy.repository,
      token: "test-token",
      writeOctokit: octokit as never,
      writeToken: "test-write-token",
    });

    await expect(
      client.commitFiles({
        branch: "forgegate/demo-payment-retry",
        expectedHeadSha: "a".repeat(40),
      files: [{ content: "unsafe", path: "README.md" }],
        message: "fix: unsafe",
        repository: policy.repository,
      }),
    ).rejects.toThrow(GitHubPolicyError);
    expect(createBlob).not.toHaveBeenCalled();
  });
});
