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

  return async ({ pullRequestUrl, requestFingerprint }: { pullRequestUrl: string; requestFingerprint?: string }) => {
    assertConfiguredPullRequest(pullRequestUrl, configuredRepository);

    const session = await sessions.create({ agent: { spec: createForgeGateAgentSpec(modelName) } });
    const turn = await sessions.createTurn(session.data.id, {
      input: [
        {
          content: [
            ...(requestFingerprint ? [`ForgeGate request fingerprint: ${requestFingerprint}.`] : []),
            `Investigate ${pullRequestUrl} in ${configuredRepository}.`,
            "Read the PR and exact head SHA before making claims.",
            "Do not finish after setup, cloning, or one tool call. Continue until the complete investigation checklist is finished.",
            "Use the forgegate-github MCP tools for PR metadata, changed files, exact-SHA payment-lab source/tests, checks, reviews, and comments; do not use raw GitHub curl responses for these reads.",
            "Do not fetch plan.md, list the repository root recursively, or request oversized responses. Read only the exact payment-lab source/test paths needed for the investigation.",
            "Checklist: read PR metadata; read changed files; read payment-lab source and tests at the exact PR head SHA; inspect checks/reviews/comments; run the baseline payment test in the sandbox; then delegate both analysts and reconcile their outputs.",
            "Spawn exactly two visible dynamic subagents:",
            "- invariant-analyst: return InvariantCandidate JSON objects with at least two exact-SHA repository evidence references.",
            "- failure-mode-analyst: wait for the accepted invariant JSON from invariant-analyst, then return deterministic ScenarioPlan JSON objects tied to it.",
            "After both analysts finish, run the selected ScenarioPlan in the sandbox with the independent payment oracle and record ExperimentResult evidence.",
            "The final response must be a JSON object with invariants, scenarios, experimentResult, and decision fields; do not claim READY without complete evidence.",
            "Validate both artifact types against the ForgeGate schemas; reject prose-only or stale-SHA artifacts.",
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
