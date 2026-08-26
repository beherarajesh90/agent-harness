import { buildApp } from "./app.js";
import { createInvestigationService } from "./investigation.js";
import { createTrueForgeInvestigationLauncher } from "./trueforge-investigation.js";
import { createTrueForgeClient, createTrueForgeReadinessProbe } from "./trueforge.js";

const trueforgeBaseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";
const trueforge = createTrueForgeClient({ baseUrl: trueforgeBaseUrl });
const repository = requiredEnvironment("FORGEGATE_DEMO_REPO");
const launcher = createTrueForgeInvestigationLauncher({
  modelName: process.env.TRUEFORGE_MODEL ?? "openrouter/openai-gpt-oss-120b",
  repository,
  sessions: trueforge.sessions,
});
const investigations = createInvestigationService({
  cancel: (sessionId) => trueforge.sessions.cancel(sessionId),
  launch: launcher,
  listEvents: async (sessionId) => {
    const items = [];
    let page = await trueforge.sessions.listEvents(sessionId, { limit: 100 });
    do {
      items.push(...page.data.map((item) => ({ event: item.event as unknown as Record<string, unknown>, turnId: item.turnId })));
      if (!page.hasNextPage()) break;
      page = await page.getNextPage();
    } while (true);
    return items;
  },
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
