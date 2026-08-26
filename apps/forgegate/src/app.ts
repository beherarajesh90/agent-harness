import Fastify from "fastify";

export function buildApp() {
  const app = Fastify();

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", () => ({ status: "ok" }));

  return app;
}
