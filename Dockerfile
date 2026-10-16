FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.10-alpine
WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.yml \
    STATE_PATH=/data/state.json \
    PORT=3005 \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# The config is baked in at build time; config.yml must exist next to the Dockerfile.
COPY config.yml ./config.yml
# Named volume for the last-good forecast; inherits this ownership on first use.
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 3005
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD ["bun", "run", "src/healthcheck.ts"]
CMD ["bun", "run", "src/main.ts"]
