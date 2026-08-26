import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function createGitHubMcpServer({
  getPullRequest,
}: {
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

  return server;
}
