import { createGitHubReadClient } from "./github.js";
import { createGitHubMcpHttpServer } from "./github-mcp-http.js";

const repository = requiredEnvironment("FORGEGATE_DEMO_REPO");
const token = requiredEnvironment("GITHUB_TOKEN");
const port = Number(process.env.PORT ?? 8800);
const host = process.env.HOST ?? "0.0.0.0";

const github = createGitHubReadClient({ repository, token });
const server = createGitHubMcpHttpServer(github);

await new Promise<void>((resolve) => server.listen({ host, port }, resolve));

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
