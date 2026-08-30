import { buildApp } from "./app.js";
import { createInvestigationService } from "./investigation.js";
import { createTrueForgeApprovalResumer, createTrueForgeInvestigationLauncher } from "./trueforge-investigation.js";
import { createTrueForgeClient, createTrueForgeReadinessProbe } from "./trueforge.js";

const trueforgeBaseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";
const trueforge = createTrueForgeClient({ baseUrl: trueforgeBaseUrl });
const repository = requiredEnvironment("FORGEGATE_DEMO_REPO");
const launcher = createTrueForgeInvestigationLauncher({
  modelName: process.env.TRUEFORGE_MODEL ?? "openrouter/openai-gpt-oss-120b",
  repository,
  sessions: trueforge.sessions,
  listEvents,
});
const investigations = createInvestigationService({
  approve: createTrueForgeApprovalResumer(trueforge.sessions),
  cancel: (sessionId) => trueforge.sessions.cancel(sessionId),
  findByRequestFingerprint: async (fingerprint) => {
    let page = await trueforge.sessions.list();
    do {
      for (const session of page.data) {
        const metadata = await readInvestigationMetadata(session.id);
        if (metadata?.fingerprint === fingerprint) {
          return { pullRequestUrl: metadata.pullRequestUrl, result: { sessionId: session.id, turnId: metadata.turnId } };
        }
      }
      if (!page.hasNextPage()) break;
      page = await page.getNextPage();
    } while (true);
    return undefined;
  },
  getMetadata: async (sessionId) => {
    const metadata = await readInvestigationMetadata(sessionId);
    return metadata ? { pullRequestUrl: metadata.pullRequestUrl, turnId: metadata.turnId } : undefined;
  },
  launch: launcher,
  listEvents,
});
const app = buildApp({
  investigationService: investigations,
  isTrueForgeReady: createTrueForgeReadinessProbe({ baseUrl: trueforgeBaseUrl }),
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ host, port });

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function listEvents(sessionId: string) {
  const items = [];
  let page = await trueforge.sessions.listEvents(sessionId, { limit: 100 });
  do {
    items.push(...page.data.map((item) => ({ event: item.event as unknown as Record<string, unknown>, turnId: item.turnId })));
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  } while (true);
  return items;
}

async function readInvestigationMetadata(sessionId: string) {
  const items = await listEvents(sessionId);
  const created = items.find((item) => item.event.type === "turn.created");
  const content = (created?.event.input as Array<{ content?: unknown }> | undefined)?.[0]?.content;
  if (typeof content !== "string") return undefined;
  const request = content.match(/ForgeGate request fingerprint: ([a-f0-9]{64})\./);
  const pullRequestUrl = content.match(/Investigate (https:\/\/github\.com\/[^\s]+) in /)?.[1];
  if (!pullRequestUrl) return undefined;
  return { fingerprint: request?.[1], pullRequestUrl, turnId: created?.turnId ?? "" };
}
