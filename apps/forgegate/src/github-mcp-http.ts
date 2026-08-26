import { createServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  commitApprovalPayloadSchema,
  createGitHubApprovalStore,
  matchesApprovalSecret,
} from "./github-approval.js";
import type { GitHubApprovalStore } from "./github-approval.js";
import type { CommitFilesInput, CommitFilesResult } from "./github.js";
import { createGitHubMcpServer } from "./github-mcp.js";
import { asMcpTransport } from "./mcp-transport.js";

type GitHubReadClient = {
  commitFiles: (input: CommitFilesInput) => Promise<CommitFilesResult>;
  getChecks: (ref: string) => Promise<unknown>;
  getFile: (path: string, ref: string) => Promise<unknown>;
  getPullRequest: (pullNumber: number) => Promise<unknown>;
  getPullRequestFiles: (pullNumber: number) => Promise<unknown>;
};

export function createGitHubMcpHttpServer(
  github: GitHubReadClient,
  {
    approvalSecret,
    approvalStore = createGitHubApprovalStore(),
  }: { approvalSecret: string; approvalStore?: GitHubApprovalStore },
) {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/approval-capabilities") {
      void issueApproval(request, response, approvalSecret, approvalStore);
      return;
    }
    if (pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }

    const mcpServer = createGitHubMcpServer({
      ...github,
      consumeApproval: approvalStore.consume,
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

async function issueApproval(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  approvalSecret: string,
  approvalStore: GitHubApprovalStore,
) {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  const providedSecret = request.headers["x-forgegate-approval-secret"];
  if (typeof providedSecret !== "string" || !matchesApprovalSecret(providedSecret, approvalSecret)) {
    response.writeHead(401).end();
    return;
  }

  try {
    const payload = commitApprovalPayloadSchema.parse(JSON.parse(await readBody(request)));
    response
      .writeHead(201, { "content-type": "application/json" })
      .end(JSON.stringify({ approvalToken: approvalStore.issue(payload) }));
  } catch {
    response.writeHead(400).end();
  }
}

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 300_000) {
      throw new Error("approval payload is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
