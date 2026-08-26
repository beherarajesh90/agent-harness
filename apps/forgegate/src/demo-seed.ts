const baseBranch = "master";
const paymentLabPath = "apps/forgegate/src/payment-lab.ts";
const safeRetryMarker =
  "const unsafeRetry = attempt === 1 && options.unsafeRetryForIntentIds?.has(input.intentId);";
const unsafeRetryReplacement = "const unsafeRetry = attempt === 1;";

export type DemoSeedClient = {
  createBranch(branch: string, sha: string): Promise<void>;
  createPullRequest(input: { base: string; body: string; head: string; title: string }): Promise<{
    number: number;
    url: string;
  }>;
  getBranch(branch: string): Promise<{ sha: string }>;
  getFile(path: string, ref: string): Promise<{ content: string; sha: string }>;
  updateFile(input: { branch: string; content: string; message: string; path: string; sha: string }): Promise<void>;
};

export async function seedDemo({
  client,
  now = new Date(),
}: {
  client: DemoSeedClient;
  now?: Date;
}) {
  const master = await client.getBranch(baseBranch);
  const source = await client.getFile(paymentLabPath, master.sha);
  if (!source.content.includes(safeRetryMarker)) {
    throw new Error("safe retry marker was not found on master");
  }

  const branch = `forgegate/demo-${formatTimestamp(now)}`;
  await client.createBranch(branch, master.sha);
  await client.updateFile({
    branch,
    content: source.content.replace(safeRetryMarker, unsafeRetryReplacement),
    message: "demo: expose retry idempotency failure",
    path: paymentLabPath,
    sha: source.sha,
  });
  const pullRequest = await client.createPullRequest({
    base: baseBranch,
    body: [
      "This operator-seeded PR intentionally removes provider retry idempotency.",
      "Expected evidence: 100 intents, 102 charges, and 100 ledger entries.",
    ].join("\n\n"),
    head: branch,
    title: "demo: unsafe payment retry",
  });

  return {
    branch,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
  };
}

function formatTimestamp(value: Date) {
  const timestamp = value.toISOString();
  return `${timestamp.slice(0, 10).replaceAll("-", "")}-${timestamp.slice(11, 23).replace(/[.:]/g, "")}`;
}
