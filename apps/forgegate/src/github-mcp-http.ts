import { createServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { CommitFilesInput, CommitFilesResult } from "./github.js";
import { createGitHubMcpServer } from "./github-mcp.js";
import { asMcpTransport } from "./mcp-transport.js";

type GitHubReadClient = {
  commitFiles: (input: CommitFilesInput) => Promise<CommitFilesResult>;
  getChecks: (ref: string) => Promise<unknown>;
  getFile: (path: string, ref: string) => Promise<unknown>;
  getPullRequest: (pullNumber: number) => Promise<unknown>;
  getPullRequestFiles: (pullNumber: number) => Promise<unknown>;
  getQodoReviews: (pullNumber: number) => Promise<unknown>;
  getReviewComments: (pullNumber: number) => Promise<unknown>;
  repository: string;
};

export function createGitHubMcpHttpServer(
  github: GitHubReadClient,
) {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }

    const mcpServer = createGitHubMcpServer({
      ...github,
    });
    const transport = new StreamableHTTPServerTransport();

    void mcpServer
      .connect(asMcpTransport(transport))
      .then(() => transport.handleRequest(request, response))
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(500).end();
        }
      })
      .finally(() => mcpServer.close());
  });
}
