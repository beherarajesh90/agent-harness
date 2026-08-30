import { executableScenarioPlanSchema, experimentResultSchema, investigationResponseSchema, invariantCandidateSchema, normalizeScenarioPlan, patchProposalSchema, repositoryCapabilityMapSchema, scenarioPlanSchema, validateInvestigationArtifacts } from "./agent-spec.js";
import type { InvestigationDecision } from "./agent-spec.js";
import { isDeepStrictEqual } from "node:util";

export const stages = [
  "CONTEXT",
  "INVARIANTS",
  "HYPOTHESES",
  "EXPERIMENT",
  "EVIDENCE",
  "REPAIR",
  "TESTING",
  "APPROVAL",
  "COMMITTING",
  "QODO",
  "DECISION",
] as const;
export type Stage = (typeof stages)[number];
export type Status = "QUEUED" | "RUNNING" | "PAUSED" | "BLOCKED" | "UNCERTAIN" | "READY" | "ERROR" | "CANCELLED";
export type Source = "SYSTEM" | "GITHUB" | "AGENT" | "SUBAGENT" | "SANDBOX" | "QODO" | "HUMAN";

export type HarnessEvent = {
  eventId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  sequence: number;
  sessionId: string;
  source: Source;
  stage: Stage;
  threadId?: string;
  turnId: string;
  type: string;
};

export type InvestigationSnapshot = {
  artifacts: InvestigationArtifact[];
  decision?: InvestigationDecision;
  diagnostics?: string[];
  events: HarnessEvent[];
  pullRequestUrl: string;
  sessionId: string;
  stage: Stage;
  status: Status;
  turnId: string;
  warnings?: string[];
};

export type InvestigationArtifact = {
  data: Record<string, unknown>;
  type: "ExperimentResult" | "InvariantCandidate" | "PatchProposal" | "RepositoryCapabilityMap" | "ScenarioPlan";
};

const requiredGitHubReadTools = ["get_pull_request", "get_pull_request_files", "get_checks", "get_qodo_reviews", "get_review_comments"] as const;
type TrueForgeEventItem = { event: Record<string, unknown>; turnId: string };
type InvestigationRecord = { pullRequestUrl: string; turnId: string };
type LaunchResult = { sessionId: string; turnId: string };
type InvestigationGateway = {
  approve?: (sessionId: string, input: { decision: "allow" | "deny"; threadId: string; toolCallId: string }) => Promise<unknown>;
  cancel: (sessionId: string) => Promise<unknown>;
  findByRequestFingerprint?: (fingerprint: string) => Promise<{ pullRequestUrl: string; result: LaunchResult } | undefined>;
  getMetadata?: (sessionId: string) => Promise<InvestigationRecord | undefined>;
  listEvents: (sessionId: string) => Promise<TrueForgeEventItem[]>;
  launch: (input: { pullRequestUrl: string; requestFingerprint?: string }) => Promise<LaunchResult>;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key is already bound to a different pull request");
    this.name = "IdempotencyConflictError";
  }
}

export class InvestigationNotFoundError extends Error {
  constructor() {
    super("investigation not found");
    this.name = "InvestigationNotFoundError";
  }
}

