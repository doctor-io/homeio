# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server-only/package.json packages/server-only/
RUN npm ci --ignore-scripts

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
# Dummy values so Next.js build doesn't fail on env validation
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
ENV AUTH_SESSION_SECRET=placeholder-build-secret-32-chars-min

RUN npm run build

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# docker-cli / docker-cli-compose: the app shells out to `docker compose` to
# install and run every app. su-exec: the entrypoint starts as root to line the
# app user up with the Docker socket group, then drops back down.
RUN apk add --no-cache git unzip docker-cli docker-cli-compose su-exec && \
    addgroup --system --gid 1001 homeio && \
    adduser --system --uid 1001 homeio && \
    mkdir -p /DATA && \
    chown homeio:homeio /app /DATA

# Next.js standalone output
COPY --from=builder --chown=homeio:homeio /app/.next/standalone ./
COPY --from=builder --chown=homeio:homeio /app/.next/static ./.next/static
COPY --from=builder --chown=homeio:homeio /app/public ./public

# Server-side compiled output
COPY --from=builder --chown=homeio:homeio /app/dist-server ./dist-server

# dbus-helper sidecar
COPY --from=builder --chown=homeio:homeio /app/services/dbus-helper ./services/dbus-helper

# node_modules needed for drizzle-kit push at runtime (migrations)
COPY --from=deps --chown=homeio:homeio /app/node_modules ./node_modules

# Drizzle config + schema for migrations
COPY --from=builder --chown=homeio:homeio /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=homeio:homeio /app/lib/server/db/schema.ts ./lib/server/db/schema.ts

# Entrypoint
COPY --chown=homeio:homeio docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Deliberately root: the entrypoint needs it to join the socket's group, and it
# drops to the homeio user before starting the app.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["sh", "docker-entrypoint.sh"]
