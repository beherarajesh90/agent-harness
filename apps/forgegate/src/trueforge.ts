import { TrueForge } from "@truefoundry/trueforge-sdk";

export function createTrueForgeClient({
  baseUrl,
  fetch = globalThis.fetch,
}: {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}) {
  return new TrueForge({
    auth: false,
    baseUrl,
    fetch,
    maxRetries: 0,
    timeoutInSeconds: 20,
  });
}

export function createTrueForgeReadinessProbe({
  baseUrl,
  fetch = globalThis.fetch,
}: {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}) {
  // Source: https://www.npmjs.com/package/@truefoundry/trueforge-sdk
  // The generated client accepts a server origin and supports passthrough fetches.
  const client = createTrueForgeClient({ baseUrl, fetch });

  return async () => {
    try {
      const response = await client.fetch("/healthz", { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  };
}
