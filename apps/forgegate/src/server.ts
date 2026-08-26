import { buildApp } from "./app.js";
import { createTrueForgeReadinessProbe } from "./trueforge.js";

const trueforgeBaseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";
const app = buildApp({
  isTrueForgeReady: createTrueForgeReadinessProbe({ baseUrl: trueforgeBaseUrl }),
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ host, port });
