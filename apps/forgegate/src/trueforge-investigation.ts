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
  "Continue with Phase HYPOTHESES. Pass the validated invariant artifacts to the failure-mode-analyst, wait for its completed output, validate every ScenarioPlan, and preserve each accepted artifact. ScenarioPlan ordering must be a non-empty string[]; do not return a single string. ScenarioPlan seed must be a non-negative integer; do not return a string seed.",
  "Continue with Phase EXPERIMENT and EVIDENCE. Resolve master to its immutable SHA and measure its baseline counts before checking out the exact PR SHA. Run every validated unique ScenarioPlan in the disposable sandbox and return one schema-valid ExperimentResult per scenario with baselineSha, scenarioId, repetitions, expected baseline counts, observed PR counts, verdict, and the existing payment-lab:evidence identifier as the artifact link only.",
  "Continue with Phase DECISION. Reconcile the persisted InvariantCandidate, ScenarioPlan, and ExperimentResult artifacts. Return one complete final JSON object containing the full invariants array, full scenarios array, full experimentResults array, and decision; persisted artifacts cannot substitute for omitted fields. READY is allowed only when all scenarios have passing results and all artifacts are valid and consistent.",
] as const;
const mcpRecoveryPrompt = "The previous MCP call used an invalid server or tool name. Do not call list_tools, get_tool_info, get_pr, list_changed_files, or changed_files. Use only forgegate-github tools named get_pull_request, get_pull_request_files, get_file, get_checks, get_qodo_reviews, and get_review_comments. Retry the required read now, starting with get_pull_request.";
const sandboxRecoveryPrompt = "The previous sandbox command failed with a transient startup or process-bridge error. Retry the same sandbox command once now, then continue the investigation. Do not mark the investigation UNCERTAIN unless the retry also fails.";
const decisionRepairInstruction = "Final response rejected: the evidence exists, but the decision bundle is incomplete. Return one complete JSON object containing the full invariants, scenarios, and experimentResults arrays plus decision. Copy the exact persisted evidence below; do not summarize, omit, or alter any array. Do not emit another partial BLOCKED or READY response.";

