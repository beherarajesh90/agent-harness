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

      const { data: headCommit } = await writeGithub.rest.git.getCommit({
        commit_sha: actualHeadSha,
        owner,
        repo,
      });
      const blobs = await Promise.all(
        input.files.map(async (file) => {
          const { data } = await writeGithub.rest.git.createBlob({
            content: file.content,
            encoding: "utf-8",
            owner,
            repo,
          });
          return { mode: "100644" as const, path: file.path, sha: data.sha, type: "blob" as const };
        }),
      );
      const { data: tree } = await writeGithub.rest.git.createTree({
        base_tree: headCommit.tree.sha,
        owner,
        repo,
        tree: blobs,
      });
      const { data: commit } = await writeGithub.rest.git.createCommit({
        message: input.message,
        owner,
        parents: [actualHeadSha],
        repo,
        tree: tree.sha,
      });
      await writeGithub.rest.git.updateRef({
        force: false,
        owner,
        ref: `heads/${input.branch}`,
        repo,
        sha: commit.sha,
      });

      return {
        commitSha: commit.sha,
        url: `https://github.com/${repository}/commit/${commit.sha}`,
      };
    },
  };
}