export class ApprovalNotFoundError extends Error {
  constructor() {
    super("pending approval not found");
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalAlreadySubmittedError extends Error {
  constructor() {
    super("approval has already been submitted");
    this.name = "ApprovalAlreadySubmittedError";
  }
}

export function projectInvestigation(sessionId: string, pullRequestUrl: string, items: TrueForgeEventItem[]): InvestigationSnapshot {
  const projected = mergeModelDeltas(items.map((item, index) => toHarnessEvent(sessionId, item, items.length - index)));
  const seenSequences = new Set<number>();
  const events = applyThreadStages(projected.filter((event) => {
    if (seenSequences.has(event.sequence)) return false;
    seenSequences.add(event.sequence);
    return true;
  }).sort((left, right) => left.sequence - right.sequence));
  const trustedHeadSha = findPullRequestHeadSha(events);
  const baselineSha = findBaselineSha(events);
  const preflightArtifactLink = latestPreflightArtifactLink(events);
  const deduplicated = deduplicateArtifacts(events.flatMap((event) => artifactFromPayload(event.payload, trustedHeadSha, baselineSha, event.stage, preflightArtifactLink)));
  const artifacts = retainAcceptedScenarioResults(deduplicated.artifacts);
  const accepted = deduplicateArtifacts(artifacts);
  const rejectedFinal = hasRejectedPrimaryFinal(events, trustedHeadSha);
  const githubReadsComplete = hasRequiredGitHubReads(events, trustedHeadSha);
  const sandboxSucceeded = latestSandboxCommandSucceeded(events);
  const subagentToolPolicy = classifySubagentToolUse(events, trustedHeadSha, primaryApprovedChangedFiles(events));
  const subagentToolViolation = subagentToolPolicy.warning || subagentToolPolicy.hard;
  const terminalBundle = readTerminalEvidenceBundle(events);
  const terminalArtifacts = artifacts;
  const terminalAccepted = deduplicateArtifacts(terminalArtifacts);
  const safeForDecision = githubReadsComplete && sandboxSucceeded && !subagentToolViolation && Boolean(trustedHeadSha);
  const reportedDecision = terminalBundle?.fromModel && (!safeForDecision || !terminalBundleCoversPersistedArtifacts(terminalBundle, artifacts))
    ? undefined
    : terminalBundle?.decision ?? findFinalDecision(events, trustedHeadSha, artifacts, accepted.hasConflicts || rejectedFinal || !githubReadsComplete || !sandboxSucceeded || subagentToolViolation);
  const last = events.at(-1);
  const terminal = last ? isPrimaryAgentTurn(last) : false;
  const state = last?.payload.state as { status?: string } | undefined;
  const requiredArtifactTypes: InvestigationArtifact["type"][] = ["InvariantCandidate", "ScenarioPlan", "ExperimentResult"];
  const terminalArtifactTypes = new Set(terminalArtifacts.map((artifact) => artifact.type));
  const completeEvidence = !terminalAccepted.hasConflicts && (Boolean(terminalBundle) || !rejectedFinal) && (!terminalBundle || terminalBundleCoversPersistedArtifacts(terminalBundle, artifacts)) && githubReadsComplete && sandboxSucceeded && !subagentToolViolation && Boolean(trustedHeadSha) && requiredArtifactTypes.every((type) => terminalArtifactTypes.has(type)) && hasConsistentEvidence(terminalArtifacts);
  const reconciledFailure = (terminalBundle?.decision === "BLOCKED" || hasRejectedCompleteEvidenceFinal(events, trustedHeadSha)) && !terminalAccepted.hasConflicts && githubReadsComplete && sandboxSucceeded && !subagentToolViolation && Boolean(trustedHeadSha) && hasValidatedFailedExperiment(terminalAccepted.artifacts);
  const evidenceDecision = terminal && completeEvidence && reportedDecision === "UNCERTAIN" && hasFailedExperiment(terminalArtifacts) ? "BLOCKED" : undefined;
  const decision = evidenceDecision ?? reportedDecision ?? (reconciledFailure ? "BLOCKED" : undefined);
  const subagentMcpFailure = hasSubagentMcpFailure(events);
  const status = state?.status === "cancelled" ? "CANCELLED" : state?.status === "error" ? "ERROR" : subagentMcpFailure || subagentToolViolation ? "UNCERTAIN" : terminal ? (completeEvidence || reconciledFailure) && decision ? decision : "UNCERTAIN" : "RUNNING";
  const warnings = subagentToolPolicy.hard ? ["SUBAGENT_HARD_TOOL_VIOLATION"] : subagentToolPolicy.warning ? ["SUBAGENT_TOOL_POLICY_VIOLATION"] : [];
  const diagnostics = status === "UNCERTAIN" ? uncertaintyDiagnostics({ terminal, trustedHeadSha, githubReadsComplete, sandboxSucceeded, subagentMcpFailure, subagentToolViolation, rejectedFinal, terminalAccepted, terminalArtifacts, completeEvidence, terminalBundle }) : [];

  return {
    artifacts,
    ...(decision ? { decision } : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
    events,
    pullRequestUrl,
    sessionId,
    stage: last?.stage ?? "CONTEXT",
    status,
    turnId: last?.turnId ?? "",
    ...(warnings.length ? { warnings } : {}),
  };
}

function uncertaintyDiagnostics({
  completeEvidence,
  githubReadsComplete,
  rejectedFinal,
  sandboxSucceeded,
  subagentMcpFailure,
  subagentToolViolation,
  terminal,
  terminalAccepted,
  terminalArtifacts,
  terminalBundle,
  trustedHeadSha,
}: {
  completeEvidence: boolean;
  githubReadsComplete: boolean;
  rejectedFinal: boolean;
  sandboxSucceeded: boolean;
  subagentMcpFailure: boolean;
  subagentToolViolation: boolean;
  terminal: boolean;
  terminalAccepted: ReturnType<typeof deduplicateArtifacts>;
  terminalArtifacts: InvestigationArtifact[];
  terminalBundle: ReturnType<typeof readTerminalEvidenceBundle>;
  trustedHeadSha: string | undefined;
}) {
  const diagnostics: string[] = [];
  if (subagentMcpFailure) diagnostics.push("SUBAGENT_MCP_FAILURE");
  if (subagentToolViolation) diagnostics.push("SUBAGENT_TOOL_POLICY_VIOLATION");
  if (!terminal) return diagnostics;
  if (!githubReadsComplete) diagnostics.push("REQUIRED_GITHUB_READS_INCOMPLETE");
  if (!sandboxSucceeded) diagnostics.push("SANDBOX_EXECUTION_INCOMPLETE");
  if (!trustedHeadSha) diagnostics.push("PR_HEAD_SHA_UNAVAILABLE");
  const types = new Set(terminalArtifacts.map((artifact) => artifact.type));
  if (!types.has("InvariantCandidate")) diagnostics.push("MISSING_INVARIANT_EVIDENCE");
  if (!types.has("ScenarioPlan")) diagnostics.push("MISSING_SCENARIO_EVIDENCE");
  if (!types.has("ExperimentResult")) diagnostics.push("MISSING_EXPERIMENT_EVIDENCE");
  const scenarios = terminalArtifacts.filter((artifact) => artifact.type === "ScenarioPlan").map((artifact) => artifact.data);
  const results = terminalArtifacts.filter((artifact) => artifact.type === "ExperimentResult").map((artifact) => artifact.data);
  if (scenarios.some((scenario) => !results.some((result) => scenarioMatchesResult(scenario, result)))) diagnostics.push("MISSING_EXPERIMENT_RESULT");
  if (terminalAccepted.hasConflicts) diagnostics.push("CONFLICTING_EVIDENCE");
  if (!completeEvidence && types.size === 3) diagnostics.push("INCONSISTENT_EVIDENCE");
  if (rejectedFinal) diagnostics.push("REJECTED_FINAL_BUNDLE");
  if (terminalBundle?.decision === "UNCERTAIN" && !rejectedFinal) diagnostics.push("MODEL_REPORTED_UNCERTAIN");
  return [...new Set(diagnostics)];
}

function artifactFromPayload(payload: Record<string, unknown>, trustedHeadSha?: string, baselineSha?: string, stage?: Stage, preflightArtifactLink?: string): InvestigationArtifact[] {
  const extracted: InvestigationArtifact[] = [];
  const capabilityMap = readArtifact("RepositoryCapabilityMap", payload.capabilityMap, trustedHeadSha);
  extracted.push(...capabilityMap);
  const output = isRecord(payload.state) && isRecord(payload.state.output) ? payload.state.output : undefined;
  const content = typeof payload.content === "string" ? payload.content : output?.content;
  if (typeof content === "string") {
    const parsed = parseJson(content);
    const normalized = isRecord(parsed) ? normalizeWireMeasurements(parsed) : parsed;
    if (isRecord(normalized) && "capabilityMap" in normalized) {
      const map = readArtifact("RepositoryCapabilityMap", normalized.capabilityMap, trustedHeadSha);
      extracted.push(...map);
    }
  }
  const bundle = readFinalBundle(payload, trustedHeadSha);
  if (bundle) {
    return [
      ...extracted,
      ...bundle.invariants.map((data) => ({ data, type: "InvariantCandidate" as const })),
      ...bundle.scenarios.map((data) => ({ data, type: "ScenarioPlan" as const })),
      ...bundle.experimentResults.map((data) => ({ data, type: "ExperimentResult" as const })),
    ];
  }
  const wrapped = readArtifact(payload.artifactType, payload.artifact, trustedHeadSha);
  if (wrapped.length > 0) return [...extracted, ...wrapped];

  if (typeof content === "string") {
    const parsed = parseJson(content);
    const hasEvidenceFields = isRecord(parsed) && ("invariants" in parsed || "scenarios" in parsed || "experimentResult" in parsed || "experimentResults" in parsed);
    const normalized = hasEvidenceFields && isRecord(parsed) ? normalizeWireMeasurements(parsed) : parsed;
    if (hasEvidenceFields && isRecord(normalized)) {
      if (normalized.experimentResult !== undefined && normalized.experimentResult !== null && normalized.experimentResults !== undefined && normalized.experimentResults !== null) return [];
      const results = Array.isArray(normalized.experimentResults) ? normalized.experimentResults : normalized.experimentResult === undefined ? [] : [normalized.experimentResult];
      return [
        ...extracted,
        ...(Array.isArray(normalized.invariants) ? readArtifact("InvariantCandidate", normalized.invariants, trustedHeadSha) : []),
        ...(Array.isArray(normalized.scenarios) ? readArtifact("ScenarioPlan", normalized.scenarios, trustedHeadSha) : []),
        ...readArtifact("ExperimentResult", results, trustedHeadSha),
      ];
    }
    const sandboxResults = readSandboxExperimentResults(parsed, trustedHeadSha, baselineSha, preflightArtifactLink);
    if (sandboxResults.length > 0) return [...extracted, ...sandboxResults];
  }
  const type = stage === "INVARIANTS" || (typeof payload.title === "string" && payload.title.startsWith("invariant-analyst"))
    ? "InvariantCandidate"
    : stage === "HYPOTHESES" || (typeof payload.title === "string" && payload.title.startsWith("failure-mode-analyst"))
      ? "ScenarioPlan"
      : undefined;
  return type && typeof content === "string" ? [...extracted, ...readArtifact(type, parseJson(content), trustedHeadSha, type === "ScenarioPlan")] : extracted;
}

function findBaselineSha(events: HarnessEvent[]) {
  for (const event of events) {
    if (event.type !== "tool.response") continue;
    const parsed = typeof event.payload.content === "string" ? parseJson(event.payload.content) : undefined;
    if (!isRecord(parsed)) continue;
    const base = isRecord(parsed.base) ? parsed.base.sha : parsed.base_sha;
    if (typeof base === "string" && /^[a-f0-9]{40}$/.test(base)) return base;
  }
  return undefined;
}

function latestPreflightArtifactLink(events: HarnessEvent[]) {
  for (const event of [...events].reverse()) {
    if (event.type !== "tool.response" || typeof event.payload.content !== "string") continue;
    const response = parseJson(event.payload.content);
    if (!isRecord(response) || response.success !== true || !isRecord(response.response) || response.response.exitCode !== 0 || typeof response.response.result !== "string") continue;
    const preflight = parseJson(response.response.result);
    if (isRecord(preflight) && preflight.phase === "preflight" && preflight.status === "pass" && typeof preflight.artifactLink === "string") return preflight.artifactLink;
  }
  return undefined;
}

function readSandboxExperimentResults(payload: unknown, testedSha?: string, baselineSha?: string, preflightArtifactLink?: string): InvestigationArtifact[] {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.response) || payload.response.exitCode !== 0 || typeof payload.response.result !== "string" || !baselineSha || !testedSha) return [];
  const parsed = parseJson(payload.response.result);
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const result = normalizeExperimentVerdict({
      artifactLinks: candidate.artifactLinks,
      baselineSha,
      expected: candidate.expected,
      observed: candidate.observed,
      preflightArtifactLink: candidate.preflightArtifactLink ?? preflightArtifactLink,
      repetitions: candidate.repetitions ?? 1,
      scenarioId: candidate.scenarioId,
      seed: candidate.seed,
      testedSha: candidate.testedSha,
      verdict: candidate.verdict,
    });
    const validated = experimentResultSchema.safeParse(result);
    return validated.success && validated.data.testedSha === testedSha ? [{ data: validated.data, type: "ExperimentResult" as const }] : [];
  });
}

