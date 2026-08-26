import { createForgeGateAgentSpec } from "./agent-spec.js";

type TrueForgeSessions = {
  create: (request: { agent: { spec: ReturnType<typeof createForgeGateAgentSpec> } }) => Promise<{ data: { id: string } }>;
  createTurn: (
    sessionId: string,
    request: { input: { content: string; type: "user.message" }[] },
  ) => Promise<{ data: { id: string } }>;
};

export function createTrueForgeInvestigationLauncher({
  modelName,
  repository,
  sessions,
}: {
  modelName: string;
  repository: string;
  sessions: TrueForgeSessions;
}) {
  const configuredRepository = assertConfiguredRepository(repository);

  return async ({ pullRequestUrl }: { pullRequestUrl: string }) => {
    assertConfiguredPullRequest(pullRequestUrl, configuredRepository);

    const session = await sessions.create({ agent: { spec: createForgeGateAgentSpec(modelName) } });
    const turn = await sessions.createTurn(session.data.id, {
      input: [
        {
          content: [
            `Investigate ${pullRequestUrl} in ${configuredRepository}.`,
            "Read the PR and exact head SHA before making claims.",
            "Spawn exactly two visible dynamic subagents:",
            "- invariant-analyst: identify payment invariants with at least two repository evidence references.",
            "- failure-mode-analyst: identify adversarial retry, timeout, webhook, and concurrency scenarios.",
            "Reconcile only evidence at the exact PR SHA. Do not write or request approval in this turn.",
          ].join("\n"),
          type: "user.message",
        },
      ],
    });

    return { sessionId: session.data.id, turnId: turn.data.id };
  };
}

function assertConfiguredRepository(repository: string) {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error("repository must be owner/repo");
  }
  return repository;
}

function assertConfiguredPullRequest(pullRequestUrl: string, repository: string) {
  const url = new URL(pullRequestUrl);
  const [owner, repo] = repository.split("/");
  const parts = url.pathname.split("/").filter(Boolean);

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !owner ||
    !repo ||
    parts.length !== 4 ||
    parts[0] !== owner ||
    parts[1] !== repo ||
    parts[2] !== "pull" ||
    !/^\d+$/.test(parts[3] ?? "")
  ) {
    throw new Error("pull request URL is not in the configured repository");
  }
}
