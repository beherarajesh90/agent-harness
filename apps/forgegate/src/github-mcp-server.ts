import { createGitHubReadClient } from "./github.js";
import { createGitHubApprovalStore } from "./github-approval.js";
import { createGitHubMcpHttpServer } from "./github-mcp-http.js";
import { createGitHubMutationPolicy } from "./github-policy.js";

const repository = requiredEnvironment("FORGEGATE_DEMO_REPO");
const token = requiredEnvironment("GITHUB_TOKEN");
const writeToken = requiredEnvironment("GITHUB_WRITE_TOKEN");
const approvalSecret = requiredEnvironment("FORGEGATE_APPROVAL_SECRET");
const port = Number(process.env.PORT ?? 8800);
const host = process.env.HOST ?? "0.0.0.0";

const github = createGitHubReadClient({
  policy: createGitHubMutationPolicy({
    allowedPaths: (process.env.FORGEGATE_ALLOWED_PATHS ??
      "apps/forgegate/src/payment-lab.ts,apps/forgegate/test/payment-lab.test.ts").split(","),
    branchPrefix: process.env.FORGEGATE_BRANCH_PREFIX ?? "forgegate/demo-",
    maxBytes: Number(process.env.FORGEGATE_MAX_BYTES ?? 250_000),
    maxFiles: Number(process.env.FORGEGATE_MAX_FILES ?? 10),
    repository,
  }),
  repository,
  token,
  writeToken,
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