function deduplicateArtifacts(artifacts: InvestigationArtifact[]) {
  const unique = new Map<string, InvestigationArtifact>();
  const conflicts = new Map<string, number>();
  let hasConflicts = false;
  for (const artifact of artifacts) {
    const data = artifact.data;
    const identity = artifact.type === "InvariantCandidate"
      ? `${artifact.type}:${data.id}:${data.testedSha}`
      : artifact.type === "ScenarioPlan"
        ? `${artifact.type}:${data.scenarioId ?? JSON.stringify(data)}`
        : artifact.type === "RepositoryCapabilityMap"
          ? `${artifact.type}:${data.testedSha}`
          : artifact.type === "PatchProposal"
            ? `${artifact.type}:${data.expectedHeadSha}`
            : `${artifact.type}:${data.scenarioId ?? data.seed}:${data.testedSha}`;
    const existing = unique.get(identity);
    if (!existing) {
      unique.set(identity, artifact);
    } else if (!isDeepStrictEqual(existing.data, data)
      && !(artifact.type === "ExperimentResult" && sameExperimentEvidence(existing.data, data))
      && !(artifact.type === "InvariantCandidate" && sameInvariantEvidence(existing.data, data))
      && !(artifact.type === "ScenarioPlan" && sameScenarioExecution(existing.data, data))) {
      hasConflicts = true;
      const conflictNumber = (conflicts.get(identity) ?? 0) + 1;
      conflicts.set(identity, conflictNumber);
      unique.set(`${identity}:conflict:${conflictNumber}`, artifact);
    }
  }
  return { artifacts: [...unique.values()], hasConflicts };
}

function sameExperimentEvidence(left: Record<string, unknown>, right: Record<string, unknown>) {
  const comparable = (value: Record<string, unknown>) => {
    const evidence = { ...value };
    delete evidence.artifactLinks;
    delete evidence.preflightArtifactLink;
    return evidence;
  };
  return isDeepStrictEqual(comparable(left), comparable(right));
}

function sameScenarioExecution(left: Record<string, unknown>, right: Record<string, unknown>) {
  const comparable = (value: Record<string, unknown>) => {
    const scenario = { ...value };
    delete scenario.expectedOutcome;
    if (!isRecord(scenario.execution)) delete scenario.execution;
    return scenario;
  };
  const leftComparable = comparable(left);
  const rightComparable = comparable(right);
  if (isDeepStrictEqual(leftComparable, rightComparable)) return true;
  if (isRecord(left.execution) && isRecord(right.execution)) return false;
  delete leftComparable.execution;
  delete rightComparable.execution;
  return isDeepStrictEqual(leftComparable, rightComparable);
}

