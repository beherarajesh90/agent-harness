import { describe, expect, it } from "vitest";

import { createPaymentLaboratory } from "../src/payment-lab.js";

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
});
