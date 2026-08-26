import { describe, expect, it, vi } from "vitest";

import { createTrueForgeInvestigationLauncher } from "../src/trueforge-investigation.js";

describe("createTrueForgeInvestigationLauncher", () => {
  it("creates an agent-backed session and instructs two visible analysts", async () => {
    const sessions = {
      create: vi.fn(async () => ({ data: { id: "session-1" } })),
      createTurn: vi.fn(async () => ({ data: { id: "turn-1" } })),
    };
    const launch = createTrueForgeInvestigationLauncher({
      modelName: "ollama-local/qwen35-4b",
      sessions,
    });

    await expect(
      launch({
        pullRequestUrl: "https://github.com/beherarajesh90/agent-harness/pull/7",
        repository: "beherarajesh90/agent-harness",
      }),
    ).resolves.toEqual({ sessionId: "session-1", turnId: "turn-1" });
    expect(sessions.create).toHaveBeenCalledWith({
      agent: { spec: expect.objectContaining({ model: { name: "ollama-local/qwen35-4b" } }) },
    });
    expect(sessions.createTurn).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        input: [
          expect.objectContaining({
            content: expect.stringMatching(/invariant-analyst[\s\S]*failure-mode-analyst/),
            type: "user.message",
          }),
        ],
      }),
    );
  });

  it("rejects a pull request URL outside the configured repository", async () => {
    const sessions = { create: vi.fn(), createTurn: vi.fn() };
    const launch = createTrueForgeInvestigationLauncher({
      modelName: "ollama-local/qwen35-4b",
      sessions,
    });

    await expect(
      launch({
        pullRequestUrl: "https://github.com/other/repository/pull/7",
        repository: "beherarajesh90/agent-harness",
      }),
    ).rejects.toThrow("pull request URL is not in the configured repository");
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
