import { Octokit } from "octokit";

import { seedDemo } from "./demo-seed.js";

const repository = requiredEnvironment("FORGEGATE_DEMO_REPO");
const token = requiredEnvironment("GITHUB_WRITE_TOKEN");
const [owner, repo, ...rest] = repository.split("/");
if (!owner || !repo || rest.length > 0) {
  throw new Error("FORGEGATE_DEMO_REPO must be owner/repo");
}

const github = new Octokit({ auth: token });
const result = await seedDemo({
  client: {
    async createBranch(branch, sha) {
      await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha });
    },
    async createPullRequest(input) {
      const { data } = await github.rest.pulls.create({
        base: input.base,
        body: input.body,
        head: input.head,
        owner,
        repo,
        title: input.title,
      });
      return { number: data.number, url: data.html_url };
    },
    async getBranch(branch) {
      const { data } = await github.rest.repos.getBranch({ branch, owner, repo });
      return { sha: data.commit.sha };
    },
    async getFile(path, ref) {
      const { data } = await github.rest.repos.getContent({ owner, path, ref, repo });
      if (Array.isArray(data) || data.type !== "file" || !data.content) {
        throw new Error(`${path} is not a file on ${ref}`);
      }
      return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
    },
    async updateFile(input) {
      await github.rest.repos.createOrUpdateFileContents({
        branch: input.branch,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        message: input.message,
        owner,
        path: input.path,
        repo,
        sha: input.sha,
      });
    },
  },
});

console.log(result.pullRequestUrl);

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
