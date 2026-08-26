import { describe, expect, it } from "vitest";

import { createGitHubApprovalStore } from "../src/github-approval.js";

const payload = {
  branch: "forgegate/demo-payment-retry",
  expectedHeadSha: "a".repeat(40),
  files: [{ content: "fix", path: "payment-lab/retry.ts" }],
  message: "fix: enforce payment idempotency",
  repository: "beherarajesh90/agent-harness",
};

describe("GitHub approval store", () => {
  it("consumes an approval once for the exact payload", () => {
    const store = createGitHubApprovalStore();
    const token = store.issue(payload);

    expect(store.consume(token, payload)).toBe(true);
    expect(store.consume(token, payload)).toBe(false);
  });

  it("burns a token when the payload does not match", () => {
    const store = createGitHubApprovalStore();
    const token = store.issue(payload);

    expect(store.consume(token, { ...payload, message: "tampered" })).toBe(false);
    expect(store.consume(token, payload)).toBe(false);
  });
});
