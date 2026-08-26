import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";

import { createGitHubMcpServer } from "../src/github-mcp.js";
import { createGitHubMcpHttpServer } from "../src/github-mcp-http.js";
import { createGitHubApprovalStore } from "../src/github-approval.js";
import { asMcpTransport } from "../src/mcp-transport.js";

describe("GitHub MCP server", () => {
  it("connects the HTTP transport through the exact-optional adapter", async () => {
    const server = new McpServer({ name: "forgegate-test", version: "1.0.0" });
    const transport = new StreamableHTTPServerTransport();

    await expect(server.connect(asMcpTransport(transport))).resolves.toBeUndefined();
    expect(transport.onmessage).toEqual(expect.any(Function));

    await server.close();
  });

  it("serves separate stateless HTTP requests", async () => {
    const getPullRequest = vi.fn(async (pullNumber: number) => ({ number: pullNumber }));
    const getPullRequestFiles = vi.fn(async (pullNumber: number) => [{ pullNumber }]);
    const getFile = vi.fn(async (path: string, ref: string) => ({ content: "source", path, ref }));
    const getChecks = vi.fn(async (ref: string) => ({ check_runs: [{ ref }] }));
    const getQodoReviews = vi.fn(async (pullNumber: number) => [{ pullNumber, reviewer: "qodo" }]);
    const getReviewComments = vi.fn(async (pullNumber: number) => [{ body: "review", pullNumber }]);
    const approvalStore = createGitHubApprovalStore();
    const server = createGitHubMcpHttpServer(
      { getChecks, getFile, getPullRequest, getPullRequestFiles, getQodoReviews, getReviewComments, commitFiles: vi.fn() },
      { approvalSecret: "test-secret", approvalStore },
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP address");
    }

    const client = new Client({ name: "forgegate-test", version: "1.0.0" });
    await client.connect(
      // @ts-expect-error MCP SDK 1.30.0 HTTP client declarations conflict with exactOptionalPropertyTypes.
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)),
    );

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [
        expect.objectContaining({ name: "get_pull_request" }),
        expect.objectContaining({ name: "get_qodo_reviews" }),
        expect.objectContaining({ name: "get_review_comments" }),
        expect.objectContaining({ name: "get_pull_request_files" }),
        expect.objectContaining({ name: "get_file" }),
        expect.objectContaining({ name: "get_checks" }),
        expect.objectContaining({ name: "commit_files" }),
      ],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_pull_request" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ number: 42 }), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_pull_request_files" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify([{ pullNumber: 42 }]), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { path: "apps/forgegate/src/payment-lab.ts", ref: "a".repeat(40) }, name: "get_file" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ content: "source", path: "apps/forgegate/src/payment-lab.ts", ref: "a".repeat(40) }), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { ref: "a".repeat(40) }, name: "get_checks" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ check_runs: [{ ref: "a".repeat(40) }] }), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_qodo_reviews" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify([{ pullNumber: 42, reviewer: "qodo" }]), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_review_comments" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify([{ body: "review", pullNumber: 42 }]), type: "text" }],
    });

    const payload = {
      branch: "forgegate/demo-payment-retry",
      expectedHeadSha: "a".repeat(40),
      files: [{ content: "fix", path: "apps/forgegate/src/payment-lab.ts" }],
      message: "fix: enforce payment idempotency",
      repository: "beherarajesh90/agent-harness",
    };
    await expect(
      fetch(`http://127.0.0.1:${address.port}/approval-capabilities`, {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json", "x-forgegate-approval-secret": "wrong" },
        method: "POST",
      }),
    ).resolves.toMatchObject({ status: 401 });
    const approvalResponse = await fetch(`http://127.0.0.1:${address.port}/approval-capabilities`, {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", "x-forgegate-approval-secret": "test-secret" },
      method: "POST",
    });
    expect(approvalResponse.status).toBe(201);
    await expect(approvalResponse.json()).resolves.toEqual({ approvalToken: expect.any(String) });

    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("exposes and executes the read-only pull request tool", async () => {
    const getPullRequest = vi.fn(async (pullNumber: number) => ({
      number: pullNumber,
      title: "Fix payment retry idempotency",
    }));
    const getPullRequestFiles = vi.fn(async (pullNumber: number) => [{ number: pullNumber }]);
    const getFile = vi.fn(async (path: string, ref: string) => ({ path, ref }));
    const getChecks = vi.fn(async (ref: string) => ({ ref }));
    const getQodoReviews = vi.fn(async (pullNumber: number) => [{ pullNumber }]);
    const getReviewComments = vi.fn(async (pullNumber: number) => [{ pullNumber }]);
    const commitFiles = vi.fn(async () => ({
      commitSha: "b".repeat(40),
      url: "https://github.com/beherarajesh90/agent-harness/commit/" + "b".repeat(40),
    }));
    const approvalStore = createGitHubApprovalStore();
    const server = createGitHubMcpServer({
      commitFiles,
      consumeApproval: approvalStore.consume,
      getChecks,
      getFile,
      getPullRequest,
      getPullRequestFiles,
      getQodoReviews,
      getReviewComments,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "forgegate-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [
        expect.objectContaining({ name: "get_pull_request" }),
        expect.objectContaining({ name: "get_qodo_reviews" }),
        expect.objectContaining({ name: "get_review_comments" }),
        expect.objectContaining({ name: "get_pull_request_files" }),
        expect.objectContaining({ name: "get_file" }),
        expect.objectContaining({ name: "get_checks" }),
        expect.objectContaining({ name: "commit_files" }),
      ],
    });

    await expect(
      client.callTool({
        arguments: { pull_number: 42 },
        name: "get_pull_request",
      }),
    ).resolves.toMatchObject({
      content: [
        {
          text: JSON.stringify({ number: 42, title: "Fix payment retry idempotency" }),
          type: "text",
        },
      ],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_pull_request_files" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify([{ number: 42 }]), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { path: "payment-lab.ts", ref: "a".repeat(40) }, name: "get_file" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ path: "payment-lab.ts", ref: "a".repeat(40) }), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { ref: "a".repeat(40) }, name: "get_checks" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ ref: "a".repeat(40) }), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_qodo_reviews" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify([{ pullNumber: 42 }]), type: "text" }],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_review_comments" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify([{ pullNumber: 42 }]), type: "text" }],
    });

    const commitPayload = {
      branch: "forgegate/demo-payment-retry",
      expectedHeadSha: "a".repeat(40),
      files: [{ content: "fix", path: "apps/forgegate/src/payment-lab.ts" }],
      message: "fix: enforce payment idempotency",
      repository: "beherarajesh90/agent-harness",
    };
    const approvalToken = approvalStore.issue(commitPayload);

    await expect(
      client.callTool({
        arguments: {
          approval_token: approvalToken,
          branch: commitPayload.branch,
          expected_head_sha: commitPayload.expectedHeadSha,
          files: commitPayload.files,
          message: commitPayload.message,
          repository: commitPayload.repository,
        },
        name: "commit_files",
      }),
    ).resolves.toMatchObject({
      content: [
        {
          text: JSON.stringify({
            commitSha: "b".repeat(40),
            url: "https://github.com/beherarajesh90/agent-harness/commit/" + "b".repeat(40),
          }),
          type: "text",
        },
      ],
    });
    expect(commitFiles).toHaveBeenCalledOnce();

    await expect(
      client.callTool({
        arguments: {
          approval_token: approvalToken,
          branch: commitPayload.branch,
          expected_head_sha: commitPayload.expectedHeadSha,
          files: commitPayload.files,
          message: commitPayload.message,
          repository: commitPayload.repository,
        },
        name: "commit_files",
      }),
    ).resolves.toMatchObject({ isError: true });
    expect(commitFiles).toHaveBeenCalledOnce();
    expect(getPullRequest).toHaveBeenCalledWith(42);

    await client.close();
    await server.close();
  });
});
