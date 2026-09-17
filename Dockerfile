# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server-only/package.json packages/server-only/
RUN npm ci --ignore-scripts

# ─── Stage 1b: prod-deps ──────────────────────────────────────────────────────
# The same install without the dev tree. The builder needs TypeScript, Vite and
# the rest; the runner needs none of it, and shipping it means shipping the
# esbuild binaries that drizzle-kit and vitest carry — the largest single source
# of vulnerabilities in the published image, for code that never runs.
FROM node:22-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server-only/package.json packages/server-only/
RUN npm ci --omit=dev --ignore-scripts

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
#
# `apk upgrade` comes first because the node:22-alpine tag is rebuilt less often
# than Alpine ships security fixes: a freshly pulled base still carries the
# openssl libraries at the version that was current when the tag was built.
RUN apk upgrade --no-cache && \
    apk add --no-cache git unzip docker-cli docker-cli-compose su-exec && \
    addgroup --system --gid 1001 homeio && \
    adduser --system --uid 1001 homeio && \
    mkdir -p /DATA && \
    chown homeio:homeio /app /DATA

# Nothing here runs npm: the entrypoint execs node directly, and the one feature
# that resolves `which npm` — factory reset — needs scripts/, which this image
# does not carry. The npm that ships in the base image brings its own bundled
# dependency tree (pacote, sigstore, tar, ip-address), so leaving it in place
# means shipping vulnerabilities for a tool the container never invokes.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack

# Next.js standalone output
COPY --from=builder --chown=homeio:homeio /app/.next/standalone ./
COPY --from=builder --chown=homeio:homeio /app/.next/static ./.next/static
COPY --from=builder --chown=homeio:homeio /app/public ./public

# Server-side compiled output
COPY --from=builder --chown=homeio:homeio /app/dist-server ./dist-server

# dbus-helper sidecar
COPY --from=builder --chown=homeio:homeio /app/services/dbus-helper ./services/dbus-helper

# Runtime dependencies only — the server entry and the migrator resolve
# drizzle-orm, pg, ws and the rest from here.
COPY --from=prod-deps --chown=homeio:homeio /app/node_modules ./node_modules

# Versioned migrations, applied by dist-server/scripts/db-migrate.js at start-up
COPY --from=builder --chown=homeio:homeio /app/drizzle ./drizzle

# Entrypoint
COPY --chown=homeio:homeio docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Deliberately root: the entrypoint needs it to join the socket's group, and it
# drops to the homeio user before starting the app.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["sh", "docker-entrypoint.sh"]
