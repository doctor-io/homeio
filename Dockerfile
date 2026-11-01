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
# install and run every app. lsblk: the Monitor's Disks tab lists the host's
# disks with it (read-only in Docker).
RUN apk add --no-cache git unzip docker-cli docker-cli-compose lsblk && \
    mkdir -p /DATA

# Next.js standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Server-side compiled output
COPY --from=builder /app/dist-server ./dist-server

# dbus-helper sidecar
COPY --from=builder /app/services/dbus-helper ./services/dbus-helper

# node_modules needed for drizzle-kit push at runtime (migrations)
COPY --from=deps /app/node_modules ./node_modules

# Drizzle config + schema for migrations
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/lib/server/db/schema.ts ./lib/server/db/schema.ts

# Entrypoint
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Deliberately root, as the systemd unit of a bare-metal install: Homeio hands
# each app's data folder to the user that app runs as (chown), which only root
# may do. A process holding the Docker socket is root on the host anyway.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["sh", "docker-entrypoint.sh"]
