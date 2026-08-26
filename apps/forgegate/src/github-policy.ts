const allowedOperations = new Set([
  "commit_files",
  "comment_on_pull_request",
  "request_qodo_review",
]);

export class GitHubPolicyError extends Error {}

export type GitHubMutationPolicy = {
  repository: string;
  branchPrefix: string;
  pathPrefix: string;
  maxFiles: number;
  maxBytes: number;
};

export type GitHubMutation = {
  repository: string;
  branch: string;
  expectedHeadSha: string;
  actualHeadSha: string;
  operation: string;
  files: { path: string; content: string }[];
};

export function assertGitHubMutationAllowed(
  policy: GitHubMutationPolicy,
  mutation: GitHubMutation,
) {
  if (mutation.repository !== policy.repository) {
    throw new GitHubPolicyError("repository is not allowed");
  }

  if (!mutation.branch.startsWith(policy.branchPrefix)) {
    throw new GitHubPolicyError("branch is not allowed");
  }

  if (!isCommitSha(mutation.expectedHeadSha) || mutation.expectedHeadSha !== mutation.actualHeadSha) {
    throw new GitHubPolicyError("tested commit is stale");
  }

  if (!allowedOperations.has(mutation.operation)) {
    throw new GitHubPolicyError("operation is not allowed");
  }

  if (mutation.operation === "commit_files" && mutation.files.length === 0) {
    throw new GitHubPolicyError("commit requires files");
  }

  if (mutation.files.length > policy.maxFiles) {
    throw new GitHubPolicyError("file count exceeds limit");
  }

  const bytes = mutation.files.reduce((total, file) => {
    assertAllowedPath(file.path, policy.pathPrefix);
    return total + Buffer.byteLength(file.content, "utf8");
  }, 0);

  if (bytes > policy.maxBytes) {
    throw new GitHubPolicyError("payload exceeds limit");
  }
}

function isCommitSha(value: string) {
  return /^[a-f0-9]{40}$/.test(value);
}

function assertAllowedPath(path: string, pathPrefix: string) {
  if (
    !path.startsWith(pathPrefix) ||
    path === pathPrefix ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new GitHubPolicyError("path is not allowed");
  }
}
