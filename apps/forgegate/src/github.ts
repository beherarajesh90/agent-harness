import { Octokit } from "octokit";

export function createGitHubReadClient({
  repository,
  token,
}: {
  repository: string;
  token: string;
}) {
  const [owner, repo, ...rest] = repository.split("/");

  if (!owner || !repo || rest.length > 0) {
    throw new Error("FORGEGATE_DEMO_REPO must be owner/repo");
  }

  const octokit = new Octokit({ auth: token });

  return {
    async getPullRequest(pullNumber: number) {
      const { data } = await octokit.rest.pulls.get({
        owner,
        pull_number: pullNumber,
        repo,
      });
      return data;
    },
  };
}
