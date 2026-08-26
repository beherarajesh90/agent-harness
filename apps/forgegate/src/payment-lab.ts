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

type PaymentLaboratoryOptions = {
  faultSchedule?: {
    timeoutAfterChargeForIntentIds?: ReadonlySet<string>;
  };
};

class ProviderTimeoutError extends Error {}

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
  const findProviderCharge = providerDatabase.prepare(
    "SELECT id FROM provider_charges WHERE idempotency_key = ?",
  );
  const createProviderCharge = providerDatabase.prepare(
    "INSERT INTO provider_charges (intent_id, amount, idempotency_key) VALUES (?, ?, ?)",
  );
  const totalIntents = database.prepare("SELECT COUNT(*) AS total FROM payment_intents");
  const totalLedgerEntries = database.prepare("SELECT COUNT(*) AS total FROM ledger_entries");
  const totalProviderCharges = providerDatabase.prepare("SELECT COUNT(*) AS total FROM provider_charges");
  const intentIds = database.prepare("SELECT id FROM payment_intents");
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

  function chargeProvider(input: PaymentInput) {
    providerAttempts += 1;
    const existing = findProviderCharge.get(input.idempotencyKey) as { id: number } | undefined;
    if (existing) {
      return existing.id;
    }

    createProviderCharge.run(input.intentId, input.amount, input.idempotencyKey);
    const shouldTimeout = options.faultSchedule?.timeoutAfterChargeForIntentIds?.has(input.intentId);
    if (shouldTimeout && !timedOutIntentIds.has(input.intentId)) {
      timedOutIntentIds.add(input.intentId);
      throw new ProviderTimeoutError(`provider timed out after charging ${input.intentId}`);
    }

    return Number((findProviderCharge.get(input.idempotencyKey) as { id: number }).id);
  }

  return {
    processPayment(input: PaymentInput): PaymentResult {
      const existing = findIntentByIdempotencyKey.get(input.idempotencyKey) as
        | { id: string; status: "pending" | "settled" }
        | undefined;
      if (existing?.status === "settled") {
        return { intentId: existing.id, status: "settled" };
      }
      if (!existing) {
        createIntent.run(input.intentId, input.amount, input.idempotencyKey);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          chargeProvider(input);
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
          throw error;
        }
      }

      throw new Error("payment retry loop ended unexpectedly");
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
      const violations = (intentIds.all() as { id: string }[]).flatMap(({ id }) =>
        total(chargesForIntent, id) === 1 && total(ledgerEntriesForIntent, id) === 1
          ? []
          : [`one-charge-and-ledger-entry-per-intent:${id}`],
      );

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
