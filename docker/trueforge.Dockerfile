FROM node:24.13.1-bookworm-slim

ARG APP_VERSION=0.1.4

ENV NODE_ENV=production
ENV HOST=0.0.0.0

WORKDIR /app

RUN npm install --omit=dev "@truefoundry/trueforge@${APP_VERSION}"

EXPOSE 8790

CMD ["node", "node_modules/@truefoundry/trueforge/dist/main.js"]
