#!/bin/sh
set -e

APP_USER=homeio
DOCKER_SOCKET="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

# The app talks to the Docker socket to list containers and to run
# `docker compose` for every install. The socket is owned by a group whose id
# differs per host (docker on Debian, root under Docker Desktop), so the id is
# read at start-up rather than baked into the image. Without this the app runs
# but every Docker call fails with EACCES, and it fails quietly.
if [ -S "$DOCKER_SOCKET" ] && [ "$(id -u)" = "0" ]; then
  SOCKET_GID="$(stat -c '%g' "$DOCKER_SOCKET")"

  if [ "$SOCKET_GID" = "0" ]; then
    # Docker Desktop exposes it as root:root; only the root group can reach it.
    addgroup "$APP_USER" root 2>/dev/null || true
  else
    EXISTING_GROUP="$(getent group "$SOCKET_GID" | cut -d: -f1)"
    if [ -z "$EXISTING_GROUP" ]; then
      EXISTING_GROUP=dockerhost
      addgroup -g "$SOCKET_GID" "$EXISTING_GROUP" 2>/dev/null || true
    fi
    addgroup "$APP_USER" "$EXISTING_GROUP" 2>/dev/null || true
  fi

  echo "Docker socket group: ${SOCKET_GID}"
elif [ ! -S "$DOCKER_SOCKET" ]; then
  echo "WARNING: ${DOCKER_SOCKET} is not mounted — app management will not work."
fi

# Default V8 heap cap is generous for amd64 (1.5 GB) but exceeds the
# total RAM of a Pi 3 (1 GB). Apply a Pi-friendly default unless the
# operator overrides via NODE_OPTIONS.
if [ -z "${NODE_OPTIONS:-}" ]; then
  NODE_OPTIONS="--max-old-space-size=768"
fi
export NODE_OPTIONS

if [ -f "dist-server/server.js" ]; then
  SERVER_ENTRY=dist-server/server.js
else
  SERVER_ENTRY=server.js
fi

echo "Running database migrations..."

if [ "$(id -u)" = "0" ]; then
  su-exec "$APP_USER" node_modules/.bin/drizzle-kit push --config drizzle.config.ts
  exec su-exec "$APP_USER" node "$SERVER_ENTRY"
fi

node_modules/.bin/drizzle-kit push --config drizzle.config.ts
exec node "$SERVER_ENTRY"