export function createTrueForgeInvestigationLauncher({
  modelName,
  repository,
  sessions,
  listEvents,
  onControllerError,
}: {
  modelName: string;
  repository: string;
  sessions: TrueForgeSessions;
  listEvents?: (sessionId: string) => Promise<InvestigationEvent[]>;
  onControllerError?: (error: unknown) => void;
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
            "Use only these exact forgegate-github tool names: get_pull_request, get_pull_request_files, get_file, get_checks, get_qodo_reviews, and get_review_comments. Do not call list_tools, get_tool_info, get_pr, list_changed_files, or changed_files.",
            "If a required MCP tool is unavailable, record UNCERTAIN and stop safely; never substitute raw exec/curl or claim the read completed.",
            "Do not fetch plan.md, list the repository root recursively, or request oversized responses. Read only apps/forgegate/src/payment-lab.ts and apps/forgegate/test/payment-lab.test.ts at the exact PR head SHA.",
            "Never run grep -R, find, or any recursive repository scan. Use direct file reads or a bounded search over only the two allowed payment-lab paths.",
            "Checklist: read PR metadata; read changed files; read payment-lab source and tests at the exact PR head SHA; inspect checks/reviews/comments; run the baseline payment test on master before checking out the exact PR head SHA; then delegate both analysts and reconcile their outputs.",
            "The primary agent performs every GitHub MCP read and every sandbox action before delegation. Pass that collected evidence to the analysts; subagents must return JSON artifacts only and must not call MCP or sandbox tools.",
            "Use cwd / for sandbox commands; /workspace does not exist in the Daytona image. Clone into /agent-harness or another path under /.",
            "For payment-lab experiments, run pnpm install --frozen-lockfile, then pnpm --filter @forgegate/app build from /agent-harness and use node --input-type=module to import ./apps/forgegate/dist/src/payment-lab.js. Never use pnpm exec tsx, npx ts-node, or ts-node.",
            "Evidence reference sha must equal the exact PR head commit SHA, which is testedSha; never use a Git blob SHA, branch name, or baseline SHA for evidence.",
            "Spawn exactly two visible dynamic subagents:",
            "- invariant-analyst: return InvariantCandidate JSON objects with at least two exact-SHA repository evidence references.",
            "- failure-mode-analyst: wait for the accepted invariant JSON from invariant-analyst, then return every materially distinct deterministic ScenarioPlan JSON object tied to it.",
            "For the payment-lab MVP, every executable failure scenario must include timeout-after-charge and unsafe-retry; do not invent delay, omitted-ledger, amount-mutation, webhook, or concurrency faults that the fixture cannot execute.",
            "After both analysts finish, deduplicate and bound the ScenarioPlans, then run every accepted unique ScenarioPlan in the sandbox with the independent payment oracle and record one ExperimentResult per scenario.",
            "Use payment-lab:evidence as the ExperimentResult artifact link; never put an explanation or sentence in artifactLinks.",
            "Resolve master to its immutable SHA and run its baseline before PR checkout. Every ExperimentResult must include baselineSha for that master commit, use its measured counts as expected, and use PR-head adversarial counts as observed; mark verdict fail when the observed counts violate an accepted invariant.",
            "The final response must be a JSON object with a decision field. The final decision response must include invariants, scenarios, experimentResults, and decision; persisted artifacts cannot substitute for omitted fields. For READY or BLOCKED include complete consistent evidence; for UNCERTAIN include only evidence actually obtained and omit unavailable fields. Never invent missing artifacts.",
            "Completion predicate: do not emit a final response until all required reads, two analyst outputs, baseline, adversarial experiment, schema validation, and decision are present; after every tool response issue the next required tool call.",
            "Validate both artifact types against the ForgeGate schemas; reject prose-only or stale-SHA artifacts.",
            "Artifact contract: evidence objects use sha (not testedSha); ScenarioPlan injectedFaults is string[] and expectedOutcome is a string; return raw JSON without markdown fences.",
            "ScenarioPlan ordering is also a non-empty string[]; validate the complete ScenarioPlan against the ForgeGate schema before preserving it.",
            "ScenarioPlan seed is a non-negative integer; never use a string such as seed-001.",
            "Reconcile only evidence at the exact PR SHA. Do not write or request approval in this turn.",
          ].join("\n"),
          type: "user.message",
        },
      ],
    });

    if (listEvents) {
      const reportError = onControllerError ?? ((error: unknown) => console.error("ForgeGate phase controller failed", error));
      void createInvestigationPhaseController({ createTurn: sessions.createTurn.bind(sessions), listEvents }).continue(session.data.id, turn.data.id).catch(reportError);
    }
    return { sessionId: session.data.id, turnId: turn.data.id };
  };
}

