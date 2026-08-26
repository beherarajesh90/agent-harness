import { createGitHubReadClient } from "./github.js";
import { createGitHubApprovalStore } from "./github-approval.js";
import { createGitHubMcpHttpServer } from "./github-mcp-http.js";
import { createGitHubMutationPolicy } from "./github-policy.js";

const repository = requiredEnvironment("FORGEGATE_DEMO_REPO");
const token = requiredEnvironment("GITHUB_TOKEN");
const approvalSecret = requiredEnvironment("FORGEGATE_APPROVAL_SECRET");
const port = Number(process.env.PORT ?? 8800);
const host = process.env.HOST ?? "0.0.0.0";

const github = createGitHubReadClient({
  policy: createGitHubMutationPolicy({
    branchPrefix: process.env.FORGEGATE_BRANCH_PREFIX ?? "forgegate/demo-",
    maxBytes: Number(process.env.FORGEGATE_MAX_BYTES ?? 250_000),
    maxFiles: Number(process.env.FORGEGATE_MAX_FILES ?? 10),
    pathPrefix: process.env.FORGEGATE_PATH_PREFIX ?? "payment-lab/",
    repository,
  }),
  repository,
  token,
});
const server = createGitHubMcpHttpServer(github, {
  approvalSecret,
  approvalStore: createGitHubApprovalStore(),
});

await new Promise<void>((resolve) => server.listen({ host, port }, resolve));

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
