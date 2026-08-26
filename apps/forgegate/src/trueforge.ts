import { TrueForge } from "@truefoundry/trueforge-sdk";

export function createTrueForgeReadinessProbe({
  baseUrl,
  fetch = globalThis.fetch,
}: {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}) {
  // Source: https://www.npmjs.com/package/@truefoundry/trueforge-sdk
  // The generated client accepts a server origin and supports passthrough fetches.
  const client = new TrueForge({
    auth: false,
    baseUrl,
    fetch,
    maxRetries: 0,
    timeoutInSeconds: 2,
  });

  return async () => {
    try {
      const response = await client.fetch("/healthz", { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  };
}
