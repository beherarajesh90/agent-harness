import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("ForgeGate health checks", () => {
  it("reports liveness without requiring external services", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });

  it("reports readiness while the service can accept requests", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