export function createInvestigationPhaseController({ createTurn, listEvents, pollIntervalMs = 1_000, maxPolls = 600 }: PhaseControllerOptions) {
  return { continue: continueInvestigation };

  async function continueInvestigation(sessionId: string, initialTurnId: string) {
    let turnId = initialTurnId;
    let mcpRecoveryAttempted = false;
    let sandboxRecoveryAttempted = false;
    let experimentRecoveryAttempts = 0;
    let decisionRepairAttempted = false;
    for (let promptIndex = 0; promptIndex < continuationPrompts.length;) {
      const completed = await waitForTurn(sessionId, turnId);
      if (!completed) return;
      if (isTerminalTurn(completed.event)) return;
      const events = await listEvents(sessionId);
      if (hasRepeatedRejectedDecision(events)) return;
      const invalidMcpToolCall = findInvalidMcpToolCall(events);
      if (invalidMcpToolCall) {
        if (isSubagentThread(invalidMcpToolCall.event.threadId) || mcpRecoveryAttempted) return;
        mcpRecoveryAttempted = true;
        turnId = (await createTurn(sessionId, { input: [{ content: mcpRecoveryPrompt, type: "user.message" }] })).data.id;
        continue;
      }
      const transientSandboxFailures = findTransientSandboxFailures(events, turnId);
      if (transientSandboxFailures.length > 1) return;
      const transientSandboxFailure = transientSandboxFailures[0];
      if (transientSandboxFailure && !sandboxRecoveryAttempted) {
        if (isSubagentThread(transientSandboxFailure.event.threadId)) return;
        sandboxRecoveryAttempted = true;
        turnId = (await createTurn(sessionId, { input: [{ content: sandboxRecoveryPrompt, type: "user.message" }] })).data.id;
        continue;
      }
      if (hasIncompleteExperiments(events) && experimentRecoveryAttempts < 3) {
        experimentRecoveryAttempts += 1;
        turnId = (await createTurn(sessionId, { input: [{ content: incompleteExperimentPrompt(events), type: "user.message" }] })).data.id;
        continue;
      }
      if (hasIncompleteExperiments(events)) return;
      if (hasExplicitUncertainDecision(events) && !hasAnyEvidence(events)) return;
      if (hasIncompleteDecision(events)) {
        if (decisionRepairAttempted) return;
        decisionRepairAttempted = true;
        turnId = (await createTurn(sessionId, { input: [{ content: decisionRepairPrompt(events), type: "user.message" }] })).data.id;
        continue;
      }
      if (hasCompleteEvidence(events)) return;
      turnId = (await createTurn(sessionId, { input: [{ content: nextRequiredPrompt(events), type: "user.message" }] })).data.id;
      promptIndex += 1;
    }
  }

  async function waitForTurn(sessionId: string, turnId: string) {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const events = await listEvents(sessionId);
      const completed = events.find((item) => item.turnId === turnId && item.event.type === "turn.done");
      if (completed) return completed;
      if (poll < maxPolls - 1) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return undefined;
  }
}

function isTerminalTurn(event: Record<string, unknown>) {
  const state = event.state;
  const status = typeof state === "object" && state !== null && !Array.isArray(state) ? (state as { status?: unknown }).status : event.status;
  return status === "cancelled" || status === "error" || status === "blocked";
}

function hasCompleteEvidence(events: InvestigationEvent[]) {
  const status = projectInvestigation("controller", "", events).status;
  return status === "READY" || status === "BLOCKED";
}

function hasExplicitUncertainDecision(events: InvestigationEvent[]) {
  return projectInvestigation("controller", "", events).decision === "UNCERTAIN";
}

function hasAnyEvidence(events: InvestigationEvent[]) {
  return projectInvestigation("controller", "", events).artifacts.length > 0;
}

function hasIncompleteDecision(events: InvestigationEvent[]) {
  const artifacts = projectInvestigation("controller", "", events).artifacts;
  const types = new Set(artifacts.map((artifact) => artifact.type));
  const requiredTypes = ["InvariantCandidate", "ScenarioPlan", "ExperimentResult"] as const;
  if (!requiredTypes.every((type) => types.has(type))) return false;
  return isIncompleteTerminalDecision(primaryDecisionOutputs(events).at(-1));
}

function hasRepeatedRejectedDecision(events: InvestigationEvent[]) {
  const outputs = primaryDecisionOutputs(events)
    .filter((output) => output.decision === "READY" || output.decision === "BLOCKED");
  const last = outputs.at(-1);
  const previous = outputs.at(-2);
  return Boolean(last && previous && JSON.stringify(last) === JSON.stringify(previous) && isIncompleteTerminalDecision(last));
}

function primaryDecisionOutputs(events: InvestigationEvent[]) {
  return projectInvestigation("controller", "", events).events
    .filter((event) => event.type === "turn.done" && (!event.threadId || event.threadId === "main"))
    .map((event) => {
      const output = isRecord(event.payload.state) && isRecord(event.payload.state.output) ? event.payload.state.output.content : undefined;
      return typeof output === "string" ? parseJson(output) : undefined;
    })
    .filter((output): output is Record<string, unknown> => isRecord(output));
}

function isIncompleteTerminalDecision(output: Record<string, unknown> | undefined) {
  return Boolean(output && (output.decision === "READY" || output.decision === "BLOCKED") && (!Array.isArray(output.invariants) || !Array.isArray(output.scenarios) || !Array.isArray(output.experimentResults) || output.invariants.length === 0 || output.scenarios.length === 0 || output.experimentResults.length === 0));
}

