import Fastify from "fastify";

export function buildApp({
  isTrueForgeReady = async () => true,
}: {
  isTrueForgeReady?: () => Promise<boolean>;
} = {}) {
  const app = Fastify();

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    if (await isTrueForgeReady()) {
      return { status: "ok" };
    }

    return reply.code(503).send({ status: "unavailable" });
  });

  return app;
}
