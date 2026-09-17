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

# The compose file ships a placeholder secret, and production refuses it — so
# `git clone && docker compose up -d`, the quickstart in the README, crash-looped
# on the instrumentation hook with a 500 on /api/health. The Linux installer has
# always generated one; do the same here, and persist it so sessions survive a
# restart. Without a writable state directory the secret is per-boot, which
# signs everyone out on restart but still beats refusing to start.
SECRET_STATE_DIR="${HOMEIO_STATE_DIR:-/stacks}"
SECRET_FILE="${SECRET_STATE_DIR}/.session-secret"
PLACEHOLDER_SECRET="change-me-to-a-random-32-char-secret"

if [ -z "${AUTH_SESSION_SECRET:-}" ] || [ "${AUTH_SESSION_SECRET}" = "${PLACEHOLDER_SECRET}" ]; then
  if [ -s "$SECRET_FILE" ]; then
    AUTH_SESSION_SECRET="$(cat "$SECRET_FILE")"
  else
    AUTH_SESSION_SECRET="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
    if mkdir -p "$SECRET_STATE_DIR" 2>/dev/null &&
       printf '%s' "$AUTH_SESSION_SECRET" > "$SECRET_FILE" 2>/dev/null; then
      chmod 600 "$SECRET_FILE" 2>/dev/null || true
      [ "$(id -u)" = "0" ] && chown "$APP_USER" "$SECRET_FILE" 2>/dev/null
      echo "Generated a session secret and stored it at ${SECRET_FILE}."
    else
      echo "WARNING: could not persist a session secret to ${SECRET_FILE};" \
           "a new one is generated on every start, so sessions will not survive a restart."
    fi
  fi
fi
export AUTH_SESSION_SECRET

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

# Migrations are applied from the versioned SQL in drizzle/, not pushed from
# the schema. `drizzle-kit push` needed drizzle-kit — a build tool, with its own
# esbuild binaries — installed in the runtime image for the sake of one command
# at start-up. The migrator ships inside drizzle-orm, which the app already
# depends on, so the image no longer carries a dev toolchain it never uses.
echo "Running database migrations..."

MIGRATE_ENTRY=dist-server/scripts/db-migrate.js

if [ "$(id -u)" = "0" ]; then
  su-exec "$APP_USER" node "$MIGRATE_ENTRY"
  exec su-exec "$APP_USER" node "$SERVER_ENTRY"
fi

node "$MIGRATE_ENTRY"
exec node "$SERVER_ENTRY"
