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
  events: HarnessEvent[];
  pullRequestUrl: string;
  sessionId: string;
  stage: Stage;
  status: Status;
  turnId: string;
};

type TrueForgeEventItem = { event: Record<string, unknown>; turnId: string };
type InvestigationGateway = {
  cancel: (sessionId: string) => Promise<unknown>;
  listEvents: (sessionId: string) => Promise<TrueForgeEventItem[]>;
  launch: (input: { pullRequestUrl: string }) => Promise<{ sessionId: string; turnId: string }>;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key is already bound to a different pull request");
    this.name = "IdempotencyConflictError";
  }
}

export function projectInvestigation(sessionId: string, pullRequestUrl: string, items: TrueForgeEventItem[]): InvestigationSnapshot {
  const events = items
    .slice()
    .reverse()
    .map((item, index) => toHarnessEvent(sessionId, item, index + 1));
  const last = events.at(-1);
  const terminal = last?.type === "turn.done";
  const state = last?.payload.state as { status?: string } | undefined;
  const status = state?.status === "cancelled" ? "CANCELLED" : state?.status === "error" ? "ERROR" : terminal ? "READY" : "RUNNING";

  return {
    events,
    pullRequestUrl,
    sessionId,
    stage: last?.stage ?? "CONTEXT",
    status,
    turnId: last?.turnId ?? "",
  };
}

export function createInvestigationService(gateway: InvestigationGateway) {
  const records = new Map<string, { pullRequestUrl: string; turnId: string }>();
  const idempotency = new Map<string, { pullRequestUrl: string; result: { sessionId: string; turnId: string } }>();

  return {
    async cancel(sessionId: string) {
      const record = records.get(sessionId);
      if (!record) throw new Error("investigation not found");
      await gateway.cancel(sessionId);
      return get(sessionId);
    },
    async create(pullRequestUrl: string, key?: string) {
      const normalizedPullRequestUrl = normalizePullRequestUrl(pullRequestUrl);
      const previous = key ? idempotency.get(key) : undefined;
      if (previous) {
        if (previous.pullRequestUrl !== normalizedPullRequestUrl) throw new IdempotencyConflictError();
        return previous.result;
      }
      const result = await gateway.launch({ pullRequestUrl });
      records.set(result.sessionId, { pullRequestUrl: normalizedPullRequestUrl, turnId: result.turnId });
      if (key) idempotency.set(key, { pullRequestUrl: normalizedPullRequestUrl, result });
      return result;
    },
    async get(sessionId: string) {
      const record = records.get(sessionId);
      if (!record) throw new Error("investigation not found");
      return projectInvestigation(sessionId, record.pullRequestUrl, await gateway.listEvents(sessionId));
    },
  };

  async function get(sessionId: string) {
    const record = records.get(sessionId);
    if (!record) throw new Error("investigation not found");
    return projectInvestigation(sessionId, record.pullRequestUrl, await gateway.listEvents(sessionId));
  }
}

function normalizePullRequestUrl(pullRequestUrl: string) {
  const url = new URL(pullRequestUrl);
  url.hash = "";
  return url.toString();
}

function toHarnessEvent(sessionId: string, item: TrueForgeEventItem, sequence: number): HarnessEvent {
  const event = item.event;
  const type = String(event.type ?? "unknown");
  const source = sourceFor(type);
  return {
    eventId: String(event.id ?? `${sessionId}-${sequence}`),
    occurredAt: String(event.createdAt ?? new Date(0).toISOString()),
    payload: sanitizePayload(event),
    sequence,
    sessionId,
    source,
    stage: stageFor(type),
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

function stageFor(type: string): Stage {
  if (type === "thread.created") return "INVARIANTS";
  if (type === "sandbox.created") return "EXPERIMENT";
  if (type === "tool.approval_required" || type === "tool.response_required") return "APPROVAL";
  if (type === "turn.done") return "DECISION";
  if (type === "tool.response") return "EVIDENCE";
  return "CONTEXT";
}
