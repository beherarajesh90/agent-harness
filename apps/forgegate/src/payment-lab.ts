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

export function createPaymentLaboratory() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE payment_intents (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE provider_charges (
      id INTEGER PRIMARY KEY,
      intent_id TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE ledger_entries (
      id INTEGER PRIMARY KEY,
      intent_id TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL
    ) STRICT;
  `);

  const findIntentByIdempotencyKey = database.prepare(
    "SELECT id, status FROM payment_intents WHERE idempotency_key = ?",
  );
  const createIntent = database.prepare(
    "INSERT INTO payment_intents (id, amount, idempotency_key, status) VALUES (?, ?, ?, 'pending')",
  );
  const createCharge = database.prepare(
    "INSERT INTO provider_charges (intent_id, amount) VALUES (?, ?)",
  );
  const createLedgerEntry = database.prepare(
    "INSERT INTO ledger_entries (intent_id, amount) VALUES (?, ?)",
  );
  const settleIntent = database.prepare("UPDATE payment_intents SET status = 'settled' WHERE id = ?");
  const count = (table: string) =>
    Number((database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
  const invariantViolations = database.prepare(`
    SELECT id
    FROM payment_intents
    WHERE (SELECT COUNT(*) FROM provider_charges WHERE intent_id = payment_intents.id) != 1
      OR (SELECT COUNT(*) FROM ledger_entries WHERE intent_id = payment_intents.id) != 1
  `);

  return {
    processPayment(input: PaymentInput): PaymentResult {
      const existing = findIntentByIdempotencyKey.get(input.idempotencyKey) as
        | { id: string; status: "settled" }
        | undefined;
      if (existing) {
        return { intentId: existing.id, status: existing.status };
      }

      database.exec("BEGIN");
      try {
        createIntent.run(input.intentId, input.amount, input.idempotencyKey);
        createCharge.run(input.intentId, input.amount);
        createLedgerEntry.run(input.intentId, input.amount);
        settleIntent.run(input.intentId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return { intentId: input.intentId, status: "settled" };
    },

    evidence() {
      return {
        charges: count("provider_charges"),
        intents: count("payment_intents"),
        ledgerEntries: count("ledger_entries"),
      };
    },

    evaluateInvariants() {
      const charges = count("provider_charges");
      const intents = count("payment_intents");
      const ledgerEntries = count("ledger_entries");
      const violations = (invariantViolations.all() as { id: string }[]).map(
        ({ id }) => `one-charge-and-ledger-entry-per-intent:${id}`,
      );

      return {
        charges,
        intents,
        ledgerEntries,
        verdict: violations.length === 0 ? "pass" : "fail",
        violations,
      };
    },
  };
}
