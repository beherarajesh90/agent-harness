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
