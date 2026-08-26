import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CommitApprovalPayload } from "./github-approval.js";
import type { CommitFilesInput, CommitFilesResult } from "./github.js";

export function createGitHubMcpServer({
  commitFiles,
  consumeApproval,
  getChecks,
  getFile,
  getPullRequest,
  getPullRequestFiles,
  getQodoReviews,
  getReviewComments,
}: {
  commitFiles: (input: CommitFilesInput) => Promise<CommitFilesResult>;
  consumeApproval: (token: string, payload: CommitApprovalPayload) => boolean;
  getChecks: (ref: string) => Promise<unknown>;
  getFile: (path: string, ref: string) => Promise<unknown>;
  getPullRequest: (pullNumber: number) => Promise<unknown>;
  getPullRequestFiles: (pullNumber: number) => Promise<unknown>;
  getQodoReviews: (pullNumber: number) => Promise<unknown>;
  getReviewComments: (pullNumber: number) => Promise<unknown>;
}) {
  const server = new McpServer({ name: "forgegate-github", version: "0.1.0" });

  server.registerTool(
    "get_pull_request",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: "Read one pull request from the configured ForgeGate demo repository.",
      inputSchema: z.object({ pull_number: z.number().int().positive() }),
    },
    async ({ pull_number }) => {
      try {
        const pullRequest = await getPullRequest(pull_number);
        return {
          content: [{ text: JSON.stringify(pullRequest) ?? "null", type: "text" }],
        };
      } catch {
        return {
          content: [{ text: "GitHub pull request read failed.", type: "text" }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_qodo_reviews",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: "Read pull request reviews for later Qodo-origin classification.",
      inputSchema: z.object({ pull_number: z.number().int().positive() }),
    },
    async ({ pull_number }) => {
      try {
        return { content: [{ text: JSON.stringify(await getQodoReviews(pull_number)), type: "text" }] };
      } catch {
        return { content: [{ text: "GitHub pull request reviews read failed.", type: "text" }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_review_comments",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: "Read pull request review comments for later Qodo-origin classification.",
      inputSchema: z.object({ pull_number: z.number().int().positive() }),
    },
    async ({ pull_number }) => {
      try {
        return { content: [{ text: JSON.stringify(await getReviewComments(pull_number)), type: "text" }] };
      } catch {
        return { content: [{ text: "GitHub review comments read failed.", type: "text" }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_pull_request_files",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: "Read the changed files for one pull request from the configured repository.",
      inputSchema: z.object({ pull_number: z.number().int().positive() }),
    },
    async ({ pull_number }) => {
      try {
        return { content: [{ text: JSON.stringify(await getPullRequestFiles(pull_number)), type: "text" }] };
      } catch {
        return { content: [{ text: "GitHub pull request files read failed.", type: "text" }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_file",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: "Read one repository file at an exact Git ref.",
      inputSchema: z.object({ path: z.string().min(1), ref: z.string().min(1) }),
    },
    async ({ path, ref }) => {
      try {
        return { content: [{ text: JSON.stringify(await getFile(path, ref)), type: "text" }] };
      } catch {
        return { content: [{ text: "GitHub file read failed.", type: "text" }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_checks",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: "Read check runs for an exact Git ref.",
      inputSchema: z.object({ ref: z.string().min(1) }),
    },
    async ({ ref }) => {
      try {
        return { content: [{ text: JSON.stringify(await getChecks(ref)), type: "text" }] };
      } catch {
        return { content: [{ text: "GitHub checks read failed.", type: "text" }], isError: true };
      }
    },
  );

  server.registerTool(
    "commit_files",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: "Commit bounded payment-lab files to the configured demo branch after TrueForge approval.",
      inputSchema: z.object({
        branch: z.string().min(1),
        expected_head_sha: z.string().length(40),
        files: z.array(z.object({ content: z.string(), path: z.string().min(1) })).min(1),
        message: z.string().min(1).max(200),
        repository: z.string().min(1),
        approval_token: z.string().min(1),
      }),
    },
    async ({ approval_token, branch, expected_head_sha, files, message, repository }) => {
      try {
        const input = {
          branch,
          expectedHeadSha: expected_head_sha,
          files,
          message,
          repository,
        };
        if (!consumeApproval(approval_token, input)) {
          throw new Error("approval is missing, stale, or does not match the commit payload");
        }
        const result = await commitFiles(input);
        return { content: [{ text: JSON.stringify(result), type: "text" }] };
      } catch {
        return {
          content: [{ text: "GitHub commit rejected by policy or failed.", type: "text" }],
          isError: true,
        };
      }
    },
  );

  return server;
}
