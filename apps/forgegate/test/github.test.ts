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
  it("reads pull request reviews and review comments for Qodo classification", async () => {
    const listReviews = vi.fn(async ({ page }: { page: number }) => ({
      data: page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id, user: { login: "qodo" }, state: "COMMENTED" })) : [{ id: 101, user: { login: "qodo" }, state: "APPROVED" }],
    }));
    const listReviewComments = vi.fn(async ({ page }: { page: number }) => ({
      data: page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id, body: "review" })) : [{ id: 12, body: "Add a regression test" }],
    }));
    const octokit = {
      rest: {
        pulls: { get: vi.fn(), listReviewComments, listReviews },
      },
    };
    const client = createGitHubReadClient({
      octokit: octokit as never,
      policy,
      repository: policy.repository,
      token: "read-token",
      writeOctokit: octokit as never,
      writeToken: "write-token",
    });

    await expect(client.getQodoReviews(7)).resolves.toMatchObject({
      complete: true,
      reviews: [...Array.from({ length: 100 }, (_, id) => ({ id, user: { login: "qodo" }, state: "COMMENTED" })), { id: 101, user: { login: "qodo" }, state: "APPROVED" }],
      truncated: false,
    });
    await expect(client.getReviewComments(7)).resolves.toMatchObject({
      comments: [...Array.from({ length: 100 }, (_, id) => ({ id, body: "review" })), { id: 12, body: "Add a regression test" }],
      complete: true,
      truncated: false,
    });
    expect(listReviews).toHaveBeenNthCalledWith(1, { owner: "beherarajesh90", page: 1, per_page: 100, pull_number: 7, repo: "agent-harness" });
    expect(listReviews).toHaveBeenNthCalledWith(2, { owner: "beherarajesh90", page: 2, per_page: 100, pull_number: 7, repo: "agent-harness" });
    expect(listReviewComments).toHaveBeenNthCalledWith(1, { owner: "beherarajesh90", page: 1, per_page: 100, pull_number: 7, repo: "agent-harness" });
    expect(listReviewComments).toHaveBeenNthCalledWith(2, { owner: "beherarajesh90", page: 2, per_page: 100, pull_number: 7, repo: "agent-harness" });
  });

  it("reads PR files, SHA-pinned file contents, and checks", async () => {
    const listFiles = vi.fn(async ({ page }: { page: number }) => ({
      data:
        page === 1
          ? Array.from({ length: 100 }, (_, index) => ({ filename: `file-${index}.ts`, sha: "a".repeat(40), status: "modified" }))
          : [{ filename: "apps/forgegate/src/payment-lab.ts", sha: "a".repeat(40), status: "modified" }],
    }));
    const getContent = vi.fn(async () => ({
      data: {
        content: Buffer.from("payment source", "utf8").toString("base64"),
        encoding: "base64",
        path: "apps/forgegate/src/payment-lab.ts",
        sha: "b".repeat(40),
        type: "file",
      },
    }));
    const listForRef = vi.fn(async () => ({ data: { check_runs: [{ name: "tests", conclusion: "success" }] } }));
    const octokit = {
      rest: {
        checks: { listForRef },
        pulls: { get: vi.fn(), listFiles },
        repos: { getContent },
      },
    };
    const client = createGitHubReadClient({
      octokit: octokit as never,
      policy,
      repository: policy.repository,
      token: "read-token",
      writeOctokit: octokit as never,
      writeToken: "write-token",
    });

    await expect(client.getPullRequestFiles(7)).resolves.toMatchObject({
      complete: true,
      files: [
        ...Array.from({ length: 100 }, (_, index) => ({ filename: `file-${index}.ts`, sha: "a".repeat(40), status: "modified" })),
        { filename: "apps/forgegate/src/payment-lab.ts", sha: "a".repeat(40), status: "modified" },
      ],
      truncated: false,
    });
    await expect(client.getFile("apps/forgegate/src/payment-lab.ts", "b".repeat(40))).resolves.toEqual({
      lineNumberedContent: "1 | payment source",
      path: "apps/forgegate/src/payment-lab.ts",
      sha: "b".repeat(40),
    });
    await expect(client.getFile("apps/forgegate/src/payment-lab.ts", "main")).rejects.toThrow("commit SHA");
    expect(getContent).toHaveBeenCalledOnce();
    await expect(client.getChecks("b".repeat(40))).resolves.toEqual({
      check_runs: [{ name: "tests", conclusion: "success" }],
    });
    expect(listFiles).toHaveBeenNthCalledWith(1, { owner: "beherarajesh90", page: 1, per_page: 100, pull_number: 7, repo: "agent-harness" });
    expect(listFiles).toHaveBeenNthCalledWith(2, { owner: "beherarajesh90", page: 2, per_page: 100, pull_number: 7, repo: "agent-harness" });
    expect(getContent).toHaveBeenCalledWith({ owner: "beherarajesh90", path: "apps/forgegate/src/payment-lab.ts", ref: "b".repeat(40), repo: "agent-harness" });
    expect(listForRef).toHaveBeenCalledWith({ owner: "beherarajesh90", per_page: 100, ref: "b".repeat(40), repo: "agent-harness" });
  });

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
