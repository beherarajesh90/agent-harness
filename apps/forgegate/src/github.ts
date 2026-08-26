import { Octokit } from "octokit";

import {
  assertGitHubMutationAllowed,
  GitHubPolicyError,
} from "./github-policy.js";
import type { GitHubMutationPolicy } from "./github-policy.js";

export type CommitFilesInput = {
  repository: string;
  branch: string;
  expectedHeadSha: string;
  message: string;
  files: { path: string; content: string }[];
};

export type CommitFilesResult = {
  commitSha: string;
  url: string;
};

// Source: https://docs.github.com/en/graphql/reference/commits
// createCommitOnBranch checks expectedHeadOid while creating and advancing the branch.
const createCommitOnBranchMutation = `
  mutation ForgeGateCommit(
    $branch: String!
    $expectedHeadOid: GitObjectID!
    $repository: String!
    $additions: [FileAddition!]
    $message: String!
  ) {
    createCommitOnBranch(input: {
      branch: { branchName: $branch, repositoryNameWithOwner: $repository }
      expectedHeadOid: $expectedHeadOid
      fileChanges: { additions: $additions }
      message: { headline: $message }
    }) {
      commit { oid url }
    }
  }
`;

export function createGitHubReadClient({
  repository,
  token,
  octokit,
  policy,
  writeOctokit,
  writeToken,
}: {
  octokit?: Octokit;
  policy?: GitHubMutationPolicy;
  repository: string;
  token: string;
  writeOctokit?: Octokit;
  writeToken: string;
}) {
  const [owner, repo, ...rest] = repository.split("/");

  if (!owner || !repo || rest.length > 0) {
    throw new Error("FORGEGATE_DEMO_REPO must be owner/repo");
  }

  const github = octokit ?? new Octokit({ auth: token });
  const writeGithub = writeOctokit ?? new Octokit({ auth: writeToken });

  return {
    async getPullRequest(pullNumber: number) {
      const { data } = await github.rest.pulls.get({
        owner,
        pull_number: pullNumber,
        repo,
      });
      return data;
    },

    async commitFiles(input: CommitFilesInput): Promise<CommitFilesResult> {
      if (!policy) {
        throw new GitHubPolicyError("GitHub mutation policy is not configured");
      }

      const { data: branch } = await writeGithub.rest.repos.getBranch({
        branch: input.branch,
        owner,
        repo,
      });
      const actualHeadSha = branch.commit.sha;

      assertGitHubMutationAllowed(policy, {
        actualHeadSha,
        branch: input.branch,
        expectedHeadSha: input.expectedHeadSha,
        files: input.files,
        operation: "commit_files",
        repository: input.repository,
      });

      const result = await writeGithub.graphql<{
        createCommitOnBranch: { commit: { oid: string; url: string } | null } | null;
      }>(createCommitOnBranchMutation, {
        additions: input.files.map((file) => ({
          contents: Buffer.from(file.content, "utf8").toString("base64"),
          path: file.path,
        })),
        branch: input.branch,
        expectedHeadOid: actualHeadSha,
        message: input.message,
        repository,
      });
      const commit = result.createCommitOnBranch?.commit;
      if (!commit) {
        throw new Error("GitHub did not return the created commit");
      }

      return {
        commitSha: commit.oid,
        url: commit.url,
      };
    },
  };
}
