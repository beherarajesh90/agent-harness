const allowedOperations = new Set([
  "commit_files",
  "comment_on_pull_request",
  "request_qodo_review",
]);

export class GitHubPolicyError extends Error {}

export type GitHubMutationPolicy = {
  repository: string;
  branchPrefix: string;
  allowedPaths: string[];
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

export function createGitHubMutationPolicy(policy: GitHubMutationPolicy) {
  assertGitHubMutationPolicy(policy);
  return policy;
}

export function assertGitHubMutationAllowed(
  policy: GitHubMutationPolicy,
  mutation: GitHubMutation,
) {
  assertGitHubMutationPolicy(policy);

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
    assertAllowedPath(file.path, policy.allowedPaths);
    return total + Buffer.byteLength(file.content, "utf8");
  }, 0);

  if (bytes > policy.maxBytes) {
    throw new GitHubPolicyError("payload exceeds limit");
  }
}

function assertGitHubMutationPolicy(policy: GitHubMutationPolicy) {
  assertValidPrefix(policy.branchPrefix, "branch prefix", false);
  if (!Array.isArray(policy.allowedPaths) || policy.allowedPaths.length === 0) {
    throw new GitHubPolicyError("allowed paths are invalid");
  }
  policy.allowedPaths.forEach((path) => assertValidPath(path));
  assertPositiveSafeInteger(policy.maxFiles, "max files");
  assertPositiveSafeInteger(policy.maxBytes, "max bytes");
}

function assertValidPrefix(value: string, name: string, requireTrailingSlash: boolean) {
  if (
    !value ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    (requireTrailingSlash && !value.endsWith("/"))
  ) {
    throw new GitHubPolicyError(`${name} is invalid`);
  }
}

function assertValidPath(value: string) {
  if (
    !value ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new GitHubPolicyError("allowed paths are invalid");
  }
}

function assertPositiveSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubPolicyError(`${name} must be a positive integer`);
  }
}

function isCommitSha(value: string) {
  return /^[a-f0-9]{40}$/.test(value);
}

function assertAllowedPath(path: string, allowedPaths: string[]) {
  if (
    !allowedPaths.includes(path) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new GitHubPolicyError("path is not allowed");
  }
}