function decisionRepairPrompt(events: InvestigationEvent[]) {
  const artifacts = projectInvestigation("controller", "", events).artifacts;
  const evidence = {
    experimentResults: artifacts.filter((artifact) => artifact.type === "ExperimentResult").map((artifact) => artifact.data),
    invariants: artifacts.filter((artifact) => artifact.type === "InvariantCandidate").map((artifact) => artifact.data),
    scenarios: artifacts.filter((artifact) => artifact.type === "ScenarioPlan").map((artifact) => artifact.data),
  };
  return `${decisionRepairInstruction}\n${JSON.stringify(evidence)}`;
}

function nextRequiredPrompt(events: InvestigationEvent[]) {
  const artifacts = projectInvestigation("controller", "", events).artifacts;
  const types = new Set(artifacts.map((artifact) => artifact.type));
  if (!types.has("InvariantCandidate")) return continuationPrompts[0];
  if (!types.has("ScenarioPlan")) {
    const invariantIds = artifacts
      .filter((artifact) => artifact.type === "InvariantCandidate")
      .map((artifact) => artifact.data.id)
      .join(", ");
    return `${continuationPrompts[1]} Accepted invariant IDs: ${invariantIds}. Every ScenarioPlan.invariantId must equal one of these exact IDs. Do not return ExperimentResult or decision yet.`;
  }
  if (!types.has("ExperimentResult")) return continuationPrompts[2];
  return continuationPrompts[3];
}

function hasIncompleteExperiments(events: InvestigationEvent[]) {
  const artifacts = projectInvestigation("controller", "", events).artifacts;
  const scenarios = artifacts.filter((artifact) => artifact.type === "ScenarioPlan");
  const results = artifacts.filter((artifact) => artifact.type === "ExperimentResult");
  return scenarios.some((scenario) => !results.some((result) => scenarioMatchesResult(scenario.data, result.data)));
}

function incompleteExperimentPrompt(events: InvestigationEvent[]) {
  const artifacts = projectInvestigation("controller", "", events).artifacts;
  const scenarios = artifacts.filter((artifact) => artifact.type === "ScenarioPlan").map((artifact) => artifact.data);
  const results = artifacts.filter((artifact) => artifact.type === "ExperimentResult").map((artifact) => artifact.data);
  const missingIds = scenarios
    .filter((scenario) => !results.some((result) => scenarioMatchesResult(scenario, result)))
    .map((scenario) => scenario.scenarioId)
    .filter((scenarioId): scenarioId is string => typeof scenarioId === "string");
  const missing = missingIds.length > 0 ? ` Missing scenario IDs: ${missingIds.join(", ")}.` : ` ${scenarios.length - results.length} scenario result(s) are still missing.`;
  return `${continuationPrompts[2]}${missing} Return one result per missing scenario and copy each exact scenarioId into its ExperimentResult.`;
}

function scenarioMatchesResult(scenario: Record<string, unknown>, result: Record<string, unknown>) {
  if (typeof scenario.scenarioId === "string") return result.scenarioId === scenario.scenarioId;
  return typeof result.scenarioId !== "string" && result.seed === scenario.seed;
}

function findInvalidMcpToolCall(events: InvestigationEvent[]) {
  return events.find(({ event }) => event.type === "tool.response" && typeof event.content === "string" && /Tool call failed: Tool |MCP server ['\"].*not found/i.test(event.content));
}

function findTransientSandboxFailures(events: InvestigationEvent[], turnId: string) {
  return events.filter(({ event, turnId: eventTurnId }) => {
    if (eventTurnId !== turnId || event.type !== "tool.response" || typeof event.content !== "string") return false;
    const response = parseJson(event.content);
    if (!isRecord(response) || response.success !== true || !isRecord(response.response)) return false;
    if (typeof response.response.exitCode !== "number" || typeof response.response.result !== "string") return false;
    return /fork\/exec \/usr\/bin\/bash|command execution timeout|sandbox.*(?:unavailable|startup)|process.?bridge/i.test(response.response.result);
  });
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSubagentThread(threadId: unknown) {
  return typeof threadId === "string" && threadId !== "main";
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
