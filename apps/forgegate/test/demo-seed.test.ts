import { describe, expect, it } from "vitest";

import { seedDemo } from "../src/demo-seed.js";

const safePaymentLabSource = `
const unsafeRetry = attempt === 1 && options.unsafeRetryForIntentIds?.has(input.intentId);
const providerIdempotencyKey = unsafeRetry
  ? \`${"${input.idempotencyKey"}}:retry-\${attempt}\`
  : input.idempotencyKey;
`;

describe("seedDemo", () => {
  it("creates a fresh unsafe retry PR from master", async () => {
    const calls: string[] = [];
    const client = {
      async createBranch(branch: string, sha: string) {
        calls.push(`branch:${branch}:${sha}`);
      },
      async createPullRequest(input: { base: string; body: string; head: string; title: string }) {
        calls.push(`pr:${input.head}:${input.base}`);
        return { number: 42, url: "https://github.com/beherarajesh90/agent-harness/pull/42" };
      },
      async getBranch(branch: string) {
        calls.push(`read-branch:${branch}`);
        return { sha: "a".repeat(40) };
      },
      async getFile(path: string, ref: string) {
        calls.push(`read-file:${path}:${ref}`);
        return { content: safePaymentLabSource, sha: "b".repeat(40) };
      },
      async updateFile(input: { branch: string; content: string; message: string; path: string; sha: string }) {
        calls.push(`commit:${input.branch}:${input.path}:${input.sha}`);
        expect(input.content).toContain("const unsafeRetry = attempt === 1;");
      },
    };

    await expect(
      seedDemo({
        client,
        now: new Date("2026-08-26T12:34:56.789Z"),
      }),
    ).resolves.toEqual({
      branch: "forgegate/demo-20260826-123456789",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/beherarajesh90/agent-harness/pull/42",
    });
    expect(calls).toEqual([
      "read-branch:master",
      `read-file:apps/forgegate/src/payment-lab.ts:${"a".repeat(40)}`,
      `branch:forgegate/demo-20260826-123456789:${"a".repeat(40)}`,
      `commit:forgegate/demo-20260826-123456789:apps/forgegate/src/payment-lab.ts:${"b".repeat(40)}`,
      "pr:forgegate/demo-20260826-123456789:master",
    ]);
  });

  it("refuses to create a branch when master lacks the safe retry marker", async () => {
    const createBranch = async () => {
      throw new Error("must not create branch");
    };

    await expect(
      seedDemo({
        client: {
          createBranch,
          createPullRequest: async () => ({ number: 42, url: "unused" }),
          getBranch: async () => ({ sha: "a".repeat(40) }),
          getFile: async () => ({ content: "export const unrelated = true;", sha: "b".repeat(40) }),
          updateFile: async () => undefined,
        },
        now: new Date("2026-08-26T12:34:56.789Z"),
      }),
    ).rejects.toThrow("safe retry marker was not found on master");
  });
});
