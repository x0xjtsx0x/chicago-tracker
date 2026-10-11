# syntax=docker/dockerfile:1
# <DIGEST> is a placeholder: the deployer resolves it once and substitutes it in both FROM lines:
#   docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'
FROM node:24-bookworm-slim@<DIGEST> AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim@<DIGEST>
# Inside the container the app listens on all interfaces; compose decides which host address publishes it.
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/package.json ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
