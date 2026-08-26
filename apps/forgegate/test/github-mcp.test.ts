import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";

import { createGitHubMcpServer } from "../src/github-mcp.js";
import { createGitHubMcpHttpServer } from "../src/github-mcp-http.js";
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
    const server = createGitHubMcpHttpServer({ getPullRequest });

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
      tools: [expect.objectContaining({ name: "get_pull_request" })],
    });
    await expect(
      client.callTool({ arguments: { pull_number: 42 }, name: "get_pull_request" }),
    ).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ number: 42 }), type: "text" }],
    });

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
    const server = createGitHubMcpServer({ getPullRequest });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "forgegate-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [expect.objectContaining({ name: "get_pull_request" })],
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
    expect(getPullRequest).toHaveBeenCalledWith(42);

    await client.close();
    await server.close();
  });
});
