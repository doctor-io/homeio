#!/usr/bin/env bash
# Homeio factory reset
#
# Wipes all application state and user data, then reboots the machine into a
# clean installation. This script is scheduled as a transient systemd unit by
# power-service.ts and must never be run interactively.
#
# Required environment variables (injected via systemd-run --setenv):
#   DATABASE_URL                PostgreSQL connection string
#   HOMEIO_RESET_DATA_ROOT      Path to the data root directory  (e.g. /DATA)
#   HOMEIO_RESET_STACKS_ROOT    Path to the Docker Compose stacks root
#   HOMEIO_RESET_STORE_CONFIG_ROOT  Path to the app store registry directory
#   HOMEIO_RESET_WORKDIR        Working directory of the Homeio application
#   HOMEIO_RESET_NPM_BIN        Absolute path to the npm binary
#
# Subdirectories recreated under HOMEIO_RESET_DATA_ROOT must stay in sync with
# DATA_SUBDIRECTORIES in lib/server/storage/data-root.ts.

# -uo pipefail: fail on unbound vars and pipe errors.
# -e is intentionally omitted: individual step failures are logged but do not
# abort the reset — the machine must always reach the reboot step.
set -uo pipefail

FACTORY_RESET_LOG='/var/log/homeio-factory-reset.log'

sleep 2

mkdir -p "$(dirname "${FACTORY_RESET_LOG}")"
exec >> "${FACTORY_RESET_LOG}" 2>&1

echo "[$(date -Is)] Starting Homeio factory reset"

# ── Validate required env vars ────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${HOMEIO_RESET_DATA_ROOT:?HOMEIO_RESET_DATA_ROOT is required}"
: "${HOMEIO_RESET_STACKS_ROOT:?HOMEIO_RESET_STACKS_ROOT is required}"
: "${HOMEIO_RESET_STORE_CONFIG_ROOT:?HOMEIO_RESET_STORE_CONFIG_ROOT is required}"
: "${HOMEIO_RESET_WORKDIR:?HOMEIO_RESET_WORKDIR is required}"
: "${HOMEIO_RESET_NPM_BIN:?HOMEIO_RESET_NPM_BIN is required}"

cd "${HOMEIO_RESET_WORKDIR}"
export DATABASE_URL

# ── Step 1: Stop the application ──────────────────────────────────────────────
systemctl stop home-server.service || true

# ── Step 2: Reset the database (before any destructive file ops) ──────────────
# Running db:reset first ensures the DB is wiped even if the data root is later
# inaccessible. Failure is logged but does not abort — we keep going.
echo "[$(date -Is)] Resetting database"
"${HOMEIO_RESET_NPM_BIN}" run db:reset --silent \
  && echo "[$(date -Is)] Database reset OK" \
  || echo "[$(date -Is)] WARNING: database reset failed, continuing"

# ── Step 3: Remove stacks root ────────────────────────────────────────────────
# STORE_STACKS_ROOT may live outside the data root (e.g. /var/lib/home-server/stacks).
# Removing it explicitly ensures no orphaned compose files survive the wipe.
rm -rf "${HOMEIO_RESET_STACKS_ROOT}" || true

# ── Step 3b: Remove the app store registry ────────────────────────────────────
# The registry (added catalog sources and their checkouts) lives beside the
# stacks rather than under the data root, so wiping the data root left every
# store the user had added standing — a "factory" install that still knew about
# third-party catalogs.
rm -rf "${HOMEIO_RESET_STORE_CONFIG_ROOT}" || true

# ── Step 4: Docker cleanup ────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  docker ps -aq | xargs -r docker rm -f                                    || true
  docker volume ls -q | xargs -r docker volume rm -f                       || true
  docker network ls --format '{{.Name}}' \
    | grep -vxE 'bridge|host|none' \
    | xargs -r docker network rm                                            || true
  docker images -aq | sort -u | xargs -r docker rmi -f                     || true
  docker builder prune -af                                                  || true
  docker system prune -af --volumes                                         || true
fi

# ── Step 4b: Leave the tailnet ────────────────────────────────────────────────
# Tailscale is a host package, so no amount of Docker or data-root cleanup
# touches it: without this the reset machine comes back up still registered on
# the owner's tailnet, holding the node key it had before. The package itself is
# left installed — removing it is distro-specific and reinstalling is one click.
if command -v tailscale >/dev/null 2>&1; then
  tailscale logout                                                          || true
  systemctl disable --now tailscaled                                        || true
  rm -rf /var/lib/tailscale                                                 || true
fi

# ── Step 5: Wipe data root ────────────────────────────────────────────────────
# Use find -mindepth 1 to delete everything inside without removing the root
# directory itself, so the mount point survives if it is a separate partition.
if [ -d "${HOMEIO_RESET_DATA_ROOT}" ]; then
  find "${HOMEIO_RESET_DATA_ROOT}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
else
  mkdir -p "${HOMEIO_RESET_DATA_ROOT}"
fi

# ── Step 6: Recreate fresh-install directory structure ────────────────────────
# Mirrors DATA_SUBDIRECTORIES in lib/server/storage/data-root.ts.
mkdir -p \
  "${HOMEIO_RESET_DATA_ROOT}/AppData" \
  "${HOMEIO_RESET_DATA_ROOT}/Documents" \
  "${HOMEIO_RESET_DATA_ROOT}/Media" \
  "${HOMEIO_RESET_DATA_ROOT}/Download" \
  "${HOMEIO_RESET_DATA_ROOT}/.Shared" \
  "${HOMEIO_RESET_DATA_ROOT}/.Network" \
  "${HOMEIO_RESET_DATA_ROOT}/.Trash"

echo "[$(date -Is)] Factory reset complete; rebooting"

# ── Step 7: Reboot ────────────────────────────────────────────────────────────
systemctl reboot
