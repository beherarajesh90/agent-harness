import { describe, expect, it } from "vitest";

import {
  createPaymentLaboratory,
  runSafeFixture,
  runUnsafeRetryFixture,
} from "../src/payment-lab.js";

describe("payment laboratory", () => {
  it("creates one charge and one ledger entry for a settled payment intent", () => {
    const laboratory = createPaymentLaboratory();

    const result = laboratory.processPayment({
      amount: 500,
      idempotencyKey: "checkout-100",
      intentId: "pi-100",
    });

    expect(result).toEqual({ intentId: "pi-100", status: "settled" });
    expect(laboratory.evidence()).toEqual({
      charges: 1,
      intents: 1,
      ledgerEntries: 1,
    });
  });

  it("does not charge or ledger the same idempotency key twice", () => {
    const laboratory = createPaymentLaboratory();
    const payment = {
      amount: 500,
      idempotencyKey: "checkout-101",
      intentId: "pi-101",
    };

    laboratory.processPayment(payment);
    const replay = laboratory.processPayment(payment);

    expect(replay).toEqual({ intentId: "pi-101", status: "settled" });
    expect(laboratory.evidence()).toEqual({
      charges: 1,
      intents: 1,
      ledgerEntries: 1,
    });
  });

  it("reports the primary invariant as satisfied for a settled payment", () => {
    const laboratory = createPaymentLaboratory();
    laboratory.processPayment({
      amount: 500,
      idempotencyKey: "checkout-102",
      intentId: "pi-102",
    });

    expect(laboratory.evaluateInvariants()).toEqual({
      charges: 1,
      intents: 1,
      ledgerEntries: 1,
      verdict: "pass",
      violations: [],
    });
  });

  it("reuses a provider charge after a timeout triggers a retry", () => {
    const laboratory = createPaymentLaboratory({
      faultSchedule: { timeoutAfterChargeForIntentIds: new Set(["pi-103"]) },
    });

    laboratory.processPayment({
      amount: 500,
      idempotencyKey: "checkout-103",
      intentId: "pi-103",
    });

    expect(laboratory.evidence()).toEqual({
      charges: 1,
      intents: 1,
      ledgerEntries: 1,
    });
    expect(laboratory.activity()).toEqual({ providerAttempts: 2 });
  });

  it("produces deterministic duplicate-charge evidence for the unsafe retry fixture", () => {
    expect(runUnsafeRetryFixture()).toEqual({
      charges: 102,
      intents: 100,
      ledgerEntries: 100,
      verdict: "fail",
      violations: [
        "one-charge-and-ledger-entry-per-intent:pi-001",
        "one-charge-and-ledger-entry-per-intent:pi-002",
      ],
    });
  });

  it("reproduces unsafe evidence for 20 consecutive runs", () => {
    for (let run = 0; run < 20; run += 1) {
      expect(runUnsafeRetryFixture()).toEqual({
        charges: 102,
        intents: 100,
        ledgerEntries: 100,
        verdict: "fail",
        violations: [
          "one-charge-and-ledger-entry-per-intent:pi-001",
          "one-charge-and-ledger-entry-per-intent:pi-002",
        ],
      });
    }
  });

  it("passes the safe fixture for 20 consecutive runs", () => {
    for (let run = 0; run < 20; run += 1) {
      expect(runSafeFixture()).toEqual({
        charges: 100,
        intents: 100,
        ledgerEntries: 100,
        verdict: "pass",
        violations: [],
      });
    }
  });

  it("ignores a duplicate webhook without another charge or ledger entry", () => {
    const laboratory = createPaymentLaboratory();
    laboratory.processPayment({
      amount: 500,
      idempotencyKey: "checkout-104",
      intentId: "pi-104",
    });

    expect(laboratory.handleWebhook({ eventId: "evt-104", intentId: "pi-104" })).toEqual({
      accepted: true,
    });
    expect(laboratory.handleWebhook({ eventId: "evt-104", intentId: "pi-104" })).toEqual({
      accepted: false,
    });
    expect(laboratory.evidence()).toEqual({
      charges: 1,
      intents: 1,
      ledgerEntries: 1,
    });
  });
});
