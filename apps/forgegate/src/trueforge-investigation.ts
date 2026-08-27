import { createForgeGateAgentSpec } from "./agent-spec.js";
import { projectInvestigation } from "./investigation.js";

type TrueForgeSessions = {
  create: (request: { agent: { spec: ReturnType<typeof createForgeGateAgentSpec> } }) => Promise<{ data: { id: string } }>;
  createTurn: (
    sessionId: string,
    request: { input: { content: string; type: "user.message" }[] },
  ) => Promise<{ data: { id: string } }>;
};

type InvestigationEvent = { event: Record<string, unknown>; turnId: string };
type PhaseControllerOptions = {
  createTurn: TrueForgeSessions["createTurn"];
  listEvents: (sessionId: string) => Promise<InvestigationEvent[]>;
  pollIntervalMs?: number;
  maxPolls?: number;
};

const continuationPrompts = [
  "Continue with Phase INVARIANTS. Spawn the invariant-analyst now, wait for its completed output, validate every InvariantCandidate against the ForgeGate schema, and preserve each accepted artifact.",
  "Continue with Phase HYPOTHESES. Pass the validated invariant artifacts to the failure-mode-analyst, wait for its completed output, validate every ScenarioPlan, and preserve each accepted artifact.",
  "Continue with Phase EXPERIMENT and EVIDENCE. Run the validated ScenarioPlan in the disposable sandbox against the exact PR SHA, and return a schema-valid ExperimentResult with repetitions, observed counts, verdict, and the existing payment-lab:evidence identifier as the artifact link only.",
  "Continue with Phase DECISION. Reconcile the persisted InvariantCandidate, ScenarioPlan, and ExperimentResult artifacts. Return the final JSON bundle and decision; READY is allowed only when all three artifact types are valid and consistent.",
] as const;

export function createTrueForgeInvestigationLauncher({
  modelName,
  repository,
  sessions,
  listEvents,
}: {
  modelName: string;
  repository: string;
  sessions: TrueForgeSessions;
  listEvents?: (sessionId: string) => Promise<InvestigationEvent[]>;
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
            "If a required MCP tool is unavailable, record UNCERTAIN and stop safely; never substitute raw exec/curl or claim the read completed.",
            "Do not fetch plan.md, list the repository root recursively, or request oversized responses. Read only apps/forgegate/src/payment-lab.ts and apps/forgegate/test/payment-lab.test.ts at the exact PR head SHA.",
            "Checklist: read PR metadata; read changed files; read payment-lab source and tests at the exact PR head SHA; inspect checks/reviews/comments; run the baseline payment test in the sandbox; then delegate both analysts and reconcile their outputs.",
            "Spawn exactly two visible dynamic subagents:",
            "- invariant-analyst: return InvariantCandidate JSON objects with at least two exact-SHA repository evidence references.",
            "- failure-mode-analyst: wait for the accepted invariant JSON from invariant-analyst, then return deterministic ScenarioPlan JSON objects tied to it.",
            "After both analysts finish, run the selected ScenarioPlan in the sandbox with the independent payment oracle and record ExperimentResult evidence.",
            "Use payment-lab:evidence as the ExperimentResult artifact link; never put an explanation or sentence in artifactLinks.",
            "The final response must be a JSON object with invariants, scenarios, experimentResult, and decision fields; do not claim READY without complete evidence.",
            "Completion predicate: do not emit a final response until all required reads, two analyst outputs, baseline, adversarial experiment, schema validation, and decision are present; after every tool response issue the next required tool call.",
            "Validate both artifact types against the ForgeGate schemas; reject prose-only or stale-SHA artifacts.",
            "Artifact contract: evidence objects use sha (not testedSha); ScenarioPlan injectedFaults is string[] and expectedOutcome is a string; return raw JSON without markdown fences.",
            "Reconcile only evidence at the exact PR SHA. Do not write or request approval in this turn.",
          ].join("\n"),
          type: "user.message",
        },
      ],
    });

    if (listEvents) {
      void createInvestigationPhaseController({ createTurn: sessions.createTurn.bind(sessions), listEvents }).continue(session.data.id, turn.data.id).catch(() => undefined);
    }
    return { sessionId: session.data.id, turnId: turn.data.id };
  };
}

export function createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs = 1_000, maxPolls = 600 }: PhaseControllerOptions) {
  return { continue: continueInvestigation };

  async function continueInvestigation(sessionId: string, initialTurnId: string) {
    let turnId = initialTurnId;
    for (const prompt of continuationPrompts) {
      const completed = await waitForTurn(sessionId, turnId);
      if (!completed) return;
      const events = await listEvents(sessionId);
      if (hasCompleteEvidence(events)) return;
      turnId = (await createTurn(sessionId, { input: [{ content: prompt, type: "user.message" }] })).data.id;
    }
  }

  async function waitForTurn(sessionId: string, turnId: string) {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const events = await listEvents(sessionId);
      if (events.some((item) => item.turnId === turnId && item.event.type === "turn.done")) return true;
      if (poll < maxPolls - 1) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
  }
}

function hasCompleteEvidence(events: InvestigationEvent[]) {
  const types = new Set(projectInvestigation("controller", "", events).artifacts.map((artifact) => artifact.type));
  const required: ("ExperimentResult" | "InvariantCandidate" | "ScenarioPlan")[] = ["InvariantCandidate", "ScenarioPlan", "ExperimentResult"];
  return required.every((type) => types.has(type));
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
