import { experimentResultSchema, investigationResponseSchema, invariantCandidateSchema, scenarioPlanSchema, validateInvestigationArtifacts } from "./agent-spec.js";
import type { InvestigationDecision } from "./agent-spec.js";

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
  events: HarnessEvent[];
  pullRequestUrl: string;
  sessionId: string;
  stage: Stage;
  status: Status;
  turnId: string;
};

export type InvestigationArtifact = {
  data: Record<string, unknown>;
  type: "ExperimentResult" | "InvariantCandidate" | "ScenarioPlan";
};

type TrueForgeEventItem = { event: Record<string, unknown>; turnId: string };
type InvestigationRecord = { pullRequestUrl: string; turnId: string };
type LaunchResult = { sessionId: string; turnId: string };
type InvestigationGateway = {
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

export function projectInvestigation(sessionId: string, pullRequestUrl: string, items: TrueForgeEventItem[]): InvestigationSnapshot {
  const projected = mergeModelDeltas(items.map((item, index) => toHarnessEvent(sessionId, item, items.length - index)));
  const seenSequences = new Set<number>();
  const events = applyThreadStages(projected.filter((event) => {
    if (seenSequences.has(event.sequence)) return false;
    seenSequences.add(event.sequence);
    return true;
  }).sort((left, right) => left.sequence - right.sequence));
  const trustedHeadSha = findPullRequestHeadSha(events);
  const artifacts = deduplicateArtifacts(events.flatMap((event) => artifactFromPayload(event.payload, trustedHeadSha)));
  const decision = findFinalDecision(events, trustedHeadSha, artifacts);
  const last = events.at(-1);
  const terminal = last ? isPrimaryAgentTurn(last) : false;
  const state = last?.payload.state as { status?: string } | undefined;
  const artifactTypes = new Set(artifacts.map((artifact) => artifact.type));
  const requiredArtifactTypes: InvestigationArtifact["type"][] = ["InvariantCandidate", "ScenarioPlan", "ExperimentResult"];
  const completeEvidence = Boolean(trustedHeadSha) && requiredArtifactTypes.every((type) => artifactTypes.has(type)) && hasConsistentEvidence(artifacts);
  const experimentFailed = artifacts.some((artifact) => artifact.type === "ExperimentResult" && (artifact.data.verdict === "fail" || paymentInvariantViolated(artifact.data)));
  const subagentMcpFailure = hasSubagentMcpFailure(events);
  const status = state?.status === "cancelled" ? "CANCELLED" : state?.status === "error" ? "ERROR" : subagentMcpFailure ? "UNCERTAIN" : (terminal && (state?.status === "blocked" || experimentFailed) && completeEvidence && !decision) ? "BLOCKED" : terminal ? completeEvidence ? decision ?? "READY" : "UNCERTAIN" : "RUNNING";

  return {
    artifacts,
    ...(decision ? { decision } : {}),
    events,
    pullRequestUrl,
    sessionId,
    stage: last?.stage ?? "CONTEXT",
    status,
    turnId: last?.turnId ?? "",
  };
}

function artifactFromPayload(payload: Record<string, unknown>, trustedHeadSha?: string): InvestigationArtifact[] {
  const bundle = readFinalBundle(payload, trustedHeadSha);
  if (bundle) {
    return [
      ...bundle.invariants.map((data) => ({ data, type: "InvariantCandidate" as const })),
      ...bundle.scenarios.map((data) => ({ data, type: "ScenarioPlan" as const })),
      ...bundle.experimentResults.map((data) => ({ data, type: "ExperimentResult" as const })),
    ];
  }
  const wrapped = readArtifact(payload.artifactType, payload.artifact, trustedHeadSha);
  if (wrapped.length > 0) return wrapped;

  const output = isRecord(payload.state) && isRecord(payload.state.output) ? payload.state.output : undefined;
  const content = output?.content;
  if (typeof content === "string") {
    const parsed = parseJson(content);
    if (isRecord(parsed) && ("invariants" in parsed || "scenarios" in parsed || "experimentResult" in parsed || "experimentResults" in parsed)) {
      const results = Array.isArray(parsed.experimentResults) ? parsed.experimentResults : parsed.experimentResult === undefined ? [] : [parsed.experimentResult];
      return [
        ...(Array.isArray(parsed.invariants) ? readArtifact("InvariantCandidate", parsed.invariants, trustedHeadSha) : []),
        ...(Array.isArray(parsed.scenarios) ? readArtifact("ScenarioPlan", parsed.scenarios, trustedHeadSha) : []),
        ...readArtifact("ExperimentResult", results, trustedHeadSha),
      ];
    }
  }
  const type = payload.title === "invariant-analyst" ? "InvariantCandidate" : payload.title === "failure-mode-analyst" ? "ScenarioPlan" : undefined;
  return type && typeof content === "string" ? readArtifact(type, parseJson(content), trustedHeadSha) : [];
}

function deduplicateArtifacts(artifacts: InvestigationArtifact[]) {
  const unique = new Map<string, InvestigationArtifact>();
  for (const artifact of artifacts) {
    const data = artifact.data;
    const identity = artifact.type === "InvariantCandidate"
      ? `${artifact.type}:${data.id}:${data.testedSha}`
      : artifact.type === "ScenarioPlan"
        ? `${artifact.type}:${data.scenarioId ?? JSON.stringify(data)}`
        : `${artifact.type}:${data.scenarioId ?? data.seed}:${data.testedSha}`;
    unique.set(identity, artifact);
  }
  return [...unique.values()];
}

function readFinalBundle(payload: Record<string, unknown>, trustedHeadSha?: string) {
  const output = isRecord(payload.state) && isRecord(payload.state.output) ? payload.state.output : undefined;
  const parsed = typeof output?.content === "string" ? parseJson(output.content) : undefined;
  if (!isRecord(parsed)) return undefined;
  const parsedResponse = investigationResponseSchema.safeParse(parsed);
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

function findFinalDecision(events: HarnessEvent[], trustedHeadSha: string | undefined, artifacts: InvestigationArtifact[]): InvestigationDecision | undefined {
  for (const event of [...events].reverse()) {
    if (!isPrimaryAgentTurn(event)) continue;
    const bundle = readFinalBundle(event.payload, trustedHeadSha);
    if (bundle?.decision) return bundle.decision;
    const output = isRecord(event.payload.state) && isRecord(event.payload.state.output) ? event.payload.state.output : undefined;
    const parsed = typeof output?.content === "string" ? parseJson(output.content) : undefined;
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
  return event.type === "turn.done" && (!event.threadId || event.threadId === "main");
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

function readArtifact(type: unknown, value: unknown, trustedHeadSha?: string): InvestigationArtifact[] {
  if (type !== "ExperimentResult" && type !== "InvariantCandidate" && type !== "ScenarioPlan") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    if (type === "InvariantCandidate" && !invariantCandidateSchema.safeParse(candidate).success) return [];
    if (type === "ScenarioPlan" && !scenarioPlanSchema.safeParse(candidate).success) return [];
    if (type === "ExperimentResult" && !experimentResultSchema.safeParse(candidate).success) return [];
    if (trustedHeadSha && candidate.testedSha !== trustedHeadSha) return [];
    return [{ data: candidate, type }];
  });
}

function findPullRequestHeadSha(events: HarnessEvent[]) {
  for (const event of events) {
    if (event.type !== "tool.response" || typeof event.payload.content !== "string") continue;
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
  if (title === "invariant-analyst") return "INVARIANTS";
  if (title === "failure-mode-analyst") return "HYPOTHESES";
  return undefined;
}

function hasSubagentMcpFailure(events: HarnessEvent[]) {
  return events.some((event) => event.type === "tool.response" && event.threadId !== undefined && event.threadId !== "main" && typeof event.payload.content === "string" && /Tool call failed: Tool |MCP server ['\"].*not found/i.test(event.payload.content));
}

function paymentInvariantViolated(data: Record<string, unknown>) {
  const observed = data.observed;
  if (!isRecord(observed)) return false;
  return observed.charges !== observed.intents || observed.ledgerEntries !== observed.intents;
}

function parseJson(content: string): unknown {
  const body = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createInvestigationService(gateway: InvestigationGateway) {
  const records = new Map<string, InvestigationRecord>();
  const idempotency = new Map<string, { pullRequestUrl: string; result: LaunchResult }>();
  const inFlight = new Map<string, { pullRequestUrl: string; promise: Promise<LaunchResult> }>();

  return {
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
    source: typeof event.threadId === "string" && event.threadId !== "main" && type.startsWith("tool.") ? "SUBAGENT" : source,
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
