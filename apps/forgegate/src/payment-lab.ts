import { DatabaseSync } from "node:sqlite";

type PaymentInput = {
  amount: number;
  idempotencyKey: string;
  intentId: string;
};

type PaymentResult = {
  intentId: string;
  status: "settled";
};

type PaymentStatus = "pending" | "settled" | "failed";

type WebhookInput = {
  eventId: string;
  intentId: string;
};

type PaymentLaboratoryOptions = {
  faultSchedule?: {
    failBeforeChargeForIntentIds?: ReadonlySet<string>;
    timeoutAfterChargeForIntentIds?: ReadonlySet<string>;
  };
  unsafeRetryForIntentIds?: ReadonlySet<string>;
};

export type PaymentEvidence = { charges: number; intents: number; ledgerEntries: number };

export type ExperimentResult = {
  artifactLinks: string[];
  baselineSha: string;
  expected: PaymentEvidence;
  observed: PaymentEvidence;
  repetitions: number;
  scenarioId?: string;
  seed: number;
  testedSha: string;
  verdict: "pass" | "fail";
};

export type PaymentScenario = {
  injectedFaults: string[];
  scenarioId?: string;
  seed: number;
};

class ProviderTimeoutError extends Error {}
class ProviderDeclinedError extends Error {}

export function createPaymentLaboratory(options: PaymentLaboratoryOptions = {}) {
  const database = new DatabaseSync(":memory:");
  const providerDatabase = new DatabaseSync(":memory:");
  const timedOutIntentIds = new Set<string>();
  let providerAttempts = 0;

  database.exec(`
    CREATE TABLE payment_intents (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE ledger_entries (
      id INTEGER PRIMARY KEY,
      intent_id TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE webhook_events (
      event_id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL
    ) STRICT;
  `);
  providerDatabase.exec(`
    CREATE TABLE provider_charges (
      id INTEGER PRIMARY KEY,
      intent_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE
    ) STRICT;
  `);

  const findIntentByIdempotencyKey = database.prepare(
    "SELECT id, status FROM payment_intents WHERE idempotency_key = ?",
  );
  const createIntent = database.prepare(
    "INSERT INTO payment_intents (id, amount, idempotency_key, status) VALUES (?, ?, ?, 'pending')",
  );
  const createLedgerEntry = database.prepare(
    "INSERT INTO ledger_entries (intent_id, amount) VALUES (?, ?)",
  );
  const settleIntent = database.prepare("UPDATE payment_intents SET status = 'settled' WHERE id = ?");
  const failIntent = database.prepare("UPDATE payment_intents SET status = 'failed' WHERE id = ?");
  const recordWebhook = database.prepare(
    "INSERT OR IGNORE INTO webhook_events (event_id, intent_id) VALUES (?, ?)",
  );
  const findProviderCharge = providerDatabase.prepare(
    "SELECT id FROM provider_charges WHERE idempotency_key = ?",
  );
  const createProviderCharge = providerDatabase.prepare(
    "INSERT INTO provider_charges (intent_id, amount, idempotency_key) VALUES (?, ?, ?)",
  );
  const totalIntents = database.prepare("SELECT COUNT(*) AS total FROM payment_intents");
  const totalLedgerEntries = database.prepare("SELECT COUNT(*) AS total FROM ledger_entries");
  const totalProviderCharges = providerDatabase.prepare("SELECT COUNT(*) AS total FROM provider_charges");
  const totalLedgerAmount = database.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries");
  const totalProviderChargeAmount = providerDatabase.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM provider_charges",
  );
  const intentRows = database.prepare("SELECT id, status FROM payment_intents");
  const findIntentById = database.prepare("SELECT status FROM payment_intents WHERE id = ?");
  const ledgerEntriesForIntent = database.prepare(
    "SELECT COUNT(*) AS total FROM ledger_entries WHERE intent_id = ?",
  );
  const chargesForIntent = providerDatabase.prepare(
    "SELECT COUNT(*) AS total FROM provider_charges WHERE intent_id = ?",
  );
  const total = (statement: ReturnType<DatabaseSync["prepare"]>, input?: string) => {
    const row = (input === undefined ? statement.get() : statement.get(input)) as { total: number };
    return Number(row.total);
  };

  function chargeProvider(input: PaymentInput, providerIdempotencyKey: string) {
    providerAttempts += 1;
    if (options.faultSchedule?.failBeforeChargeForIntentIds?.has(input.intentId)) {
      throw new ProviderDeclinedError(`provider declined ${input.intentId}`);
    }
    const existing = findProviderCharge.get(providerIdempotencyKey) as { id: number } | undefined;
    if (existing) {
      return existing.id;
    }

    createProviderCharge.run(input.intentId, input.amount, providerIdempotencyKey);
    const shouldTimeout = options.faultSchedule?.timeoutAfterChargeForIntentIds?.has(input.intentId);
    if (shouldTimeout && !timedOutIntentIds.has(input.intentId)) {
      timedOutIntentIds.add(input.intentId);
      throw new ProviderTimeoutError(`provider timed out after charging ${input.intentId}`);
    }

    return Number((findProviderCharge.get(providerIdempotencyKey) as { id: number }).id);
  }

  return {
    processPayment(input: PaymentInput): PaymentResult {
      const existing = findIntentByIdempotencyKey.get(input.idempotencyKey) as
        | { id: string; status: PaymentStatus }
        | undefined;
      if (existing?.status === "settled") {
        return { intentId: existing.id, status: "settled" };
      }
      if (existing?.status === "failed") {
        throw new Error(`payment intent ${existing.id} is failed`);
      }
      if (!existing) {
        createIntent.run(input.intentId, input.amount, input.idempotencyKey);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const unsafeRetry = attempt === 1 && options.unsafeRetryForIntentIds?.has(input.intentId);
          const providerIdempotencyKey = unsafeRetry
            ? `${input.idempotencyKey}:retry-${attempt}`
            : input.idempotencyKey;
          chargeProvider(input, providerIdempotencyKey);
          database.exec("BEGIN");
          try {
            createLedgerEntry.run(input.intentId, input.amount);
            settleIntent.run(input.intentId);
            database.exec("COMMIT");
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
          return { intentId: input.intentId, status: "settled" };
        } catch (error) {
          if (error instanceof ProviderTimeoutError && attempt === 0) {
            continue;
          }
          if (error instanceof ProviderDeclinedError) {
            failIntent.run(input.intentId);
          }
          throw error;
        }
      }

      throw new Error("payment retry loop ended unexpectedly");
    },

    handleWebhook(input: WebhookInput) {
      const result = recordWebhook.run(input.eventId, input.intentId);
      return { accepted: Number(result.changes) === 1 };
    },

    intentStatus(intentId: string) {
      return (findIntentById.get(intentId) as { status: PaymentStatus } | undefined)?.status;
    },

    activity() {
      return { providerAttempts };
    },

    evidence() {
      return {
        charges: total(totalProviderCharges),
        intents: total(totalIntents),
        ledgerEntries: total(totalLedgerEntries),
      };
    },

    evaluateInvariants() {
      const violations = (intentRows.all() as { id: string; status: PaymentStatus }[]).flatMap(
        ({ id, status }) => {
          const charges = total(chargesForIntent, id);
          const ledgerEntries = total(ledgerEntriesForIntent, id);
          if (status === "settled") {
            return charges === 1 && ledgerEntries === 1
              ? []
              : [`one-charge-and-ledger-entry-per-intent:${id}`];
          }
          if (status === "failed") {
            return charges === 0 && ledgerEntries === 0 ? [] : [`failed-payment-is-not-settled:${id}`];
          }
          return [`payment-intent-is-not-terminal:${id}`];
        },
      );
      if (total(totalProviderChargeAmount) !== total(totalLedgerAmount)) {
        violations.push("provider-and-ledger-amounts-reconcile");
      }

      return {
        charges: total(totalProviderCharges),
        intents: total(totalIntents),
        ledgerEntries: total(totalLedgerEntries),
        verdict: violations.length === 0 ? "pass" : "fail",
        violations,
      };
    },
  };
}

