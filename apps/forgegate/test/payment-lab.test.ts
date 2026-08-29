import { describe, expect, it } from "vitest";

import {
  createPaymentLaboratory,
  runPaymentExperiment,
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

  it("records a declined payment as failed without charging or settling it", () => {
    const laboratory = createPaymentLaboratory({
      faultSchedule: { failBeforeChargeForIntentIds: new Set(["pi-105"]) },
    });

    expect(() =>
      laboratory.processPayment({
        amount: 500,
        idempotencyKey: "checkout-105",
        intentId: "pi-105",
      }),
    ).toThrow("provider declined pi-105");
    expect(laboratory.intentStatus("pi-105")).toBe("failed");
    expect(laboratory.evaluateInvariants()).toEqual({
      charges: 0,
      intents: 1,
      ledgerEntries: 0,
      verdict: "pass",
      violations: [],
    });
  });

  it("does not settle a replay of a failed payment intent", () => {
    const declinedIntentIds = new Set(["pi-106"]);
    const laboratory = createPaymentLaboratory({
      faultSchedule: { failBeforeChargeForIntentIds: declinedIntentIds },
    });
    const input = { amount: 500, idempotencyKey: "checkout-106", intentId: "pi-106" };

    expect(() => laboratory.processPayment(input)).toThrow("provider declined pi-106");
    declinedIntentIds.clear();

    expect(() => laboratory.processPayment(input)).toThrow("payment intent pi-106 is failed");
    expect(laboratory.intentStatus("pi-106")).toBe("failed");
    expect(laboratory.evaluateInvariants()).toEqual({
      charges: 0,
      intents: 1,
      ledgerEntries: 0,
      verdict: "pass",
      violations: [],
    });
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
        "provider-and-ledger-amounts-reconcile",
      ],
    });
  });

  it("flags provider and ledger amounts that do not reconcile", () => {
    expect(runUnsafeRetryFixture().violations).toContain("provider-and-ledger-amounts-reconcile");
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
          "provider-and-ledger-amounts-reconcile",
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
    expect(laboratory.intentStatus("pi-104")).toBe("settled");
  });

  it("returns structured deterministic experiment evidence", () => {
    const baselineEvidence = { charges: 7, intents: 8, ledgerEntries: 9 };
    expect(runPaymentExperiment({ baselineEvidence, baselineSha: "b".repeat(40), mode: "unsafe", repetitions: 2, seed: 42, testedSha: "a".repeat(40) })).toEqual({
      artifactLinks: ["payment-lab:evidence"],
      baselineSha: "b".repeat(40),
      expected: baselineEvidence,
      observed: { charges: 102, intents: 100, ledgerEntries: 100 },
      repetitions: 2,
      seed: 42,
      testedSha: "a".repeat(40),
      verdict: "fail",
    });
    expect(runPaymentExperiment({ baselineEvidence: { charges: 100, intents: 100, ledgerEntries: 100 }, baselineSha: "b".repeat(40), mode: "safe", repetitions: 2, seed: 42, testedSha: "a".repeat(40) }).verdict).toBe("pass");
  });

  it("executes a declared scenario and preserves its identity", () => {
    expect(runPaymentExperiment({
      baselineEvidence: { charges: 100, intents: 100, ledgerEntries: 100 },
      baselineSha: "b".repeat(40),
      repetitions: 1,
      scenario: { injectedFaults: ["timeout-after-charge"], scenarioId: "scn-002-timeout-after-charge", seed: 43 },
      testedSha: "a".repeat(40),
    })).toMatchObject({
      observed: { charges: 100, intents: 100, ledgerEntries: 100 },
      scenarioId: "scn-002-timeout-after-charge",
      seed: 43,
      verdict: "pass",
    });
  });

  it("executes a fail-before-charge scenario without aborting the batch", () => {
    expect(runPaymentExperiment({
      baselineEvidence: { charges: 100, intents: 100, ledgerEntries: 100 },
      baselineSha: "b".repeat(40),
      repetitions: 1,
      scenario: { injectedFaults: ["fail-before-charge"], scenarioId: "scn-002-fail-before-charge", seed: 43 },
      testedSha: "a".repeat(40),
    })).toMatchObject({
      observed: { charges: 97, intents: 100, ledgerEntries: 97 },
      scenarioId: "scn-002-fail-before-charge",
      verdict: "pass",
    });
  });

  it("uses the seed to select a deterministic unsafe fault schedule", () => {
    const first = runPaymentExperiment({ baselineEvidence: { charges: 100, intents: 100, ledgerEntries: 100 }, baselineSha: "b".repeat(40), mode: "unsafe", repetitions: 2, seed: 1, testedSha: "a".repeat(40) });
    const second = runPaymentExperiment({ baselineEvidence: { charges: 100, intents: 100, ledgerEntries: 100 }, baselineSha: "b".repeat(40), mode: "unsafe", repetitions: 2, seed: 2, testedSha: "a".repeat(40) });

    expect(first.observed).not.toEqual(second.observed);
    expect(runPaymentExperiment({ baselineEvidence: { charges: 100, intents: 100, ledgerEntries: 100 }, baselineSha: "b".repeat(40), mode: "unsafe", repetitions: 2, seed: 1, testedSha: "a".repeat(40) })).toEqual(first);
  });
});
