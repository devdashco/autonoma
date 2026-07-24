FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Fetch the dependency store from the lockfile alone so a source-only change
# keeps this cached layer instead of re-downloading every dep (see the deploy
# ENOSPC note in Dockerfile.coolify).
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .

RUN git config --global --add safe.directory /tmp/repo
RUN git config --global --add safe.directory /tmp/repo-resolution

RUN pnpm install --frozen-lockfile --prefer-offline
RUN pnpm --filter @autonoma/worker-general run build

ENV NODE_ENV=production
WORKDIR /app/apps/workers/general
CMD ["/app/node_modules/.bin/tsx", "--import", "./src/preload.ts", "src/index.ts"]
