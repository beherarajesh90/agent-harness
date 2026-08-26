import { describe, expect, it, vi } from "vitest";

import { createTrueForgeReadinessProbe } from "../src/trueforge.js";

describe("createTrueForgeReadinessProbe", () => {
  it("returns true when the harness health endpoint succeeds", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const isReady = createTrueForgeReadinessProbe({
      baseUrl: "http://trueforge:8790",
      fetch,
    });

    await expect(isReady()).resolves.toBe(true);
  });

  it("returns false when the harness request fails", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const isReady = createTrueForgeReadinessProbe({
      baseUrl: "http://trueforge:8790",
      fetch,
    });

    await expect(isReady()).resolves.toBe(false);
  });
});
