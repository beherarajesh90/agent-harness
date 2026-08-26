FROM node:24.13.1-bookworm-slim AS build

WORKDIR /app

RUN npm install --global pnpm@10.33.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/forgegate/package.json apps/forgegate/package.json
RUN pnpm install --frozen-lockfile

COPY apps/forgegate apps/forgegate
RUN pnpm --filter @forgegate/app build

FROM node:24.13.1-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app /app

EXPOSE 3000

CMD ["node", "apps/forgegate/dist/src/server.js"]