function sameInvariantEvidence(left: Record<string, unknown>, right: Record<string, unknown>) {
  const comparable = (value: Record<string, unknown>) => {
    const invariant = { ...value };
    delete invariant.confidence;
    if (Array.isArray(invariant.evidence)) {
      invariant.evidence = [...invariant.evidence].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return invariant;
  };
  return isDeepStrictEqual(comparable(left), comparable(right));
}

function retainAcceptedScenarioResults(artifacts: InvestigationArtifact[]) {
  const invariantIds = new Set(artifacts.filter((artifact) => artifact.type === "InvariantCandidate").map((artifact) => artifact.data.id).filter((id): id is string => typeof id === "string"));
  const allScenarios = artifacts
    .filter((artifact) => artifact.type === "ScenarioPlan")
    .map((artifact) => artifact.data);
  const scenarios = allScenarios.filter((scenario) => invariantIds.size === 0 || invariantIds.has(scenario.invariantId as string));
  if (scenarios.length === 0) return allScenarios.length === 0 ? artifacts : artifacts.filter((artifact) => artifact.type !== "ScenarioPlan" && artifact.type !== "ExperimentResult");
  return artifacts.filter((artifact) => artifact.type !== "ScenarioPlan" || scenarios.includes(artifact.data)).filter((artifact) => artifact.type !== "ExperimentResult" || scenarios.some((scenario) => scenarioMatchesResult(scenario, artifact.data)));
}

function scenarioMatchesResult(scenario: Record<string, unknown>, result: Record<string, unknown>) {
  if (typeof scenario.scenarioId === "string") return result.scenarioId === scenario.scenarioId;
  return typeof result.scenarioId !== "string" && result.seed === scenario.seed;
}

function readFinalBundle(payload: Record<string, unknown>, trustedHeadSha?: string) {
  const output = isRecord(payload.state) && isRecord(payload.state.output) ? payload.state.output : undefined;
  return typeof output?.content === "string" ? readFinalBundleContent(output.content, trustedHeadSha) : undefined;
}

function readFinalBundleContent(content: string, trustedHeadSha?: string) {
  const parsed = parseJson(content);
  if (!isRecord(parsed)) return undefined;
  const parsedResponse = investigationResponseSchema.safeParse(normalizeWireMeasurements(parsed));
  if (!parsedResponse.success) return undefined;
  if (parsedResponse.data.decision === "UNCERTAIN") {
    return {
      decision: parsedResponse.data.decision,
      experimentResult: parsedResponse.data.experimentResult,
      experimentResults: parsedResponse.data.experimentResults ?? (parsedResponse.data.experimentResult ? [parsedResponse.data.experimentResult] : []),
      invariants: parsedResponse.data.invariants ?? [],
      scenarios: parsedResponse.data.scenarios ?? [],
    };
  }
  try {
    const bundle = validateInvestigationArtifacts(parsedResponse.data);
    if (trustedHeadSha && [...bundle.invariants, ...bundle.scenarios, ...bundle.experimentResults].some((artifact) => artifact.testedSha !== trustedHeadSha)) return undefined;
    return bundle;
  } catch {
    return undefined;
  }
}

function normalizeWireMeasurements(value: Record<string, unknown>): Record<string, unknown> {
  const normalizeResult = (result: unknown) => {
    if (!isRecord(result)) return result;
    const normalize = (measurements: unknown) => {
      if (!Array.isArray(measurements)) return measurements;
      const normalized: Record<string, number> = {};
      for (const measurement of measurements) {
        if (!isRecord(measurement) || typeof measurement.name !== "string" || typeof measurement.value !== "number" || measurement.name.length === 0 || measurement.name in normalized) return measurements;
        normalized[measurement.name] = measurement.value;
      }
      return normalized;
    };
    const normalized = { ...result, expected: normalize(result.expected), observed: normalize(result.observed) };
    return normalizeExperimentVerdict(normalized);
  };
  return {
    ...value,
    invariants: Array.isArray(value.invariants) ? value.invariants.map((invariant) => isRecord(invariant) ? normalizeInvariantCandidate(invariant) : invariant) : value.invariants,
    experimentResult: normalizeResult(value.experimentResult),
    experimentResults: Array.isArray(value.experimentResults) ? value.experimentResults.map(normalizeResult) : value.experimentResults,
  };
}

function normalizeExperimentVerdict(result: Record<string, unknown>) {
  if (result.verdict !== "pass" || !isRecord(result.expected) || !isRecord(result.observed)) return result;
  const expected = result.expected;
  const observed = result.observed;
  const expectedKeys = Object.keys(expected).sort();
  const observedKeys = Object.keys(observed).sort();
  const measurementsMatch = expectedKeys.length === observedKeys.length && expectedKeys.every((key, index) => key === observedKeys[index] && expected[key] === observed[key]);
  return measurementsMatch ? result : { ...result, verdict: "fail" };
}

function readTerminalEvidenceBundle(events: HarnessEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (!isPrimaryAgentTurn(event)) continue;
    const content = primaryFinalOutput(events, index);
    const parsed = content ? parseJson(content) : undefined;
    if (!isRecord(parsed) || (parsed.decision !== "READY" && parsed.decision !== "BLOCKED")) continue;
    const normalized = normalizeWireMeasurements(parsed);
    const experimentResults = normalized.experimentResults ?? (normalized.experimentResult === undefined ? undefined : [normalized.experimentResult]);
    if (!Array.isArray(normalized.invariants) || !Array.isArray(normalized.scenarios) || !Array.isArray(experimentResults)) continue;
    try {
      const bundle = validateInvestigationArtifacts({ decision: normalized.decision as InvestigationDecision, invariants: normalized.invariants, scenarios: normalized.scenarios, experimentResults });
      return { decision: bundle.decision, fromModel: true, artifacts: [
        ...bundle.invariants.map((data) => ({ data, type: "InvariantCandidate" as const })),
        ...bundle.scenarios.map((data) => ({ data, type: "ScenarioPlan" as const })),
        ...bundle.experimentResults.map((data) => ({ data, type: "ExperimentResult" as const })),
      ] };
    } catch {
      if (normalized.decision !== "READY" || !experimentResults.some((result) => isRecord(result) && result.verdict === "fail")) continue;
      try {
        const bundle = validateInvestigationArtifacts({ decision: "BLOCKED", invariants: normalized.invariants, scenarios: normalized.scenarios, experimentResults });
        return { decision: "BLOCKED" as const, fromModel: true, artifacts: [
          ...bundle.invariants.map((data) => ({ data, type: "InvariantCandidate" as const })),
          ...bundle.scenarios.map((data) => ({ data, type: "ScenarioPlan" as const })),
          ...bundle.experimentResults.map((data) => ({ data, type: "ExperimentResult" as const })),
        ] };
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function findFinalDecision(events: HarnessEvent[], trustedHeadSha: string | undefined, artifacts: InvestigationArtifact[], hasArtifactConflicts: boolean): InvestigationDecision | undefined {
  if (hasArtifactConflicts) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (!isPrimaryAgentTurn(event)) continue;
    const content = primaryFinalOutput(events, index);
    const bundle = readFinalBundle(event.payload, trustedHeadSha) ?? (content ? readFinalBundleContent(content, trustedHeadSha) : undefined);
    if (bundle?.decision) return bundle.decision;
    const parsed = content ? parseJson(content) : undefined;
    if (!isRecord(parsed) || (parsed.decision !== "BLOCKED" && parsed.decision !== "READY")) continue;
    try {
      validateInvestigationArtifacts({
        decision: parsed.decision,
        invariants: artifacts.filter((artifact) => artifact.type === "InvariantCandidate").map((artifact) => artifact.data),
        scenarios: artifacts.filter((artifact) => artifact.type === "ScenarioPlan").map((artifact) => artifact.data),
        experimentResults: artifacts.filter((artifact) => artifact.type === "ExperimentResult").map((artifact) => artifact.data),
      });
      return parsed.decision;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isPrimaryAgentTurn(event: HarnessEvent) {
  return event.type === "turn.done" && isPrimaryAgentThread(event);
}

function isPrimaryAgentThread(event: HarnessEvent) {
  return !event.threadId || event.threadId === "main";
}

function hasRejectedPrimaryFinal(events: HarnessEvent[], trustedHeadSha: string | undefined) {
  let rejected = false;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (!isPrimaryAgentTurn(event)) continue;
    const content = primaryFinalOutput(events, index);
    const parsed = content ? parseJson(content) : undefined;
    if (!isRecord(parsed) || !["BLOCKED", "READY", "UNCERTAIN"].includes(parsed.decision as string)) continue;
    rejected = content === undefined || readFinalBundleContent(content, trustedHeadSha) === undefined;
  }
  return rejected;
}

function hasRejectedCompleteEvidenceFinal(events: HarnessEvent[], trustedHeadSha: string | undefined) {
  return events.some((event, index) => {
    if (!isPrimaryAgentTurn(event)) return false;
    const content = primaryFinalOutput(events, index);
    const parsed = content ? parseJson(content) : undefined;
    const hasResults = isRecord(parsed) && ((Array.isArray(parsed.experimentResults) && parsed.experimentResults.length > 0) || isRecord(parsed.experimentResult));
    return isRecord(parsed) && (parsed.decision === "READY" || parsed.decision === "BLOCKED") && Array.isArray(parsed.invariants) && parsed.invariants.length > 0 && Array.isArray(parsed.scenarios) && parsed.scenarios.length > 0 && hasResults && (content === undefined || readFinalBundleContent(content, trustedHeadSha) === undefined);
  });
}

function primaryFinalOutput(events: HarnessEvent[], turnDoneIndex: number) {
  const turnDone = events[turnDoneIndex]!;
  const doneOutput = isRecord(turnDone.payload.state) && isRecord(turnDone.payload.state.output) ? turnDone.payload.state.output : undefined;
  if (typeof doneOutput?.content === "string") return doneOutput.content;
  for (let index = turnDoneIndex - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.turnId !== turnDone.turnId) continue;
    if (event.type === "turn.done") break;
    if (isPrimaryAgentThread(event) && event.type === "model.message" && typeof event.payload.content === "string") return event.payload.content;
  }
  return undefined;
}

function hasConsistentEvidence(artifacts: InvestigationArtifact[]) {
  const invariants = artifacts.filter((artifact) => artifact.type === "InvariantCandidate").map((artifact) => artifact.data);
  const scenarios = artifacts.filter((artifact) => artifact.type === "ScenarioPlan").map((artifact) => artifact.data);
  const experiments = artifacts.filter((artifact) => artifact.type === "ExperimentResult").map((artifact) => artifact.data);
  if (experiments.length < 1) return false;
  try {
    validateInvestigationArtifacts({ invariants, scenarios, experimentResults: experiments });
    return true;
  } catch {
    return false;
  }
}

function terminalBundleCoversPersistedArtifacts(bundle: NonNullable<ReturnType<typeof readTerminalEvidenceBundle>>, artifacts: InvestigationArtifact[]) {
  return (["InvariantCandidate", "ScenarioPlan", "ExperimentResult"] as const).every((type) => {
    const persisted = artifacts.filter((artifact) => artifact.type === type);
    const final = bundle.artifacts.filter((artifact) => artifact.type === type);
    return persisted.length === final.length && persisted.every((artifact) => final.some((candidate) => isDeepStrictEqual(candidate.data, artifact.data)));
  });
}

function hasFailedExperiment(artifacts: InvestigationArtifact[]) {
  return artifacts.some((artifact) => artifact.type === "ExperimentResult" && artifact.data.verdict === "fail");
}

function hasValidatedFailedExperiment(artifacts: InvestigationArtifact[]) {
  const invariants = artifacts.filter((artifact) => artifact.type === "InvariantCandidate").map((artifact) => artifact.data);
  const scenarios = artifacts.filter((artifact) => artifact.type === "ScenarioPlan").map((artifact) => artifact.data);
  return artifacts.some((artifact) => {
    if (artifact.type !== "ExperimentResult" || artifact.data.verdict !== "fail") return false;
    const scenario = scenarios.find((candidate) => scenarioMatchesResult(candidate, artifact.data));
    return Boolean(scenario && invariants.some((invariant) => invariant.id === scenario.invariantId && invariant.testedSha === scenario.testedSha));
  });
}

function hasRequiredGitHubReads(events: HarnessEvent[], trustedHeadSha: string | undefined) {
  const { calls, sawForgeGateCall, sawToolCallMetadata } = primaryGithubToolCalls(events);
  if (!sawToolCallMetadata) return !events.some((event) => isPrimaryAgentThread(event) && event.type === "model.message");
  if (!sawForgeGateCall) return false;

  const completedTools = new Set<string>();
  const completedFiles = new Set<string>();
  let changedFileCount: number | undefined;
  for (const event of events) {
    if (!isPrimaryAgentThread(event) || event.type !== "tool.response") continue;
    const call = typeof event.payload.toolCallId === "string" ? calls.get(event.payload.toolCallId) : undefined;
    if (!call || !isSuccessfulToolResponse(event.payload, call.toolName)) continue;
    if (call.toolName === "get_file") {
      if (trustedHeadSha && call.input.ref === trustedHeadSha && typeof call.input.path === "string") completedFiles.add(call.input.path);
      continue;
    }
    if (call.toolName === "get_pull_request_files") {
      const response = typeof event.payload.content === "string" ? parseJson(event.payload.content) : undefined;
      if (isRecord(response) && Array.isArray(response.files)) {
        changedFileCount = response.files.filter((file) => isRecord(file) && typeof (file.filename ?? file.path) === "string").length;
      }
    }
    completedTools.add(call.toolName);
  }
  return requiredGitHubReadTools.every((toolName) => completedTools.has(toolName))
    && completedFiles.size >= (changedFileCount === undefined ? 2 : Math.min(2, changedFileCount));
}

function primaryGithubToolCalls(events: HarnessEvent[]) {
  const calls = new Map<string, { input: Record<string, unknown>; toolName: string }>();
  let sawToolCallMetadata = false;
  let sawForgeGateCall = false;
  for (const event of events) {
    const toolCalls = readToolCalls(event.payload);
    if (!Array.isArray(toolCalls)) continue;
    if (!isPrimaryAgentThread(event)) continue;
    sawToolCallMetadata = true;
    for (const call of toolCalls) {
      if (!isRecord(call) || typeof call.id !== "string" || !isRecord(call.function) || typeof call.function.name !== "string") continue;
      const args = typeof call.function.arguments === "string" ? parseJson(call.function.arguments) : call.function.arguments;
      if (call.function.name === "call_tool") {
        if (!isRecord(args) || args.mcp_server !== "forgegate-github" || typeof args.tool_name !== "string" || !isRecord(args.input)) continue;
        sawForgeGateCall = true;
        const metadata = { input: args.input, toolName: args.tool_name };
        calls.set(call.id, metadata);
      } else if (githubToolNames.includes(call.function.name as typeof githubToolNames[number]) && isRecord(args)) {
        sawForgeGateCall = true;
        const metadata = { input: args, toolName: call.function.name };
        calls.set(call.id, metadata);
      }
    }
  }
  return { calls, sawForgeGateCall, sawToolCallMetadata };
}

function primaryApprovedChangedFiles(events: HarnessEvent[]) {
  const { calls } = primaryGithubToolCalls(events);
  const approved = new Set<string>();
  for (const event of events) {
    if (!isPrimaryAgentThread(event) || event.type !== "tool.response") continue;
    const call = typeof event.payload.toolCallId === "string" ? calls.get(event.payload.toolCallId) : undefined;
    if (!call || call.toolName !== "get_pull_request_files" || !isSuccessfulToolResponse(event.payload, call.toolName)) continue;
    if (typeof event.payload.content !== "string") continue;
    const parsed = parseJson(event.payload.content);
    const response = isRecord(parsed) && isRecord(parsed.response) ? parsed.response : parsed;
    if (!isRecord(response) || !Array.isArray(response.files)) continue;
    for (const file of response.files) {
      if (!isRecord(file)) continue;
      const path = file.filename ?? file.path;
      if (isRepositoryPath(path)) approved.add(path);
    }
  }
  return approved;
}

const githubToolNames = [...requiredGitHubReadTools, "get_file"] as const;

function readToolCalls(payload: Record<string, unknown>) {
  if (Array.isArray(payload.toolCalls)) return payload.toolCalls;
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  return usage?.toolCalls;
}

function isSuccessfulToolResponse(payload: Record<string, unknown>, toolName?: string) {
  if (payload.isError === true) return false;
  if (typeof payload.content !== "string") return false;
  const parsed = parseJson(payload.content);
  if (!isRecord(parsed) || "error" in parsed) return false;
  if ("success" in parsed) return parsed.success === true;
  if (isRecord(payload.structuredContent)) return true;
  return typeof toolName === "string" && githubToolNames.includes(toolName as typeof githubToolNames[number]);
}

function latestSandboxCommandSucceeded(events: HarnessEvent[]) {
  for (const event of [...events].reverse()) {
    if (!isPrimaryAgentThread(event) || event.type !== "tool.response" || typeof event.payload.content !== "string") continue;
    const parsed = parseJson(event.payload.content);
    const response = isRecord(parsed) && isRecord(parsed.response) ? parsed.response : undefined;
    if (typeof response?.exitCode === "number") return response.exitCode === 0;
  }
  return true;
}

export function hasSubagentToolPolicyViolation(events: TrueForgeEventItem[]) {
  const projected = events.map((item, index) => toHarnessEvent("controller", item, index + 1));
  const policy = classifySubagentToolUse(projected, findPullRequestHeadSha(projected), primaryApprovedChangedFiles(projected));
  return policy.warning || policy.hard;
}

export function hasIncompletePrimaryGitHubReads(items: TrueForgeEventItem[]) {
  const events = items.map((item, index) => toHarnessEvent("controller", item, index + 1));
  const calls = primaryGithubToolCalls(events);
  return calls.sawForgeGateCall && !hasRequiredGitHubReads(events, findPullRequestHeadSha(events));
}

function classifySubagentToolUse(events: HarnessEvent[], trustedHeadSha?: string, approvedChangedFiles = new Set<string>()) {
  const calls = new Map<string, "allowed" | "warning" | "hard">();
  const roles = new Map<string, "invariant" | "failure">();
  const discoveryCalls = new Map<string, number>();
  let warning = false;
  let hard = false;
  for (const event of events) {
    if (event.type === "thread.created" && event.threadId) {
      if (typeof event.payload.title === "string" && event.payload.title.startsWith("invariant-analyst")) roles.set(event.threadId, "invariant");
      if (typeof event.payload.title === "string" && event.payload.title.startsWith("failure-mode-analyst")) roles.set(event.threadId, "failure");
    }
  }
  for (const event of events) {
    if (isPrimaryAgentThread(event)) continue;
    const role = event.threadId ? roles.get(event.threadId) : undefined;
    const usage = isRecord(event.payload.usage) ? event.payload.usage : undefined;
    const toolCalls = Array.isArray(event.payload.toolCalls)
      ? event.payload.toolCalls
      : isRecord(event.payload.toolCalls)
        ? [event.payload.toolCalls]
        : usage?.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        if (!isRecord(call) || typeof call.id !== "string" || !isRecord(call.function)) {
          hard = true;
          continue;
        }
        const args = typeof call.function.arguments === "string" ? parseJson(call.function.arguments) : call.function.arguments;
        const invariantAnalyst = role === "invariant" || event.stage === "INVARIANTS";
        const recoverableRef = invariantAnalyst && (
          call.function.name === "get_file"
            ? isRecoverableSubagentRef("get_file", args, trustedHeadSha, approvedChangedFiles)
            : call.function.name === "call_tool" && isRecord(args) && args.mcp_server === "forgegate-github" && isRecoverableSubagentRef(args.tool_name, args.input, trustedHeadSha, approvedChangedFiles)
        );
        const allowed = invariantAnalyst && (
          call.function.name === "list_tools"
            ? role === "invariant" && event.threadId !== undefined && isRecord(args) && args.mcp_server === "forgegate-github" && (discoveryCalls.get(event.threadId) ?? 0) === 0
            : call.function.name === "call_tool"
              ? isRecord(args)
                && args.mcp_server === "forgegate-github"
                && typeof args.tool_name === "string"
                && isRecord(args.input)
                && isAllowedSubagentRead(args.tool_name, args.input, trustedHeadSha, approvedChangedFiles)
            : typeof call.function.name === "string"
              && isRecord(args)
              && isAllowedSubagentRead(call.function.name, args, trustedHeadSha, approvedChangedFiles)
        );
        if (allowed && call.function.name === "list_tools" && event.threadId) discoveryCalls.set(event.threadId, (discoveryCalls.get(event.threadId) ?? 0) + 1);
        const violation = allowed || recoverableRef ? "allowed" : classifySubagentViolation(call.function.name, args);
        calls.set(call.id, violation);
        if (violation === "warning") warning = true;
        if (violation === "hard") hard = true;
      }
    }
  }
  for (const event of events) {
    if (isPrimaryAgentThread(event) || event.type !== "tool.response") continue;
    if (typeof event.payload.toolCallId === "string") {
      const violation = calls.get(event.payload.toolCallId);
      if (!violation) {
        hard = true;
        continue;
      }
      if (violation === "warning") warning = true;
      if (violation === "hard") hard = true;
      continue;
    }
    if (typeof event.payload.content !== "string") {
      hard = true;
      continue;
    }
    const response = parseJson(event.payload.content);
    if (isRecord(response) && isRecord(response.response) && typeof response.response.exitCode === "number") hard = true;
  }
  return { warning, hard };
}

function classifySubagentViolation(toolName: unknown, args: unknown): "allowed" | "warning" | "hard" {
  if (toolName === "list_tools" || toolName === "get_tool_info") return "warning";
  if (toolName === "exec") return isAllowedSandboxCommand(args) ? "allowed" : "hard";
  if (toolName !== "call_tool") return "hard";
  if (!isRecord(args) || args.mcp_server !== "forgegate-github") return "hard";
  if (args.tool_name === "commit_files") return "hard";
  return "warning";
}

function isAllowedSandboxCommand(args: unknown) {
  if (!isRecord(args) || typeof args.command !== "string") return false;
  const command = args.command.trim();
  if (!command) return false;
  // ponytail: permit normal disposable-sandbox setup/inspection; retain a small
  // denylist for host control and direct external-repository bypasses.
  return !/(?:curl|wget|nc\b|ssh\b|scp\b|docker\b|podman\b|kubectl\b|terraform\b|gh\s|git\s+(?:push|commit|reset|checkout|clean)|\/var\/run\/docker\.sock)/i.test(command);
}

function isAllowedSubagentRead(toolName: string, input: Record<string, unknown>, trustedHeadSha?: string, approvedChangedFiles = new Set<string>()) {
  if (toolName === "get_file") return Boolean(trustedHeadSha && input.ref === trustedHeadSha && isRepositoryPath(input.path) && approvedChangedFiles.has(input.path));
  if (toolName === "get_checks") return Boolean(trustedHeadSha && input.ref === trustedHeadSha);
  return ["get_pull_request", "get_pull_request_files", "get_qodo_reviews", "get_review_comments"].includes(toolName);
}

function isRecoverableSubagentRef(toolName: unknown, input: unknown, trustedHeadSha?: string, approvedChangedFiles = new Set<string>()) {
  return toolName === "get_file"
    && Boolean(trustedHeadSha)
    && isRecord(input)
    && isRepositoryPath(input.path)
    && approvedChangedFiles.has(input.path)
    && typeof input.ref === "string"
    && !/^[a-f0-9]{40}$/.test(input.ref);
}

function isRepositoryPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.split("/").includes("..");
}

function readArtifact(type: unknown, value: unknown, trustedHeadSha?: string, requireExecutableScenario = false): InvestigationArtifact[] {
  if (type !== "ExperimentResult" && type !== "InvariantCandidate" && type !== "PatchProposal" && type !== "RepositoryCapabilityMap" && type !== "ScenarioPlan") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((candidate) => {
    if (type === "RepositoryCapabilityMap" && typeof candidate === "string") candidate = parseJson(candidate);
    if (!isRecord(candidate)) return [];
    const normalized = type === "InvariantCandidate" ? normalizeInvariantCandidate(candidate) : type === "ScenarioPlan" ? normalizeScenarioPlan(candidate) : type === "RepositoryCapabilityMap" ? normalizeRepositoryCapabilityMap(candidate) : candidate;
    if (!isRecord(normalized)) return [];
    if (type === "InvariantCandidate" && !invariantCandidateSchema.safeParse(normalized).success) return [];
    if (type === "ScenarioPlan") {
      const valid = scenarioPlanSchema.safeParse(normalized).success;
      const executable = executableScenarioPlanSchema.safeParse(normalized).success;
      if (!valid || (requireExecutableScenario && !executable)) return [];
    }
    if (type === "ExperimentResult" && !experimentResultSchema.safeParse(candidate).success) return [];
    if (type === "RepositoryCapabilityMap" && !repositoryCapabilityMapSchema.safeParse(normalized).success) return [];
    if (type === "PatchProposal" && !patchProposalSchema.safeParse(normalized).success) return [];
    if (trustedHeadSha && (type === "PatchProposal" ? normalized.expectedHeadSha !== trustedHeadSha : normalized.testedSha !== trustedHeadSha)) return [];
    return [{ data: normalized, type }];
  });
}

function normalizeInvariantCandidate(candidate: Record<string, unknown>) {
  if (typeof candidate.confidence !== "string") return candidate;
  const confidence = { low: 0.3, medium: 0.6, high: 0.9 }[candidate.confidence.toLowerCase() as "low" | "medium" | "high"];
  return confidence === undefined ? candidate : { ...candidate, confidence };
}

function normalizeRepositoryCapabilityMap(candidate: Record<string, unknown>) {
  if (!Array.isArray(candidate.operations)) return candidate;
  return {
    ...candidate,
    operations: candidate.operations.filter((operation) => isRecord(operation) && Array.isArray(operation.supportedFaults) && operation.supportedFaults.some((fault) => typeof fault === "string" && fault.length > 0)),
  };
}

function findPullRequestHeadSha(events: HarnessEvent[]) {
  const { calls, sawForgeGateCall, sawToolCallMetadata } = primaryGithubToolCalls(events);
  if (sawToolCallMetadata && !sawForgeGateCall) return undefined;
  for (const event of events) {
    if (!isPrimaryAgentThread(event) || event.type !== "tool.response" || typeof event.payload.content !== "string") continue;
    if (sawToolCallMetadata && (typeof event.payload.toolCallId !== "string" || calls.get(event.payload.toolCallId)?.toolName !== "get_pull_request" || !isSuccessfulToolResponse(event.payload, "get_pull_request"))) continue;
    const response = parseJson(event.payload.content);
    if (isRecord(response) && isRecord(response.head) && typeof response.head.sha === "string" && /^[a-f0-9]{40}$/.test(response.head.sha)) {
      return response.head.sha;
    }
  }
  return undefined;
}

function mergeModelDeltas(events: HarnessEvent[]) {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  return events.filter((event) => {
    const baseEventId = event.payload.baseEventId;
    const delta = event.payload.delta;
    if (typeof baseEventId !== "string" || !isRecord(delta)) return true;
    const base = byId.get(baseEventId);
    if (!base) return true;
    base.payload = { ...base.payload, ...delta };
    return false;
  });
}

function applyThreadStages(events: HarnessEvent[]) {
  const stagesByThread = new Map<string, Stage>();
  return events.map((event) => {
    if (event.type === "thread.created") {
      const stage = analystStage(event.payload.title) ?? event.stage;
      if (event.threadId) stagesByThread.set(event.threadId, stage);
      return { ...event, stage };
    }
    const stage = event.threadId ? stagesByThread.get(event.threadId) : undefined;
    return stage ? { ...event, stage } : event;
  });
}

function analystStage(title: unknown): Stage | undefined {
  if (typeof title === "string" && title.startsWith("invariant-analyst")) return "INVARIANTS";
  if (typeof title === "string" && title.startsWith("failure-mode-analyst")) return "HYPOTHESES";
  return undefined;
}

function hasSubagentMcpFailure(events: HarnessEvent[]) {
  return events.some((event) => event.type === "tool.response" && event.threadId !== undefined && event.threadId !== "main" && typeof event.payload.content === "string" && /Tool call failed: Tool |MCP server ['\"].*not found/i.test(event.payload.content));
}

function parseJson(content: string): unknown {
  const body = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const candidates = [body, ...[...body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]!.trim())];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      const withoutTrailingCommas = candidate.replace(/,(\s*[}\]])/g, "$1").replace(/,\s*$/, "");
      if (withoutTrailingCommas === candidate) continue;
      try {
        return JSON.parse(withoutTrailingCommas) as unknown;
      } catch {
        // Try the next fenced or raw JSON candidate.
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createInvestigationService(gateway: InvestigationGateway) {
  const records = new Map<string, InvestigationRecord>();
  const idempotency = new Map<string, { pullRequestUrl: string; result: LaunchResult }>();
  const inFlight = new Map<string, { pullRequestUrl: string; promise: Promise<LaunchResult> }>();
  const submittedApprovals = new Set<string>();

  return {
    async approve(sessionId: string, approvalId: string, decision: "allow" | "deny") {
      const record = await resolveRecord(sessionId);
      if (!record) throw new InvestigationNotFoundError();
      const approvalKey = `${sessionId}:${approvalId}`;
      if (submittedApprovals.has(approvalKey)) throw new ApprovalAlreadySubmittedError();
      const pending = (await gateway.listEvents(sessionId)).map((item) => item.event).reverse().find((event) => event.type === "tool.approval_required" && pendingToolCallIds(event).includes(approvalId));
      if (!pending || typeof pending.threadId !== "string") throw new ApprovalNotFoundError();
      if (!gateway.approve) throw new Error("approval resumer is unavailable");
      submittedApprovals.add(approvalKey);
      await gateway.approve(sessionId, { decision, threadId: pending.threadId, toolCallId: approvalId });
      return get(sessionId);
    },
    async cancel(sessionId: string) {
      const record = await resolveRecord(sessionId);
      if (!record) throw new InvestigationNotFoundError();
      await gateway.cancel(sessionId);
      return get(sessionId);
    },
    async create(pullRequestUrl: string, key?: string) {
      const normalizedPullRequestUrl = normalizePullRequestUrl(pullRequestUrl);
      const fingerprint = key ? requestFingerprint(key) : undefined;
      const previous = key ? idempotency.get(key) : undefined;
      if (previous) {
        if (previous.pullRequestUrl !== normalizedPullRequestUrl) throw new IdempotencyConflictError();
        return previous.result;
      }
      const recovered = fingerprint ? await gateway.findByRequestFingerprint?.(fingerprint) : undefined;
      if (recovered) {
        if (recovered.pullRequestUrl !== normalizedPullRequestUrl) throw new IdempotencyConflictError();
        idempotency.set(key!, recovered);
        records.set(recovered.result.sessionId, { pullRequestUrl: recovered.pullRequestUrl, turnId: recovered.result.turnId });
        return recovered.result;
      }
      const pending = key ? inFlight.get(key) : undefined;
      if (pending) {
        if (pending.pullRequestUrl !== normalizedPullRequestUrl) throw new IdempotencyConflictError();
        return pending.promise;
      }
      const launch = Promise.resolve()
        .then(() => gateway.launch(fingerprint ? { pullRequestUrl, requestFingerprint: fingerprint } : { pullRequestUrl }))
        .then((result) => {
          records.set(result.sessionId, { pullRequestUrl: normalizedPullRequestUrl, turnId: result.turnId });
          if (key) {
            inFlight.delete(key);
            idempotency.set(key, { pullRequestUrl: normalizedPullRequestUrl, result });
          }
          return result;
        });
      if (key) inFlight.set(key, { pullRequestUrl: normalizedPullRequestUrl, promise: launch });
      try {
        return await launch;
      } catch (error) {
        if (key && inFlight.get(key)?.promise === launch) inFlight.delete(key);
        throw error;
      }
    },
    async get(sessionId: string) {
      const record = await resolveRecord(sessionId);
      if (!record) throw new InvestigationNotFoundError();
      return projectInvestigation(sessionId, record.pullRequestUrl, await gateway.listEvents(sessionId));
    },
  };

  async function resolveRecord(sessionId: string) {
    const record = records.get(sessionId) ?? (await gateway.getMetadata?.(sessionId));
    if (record) records.set(sessionId, record);
    return record;
  }

  async function get(sessionId: string) {
    const record = await resolveRecord(sessionId);
    if (!record) throw new InvestigationNotFoundError();
    return projectInvestigation(sessionId, record.pullRequestUrl, await gateway.listEvents(sessionId));
  }
}

function pendingToolCallIds(event: Record<string, unknown>) {
  if (typeof event.toolCallId === "string") return [event.toolCallId];
  const calls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  return calls.flatMap((call) => isRecord(call) && typeof call.id === "string" ? [call.id] : []);
}

function requestFingerprint(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function normalizePullRequestUrl(pullRequestUrl: string) {
  const url = new URL(pullRequestUrl);
  url.hash = "";
  return url.toString();
}

function toHarnessEvent(sessionId: string, item: TrueForgeEventItem, sequence: number): HarnessEvent {
  const event = item.event;
  const trueForgeSequence = typeof event.sequence === "number" && Number.isSafeInteger(event.sequence) && event.sequence > 0 ? event.sequence : sequence;
  const type = String(event.type ?? "unknown");
  const source = sourceFor(type);
  return {
    eventId: String(event.id ?? `${sessionId}-${trueForgeSequence}`),
    occurredAt: String(event.createdAt ?? new Date(0).toISOString()),
    payload: sanitizePayload(event),
    sequence: trueForgeSequence,
    sessionId,
    source: typeof event.threadId === "string" && event.threadId !== "main" ? "SUBAGENT" : source,
    stage: stageFor(event),
    ...(typeof event.threadId === "string" ? { threadId: event.threadId } : {}),
    turnId: item.turnId,
    type,
  };
}

function sanitizePayload(event: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(event).filter(([key]) => !["id", "type", "createdAt", "threadId", "turnId", "reasoningContent"].includes(key)));
}

function sourceFor(type: string): Source {
  if (type.startsWith("mcp.")) return "GITHUB";
  if (type.startsWith("sandbox.")) return "SANDBOX";
  if (type.startsWith("thread.")) return "SUBAGENT";
  if (type.startsWith("tool.")) return type.includes("approval") ? "HUMAN" : "AGENT";
  return type.startsWith("turn.") ? "SYSTEM" : "AGENT";
}

function stageFor(event: Record<string, unknown>): Stage {
  const type = String(event.type ?? "unknown");
  if (type === "thread.created") return analystStage(event.title) ?? "CONTEXT";
  if (type === "sandbox.created") return "EXPERIMENT";
  if (type.startsWith("sandbox.")) return "TESTING";
  if (type === "tool.approval_required" || type === "tool.response_required") return "APPROVAL";
  if (type === "turn.done") return "DECISION";
  if (type === "tool.response") return "EVIDENCE";
  return "CONTEXT";
}
import { createHash } from "node:crypto";
