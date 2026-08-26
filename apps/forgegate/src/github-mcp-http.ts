import { createServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createGitHubMcpServer } from "./github-mcp.js";
import { asMcpTransport } from "./mcp-transport.js";

type GitHubReadClient = {
  getPullRequest: (pullNumber: number) => Promise<unknown>;
};

export function createGitHubMcpHttpServer(github: GitHubReadClient) {
  return createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }

    const mcpServer = createGitHubMcpServer(github);
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
