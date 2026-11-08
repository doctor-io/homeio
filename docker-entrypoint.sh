#!/bin/sh
set -e

DOCKER_SOCKET="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

if [ ! -S "$DOCKER_SOCKET" ]; then
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

echo "Running database migrations..."

node_modules/.bin/drizzle-kit push --config drizzle.config.ts
exec node "$SERVER_ENTRY"