export function runUnsafeRetryFixture(seed?: number) {
  return runScenarioFixture({
    injectedFaults: ["timeout-after-charge", "unsafe-retry"],
    seed: seed ?? 42,
    ...(seed === undefined ? { affectedIntentIds: new Set(["pi-001", "pi-002"]) } : {}),
  });
}

export function runScenarioFixture({
  affectedIntentIds: configuredIntentIds,
  injectedFaults,
  seed,
}: Pick<PaymentScenario, "injectedFaults" | "seed"> & { affectedIntentIds?: ReadonlySet<string> }) {
  const faults = new Set(injectedFaults.map((fault) => fault.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-")));
  const faultAliases = new Map([
    ["timeoutafterchargeforintentids", "timeout-after-charge"],
    ["failbeforechargeforintentids", "fail-before-charge"],
  ]);
  for (const fault of [...faults]) {
    const canonical = faultAliases.get(fault.replaceAll("-", ""));
    if (canonical) {
      faults.delete(fault);
      faults.add(canonical);
    }
  }
  const supportedFaults = new Set(["timeout-after-charge", "fail-before-charge", "unsafe-retry"]);
  const unsupportedFault = [...faults].find((fault) => !supportedFaults.has(fault));
  if (unsupportedFault) throw new Error(`unsupported payment fault: ${unsupportedFault}`);

  const faultCount = ((seed + 1) % 3) + 1;
  const affectedIntentIds = configuredIntentIds ?? new Set(
    Array.from({ length: faultCount }, (_, index) => `pi-${String(((seed * 31 + index * 17) % 100) + 1).padStart(3, "0")}`),
  );
  const laboratory = createPaymentLaboratory({
    ...(faults.has("timeout-after-charge") || faults.has("fail-before-charge")
      ? {
          faultSchedule: {
            ...(faults.has("timeout-after-charge") ? { timeoutAfterChargeForIntentIds: affectedIntentIds } : {}),
            ...(faults.has("fail-before-charge") ? { failBeforeChargeForIntentIds: affectedIntentIds } : {}),
          },
        }
      : {}),
    ...(faults.has("unsafe-retry") ? { unsafeRetryForIntentIds: affectedIntentIds } : {}),
  });

  for (let index = 1; index <= 100; index += 1) {
    const intentId = `pi-${String(index).padStart(3, "0")}`;
    try {
      laboratory.processPayment({ amount: 500, idempotencyKey: `checkout-${index}`, intentId });
    } catch (error) {
      if (!faults.has("fail-before-charge")) throw error;
    }
  }

  return laboratory.evaluateInvariants();
}

export function runSafeFixture() {
  const laboratory = createPaymentLaboratory();

  for (let index = 1; index <= 100; index += 1) {
    const intentId = `pi-${String(index).padStart(3, "0")}`;
    laboratory.processPayment({
      amount: 500,
      idempotencyKey: `checkout-${index}`,
      intentId,
    });
  }

  return laboratory.evaluateInvariants();
}

export function runPaymentExperiment({
  baselineEvidence,
  baselineSha,
  mode,
  repetitions,
  scenario,
  seed: requestedSeed,
  testedSha,
}: {
  baselineEvidence: PaymentEvidence;
  baselineSha: string;
  mode?: "safe" | "unsafe";
  repetitions: number;
  scenario?: PaymentScenario;
  seed?: number;
  testedSha: string;
}): ExperimentResult {
  const seed = scenario?.seed ?? requestedSeed;
  if (seed === undefined) throw new Error("scenario or seed is required");
  if (!/^[a-f0-9]{40}$/.test(baselineSha)) throw new Error("baselineSha must be a commit SHA");
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("repetitions must be a positive integer");
  if (!Number.isInteger(seed) || seed < 0) throw new Error("seed must be a non-negative integer");
  if (!/^[a-f0-9]{40}$/.test(testedSha)) throw new Error("testedSha must be a commit SHA");
  if (Object.values(baselineEvidence).some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("baselineEvidence must contain non-negative integer counts");
  }

  if (!scenario && !mode) throw new Error("scenario or mode is required");
  if (scenario && scenario.seed !== seed) throw new Error("seed must match scenario seed");
  const run = scenario
    ? () => runScenarioFixture(scenario)
    : mode === "unsafe"
      ? () => runUnsafeRetryFixture(seed)
      : runSafeFixture;
  const observed = run();
  for (let repetition = 1; repetition < repetitions; repetition += 1) {
    const next = run();
    if (JSON.stringify(next) !== JSON.stringify(observed)) throw new Error("experiment was not deterministic");
  }

  return {
    artifactLinks: ["payment-lab:evidence"],
    baselineSha,
    expected: baselineEvidence,
    observed: { charges: observed.charges, intents: observed.intents, ledgerEntries: observed.ledgerEntries },
    repetitions,
    ...(scenario?.scenarioId ? { scenarioId: scenario.scenarioId } : {}),
    seed,
    testedSha,
    verdict: observed.verdict as ExperimentResult["verdict"],
  };
}
