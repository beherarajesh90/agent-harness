import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CommitApprovalPayload } from "./github-approval.js";
import type { CommitFilesInput, CommitFilesResult } from "./github.js";

export function createGitHubMcpServer({
  commitFiles,
  consumeApproval,
  getPullRequest,
}: {
  commitFiles: (input: CommitFilesInput) => Promise<CommitFilesResult>;
  consumeApproval: (token: string, payload: CommitApprovalPayload) => boolean;
  getPullRequest: (pullNumber: number) => Promise<unknown>;
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
