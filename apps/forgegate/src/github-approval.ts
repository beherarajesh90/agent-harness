import { timingSafeEqual, randomUUID } from "node:crypto";

import { z } from "zod";

import type { CommitFilesInput } from "./github.js";

export type CommitApprovalPayload = CommitFilesInput;

export const commitApprovalPayloadSchema = z
  .object({
    branch: z.string().min(1),
    expectedHeadSha: z.string().length(40),
    files: z.array(z.object({ content: z.string(), path: z.string().min(1) })).min(1),
    message: z.string().min(1).max(200),
    repository: z.string().min(1),
  })
  .strict();

export type GitHubApprovalStore = {
  issue: (payload: CommitApprovalPayload) => string;
  consume: (token: string, payload: CommitApprovalPayload) => boolean;
};

function payloadKey(payload: CommitApprovalPayload) {
  return JSON.stringify({
    branch: payload.branch,
    expectedHeadSha: payload.expectedHeadSha,
    files: payload.files,
    message: payload.message,
    repository: payload.repository,
  });
}

export function createGitHubApprovalStore(): GitHubApprovalStore {
  const approvals = new Map<string, string>();

  return {
    consume(token, payload) {
      const expected = approvals.get(token);
      approvals.delete(token);
      return expected !== undefined && expected === payloadKey(payload);
    },
    issue(payload) {
      const token = randomUUID();
      approvals.set(token, payloadKey(payload));
      return token;
    },
  };
}

export function matchesApprovalSecret(actual: string | undefined, expected: string) {
  if (!actual) {
    return false;
  }

  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
