import { describe, expect, it, vi } from "vitest";

import { createGitHubReadClient } from "../src/github.js";
import { GitHubPolicyError } from "../src/github-policy.js";

const policy = {
  branchPrefix: "forgegate/demo-",
  maxBytes: 250_000,
  maxFiles: 10,
  pathPrefix: "payment-lab/",
  repository: "beherarajesh90/agent-harness",
};

describe("GitHub commit client", () => {
  it("uses separate clients for GitHub reads and mutations", async () => {
    const readPullRequest = vi.fn(async () => ({ number: 3 }));
    const readOctokit = { rest: { pulls: { get: readPullRequest } } };
    const writeOctokit = {
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
      files: [{ content: "fix", path: "payment-lab/retry.ts" }],
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
