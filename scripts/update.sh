#!/usr/bin/env bash
set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_NAME="update.sh"
HOMEIO_VERBOSE="${HOMEIO_VERBOSE:-false}"

APP_NAME="home-server"
INSTALL_DIR="${HOMEIO_INSTALL_DIR:-/opt/home-server}"
ENV_FILE="${HOMEIO_ENV_FILE:-${INSTALL_DIR}/.env}"
SERVICE_NAME="${HOMEIO_SERVICE_NAME:-home-server}"
DBUS_SERVICE_NAME="${HOMEIO_DBUS_SERVICE_NAME:-home-server-dbus}"
UPLOAD_SERVICE_NAME="${HOMEIO_UPLOAD_SERVICE_NAME:-home-server-upload}"
APP_PORT="${HOMEIO_APP_PORT:-${HOMEIO_PORT:-12026}}"
PUBLIC_PORT="${HOMEIO_PUBLIC_PORT:-80}"
NGINX_SITE_NAME="${HOMEIO_NGINX_SITE_NAME:-home-server}"
REPO_URL="${HOMEIO_REPO_URL:-https://github.com/doctor-io/homeio.git}"
REPO_BRANCH="${HOMEIO_REPO_BRANCH:-main}"
GO_VERSION="${GO_VERSION:-1.23.4}"

# SHA-256 of drizzle/0000_slippery_black_queen.sql — used to seed the migration journal
# for legacy installs that were bootstrapped with drizzle push (no __drizzle_migrations table).
BASELINE_MIGRATION_HASH="e10db77d840d8dc1f42a13ee9de57615a2fb7c46d9525e0d1e7a7f42dee72eaf"
BASELINE_MIGRATION_TS="1776413023965"

HOMEIO_RELEASE_TAG="${HOMEIO_RELEASE_TAG:-}"
HOMEIO_RELEASE_TARBALL_URL="${HOMEIO_RELEASE_TARBALL_URL:-}"
HOMEIO_CREATE_BACKUP="${HOMEIO_CREATE_BACKUP:-true}"
HOMEIO_BACKUP_ROOT="${HOMEIO_BACKUP_ROOT:-/var/backups/home-server/releases}"
HOMEIO_HEALTHCHECK_URL="${HOMEIO_HEALTHCHECK_URL:-http://127.0.0.1:${APP_PORT}/api/health}"
HOMEIO_HEALTHCHECK_RETRIES="${HOMEIO_HEALTHCHECK_RETRIES:-60}"
HOMEIO_HEALTHCHECK_DELAY_SEC="${HOMEIO_HEALTHCHECK_DELAY_SEC:-3}"

SERVICE_UNIT="${SERVICE_NAME}"
if [[ "${SERVICE_UNIT}" != *.service ]]; then
	SERVICE_UNIT="${SERVICE_UNIT}.service"
fi

DBUS_SERVICE_UNIT="${DBUS_SERVICE_NAME}"
if [[ "${DBUS_SERVICE_UNIT}" != *.service ]]; then
	DBUS_SERVICE_UNIT="${DBUS_SERVICE_UNIT}.service"
fi

UPLOAD_SERVICE_UNIT="${UPLOAD_SERVICE_NAME}"
if [[ "${UPLOAD_SERVICE_UNIT}" != *.service ]]; then
	UPLOAD_SERVICE_UNIT="${UPLOAD_SERVICE_UNIT}.service"
fi

BACKUP_DIR=""
PREVIOUS_GIT_REV=""
ROLLBACK_READY="false"
ROLLBACK_DONE="false"
PREVIOUS_LOCK_HASH=""
NEW_LOCK_HASH=""

print_status() { echo -e "${GREEN}[+]${NC} $1"; }
print_error() { echo -e "${RED}[!]${NC} $1" >&2; }
print_warn() { echo -e "${YELLOW}[*]${NC} $1"; }

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

detect_arch() {
	case "$(uname -m)" in
		x86_64)
			echo "x64"
			;;
		aarch64)
			echo "arm64"
			;;
		*)
			print_error "Unsupported architecture: $(uname -m). Supported: x86_64, aarch64."
			exit 1
			;;
	esac
}

require_root() {
	[[ "${EUID}" -eq 0 ]] || { print_error "Run this script as root (for example: sudo bash ${SCRIPT_NAME})."; exit 1; }
}

hash_file() {
	local file="${1}"
	[[ -f "${file}" ]] || return 0
	sha256sum "${file}" | awk '{print $1}'
}

check_prerequisites() {
	print_status "Checking prerequisites..."
	command_exists apt-get || { print_error "apt-get is required."; exit 1; }
	command_exists systemctl || { print_error "systemd is required but systemctl is not available."; exit 1; }
	command_exists rsync || { print_error "rsync is required."; exit 1; }
	command_exists curl || { print_error "curl is required."; exit 1; }
	command_exists npm || { print_error "npm is required."; exit 1; }

	[[ -d "${INSTALL_DIR}" ]] || { print_error "Install directory not found: ${INSTALL_DIR}"; exit 1; }
	[[ -f "${ENV_FILE}" ]] || { print_error "Environment file not found: ${ENV_FILE}"; exit 1; }
}

ensure_security_dependencies() {
	print_status "Ensuring security dependencies (ufw, fail2ban)..."

	local packages=()
	command_exists ufw || packages+=("ufw")
	command_exists fail2ban-client || packages+=("fail2ban")

	if (( ${#packages[@]} > 0 )); then
		if [[ "${HOMEIO_VERBOSE}" == "true" ]]; then
			apt-get update -y
			apt-get install -y "${packages[@]}"
		else
			apt-get update -qq >/dev/null
			apt-get install -y -qq "${packages[@]}" >/dev/null
		fi
	fi

	systemctl enable --now fail2ban >/dev/null 2>&1 || true
	systemctl restart fail2ban >/dev/null 2>&1 || true
}

capture_current_state() {
	PREVIOUS_LOCK_HASH="$(hash_file "${INSTALL_DIR}/package-lock.json" || true)"
	if [[ -d "${INSTALL_DIR}/.git" ]]; then
		PREVIOUS_GIT_REV="$(git -C "${INSTALL_DIR}" rev-parse HEAD || true)"
	fi
}

create_backup() {
	if [[ "${HOMEIO_CREATE_BACKUP}" != "true" ]]; then
		print_warn "Skipping code backup (HOMEIO_CREATE_BACKUP=${HOMEIO_CREATE_BACKUP})."
		return
	fi

	local ts
	ts="$(date '+%Y%m%d-%H%M%S')"
	BACKUP_DIR="${HOMEIO_BACKUP_ROOT}/${ts}"
	mkdir -p "${BACKUP_DIR}"

	print_status "Creating backup at ${BACKUP_DIR}..."
	rsync -a \
		--delete \
		--exclude ".git" \
		--exclude "node_modules" \
		--exclude ".next" \
		"${INSTALL_DIR}/" "${BACKUP_DIR}/"
}

deploy_from_git() {
	# Never sit waiting for a username. This script is piped into `sudo bash`
	# with the services already stopped, so a prompt on stdin is an outage that
	# waits for someone to notice it. Fail fast and let the error path roll back.
	#
	# Git prompts for credentials whenever it cannot make sense of the server's
	# answer, which is not always an auth problem: a host whose network mangles
	# git's protocol v2 exchange produces "expected flush after ref listing" and
	# then a username prompt for a public repository. `git config --global
	# http.version HTTP/1.1`, or `protocol.version 0`, fixes that end.
	export GIT_TERMINAL_PROMPT=0

	if [[ -d "${INSTALL_DIR}/.git" ]]; then
		print_status "Updating from git (${REPO_BRANCH})..."
		git -C "${INSTALL_DIR}" fetch --depth=1 origin "${REPO_BRANCH}" --quiet
		git -C "${INSTALL_DIR}" checkout --force FETCH_HEAD --quiet
	else
		print_warn "No git repository at ${INSTALL_DIR}. Cloning fresh copy from ${REPO_URL}..."
		local tmp_dir
		tmp_dir="$(mktemp -d)"
		local clone_branch="${REPO_BRANCH:-main}"
		git clone --depth=1 --branch "${clone_branch}" --quiet "${REPO_URL}" "${tmp_dir}/repo"

		rsync -a \
			--delete \
			--exclude ".git" \
			--exclude "node_modules" \
			--exclude ".next" \
			--exclude ".env" \
			--exclude ".env.local" \
			"${tmp_dir}/repo/" "${INSTALL_DIR}/"

		rm -rf "${tmp_dir}"
		print_status "Fresh clone deployed."
	fi
}

deploy_from_tarball() {
	local tmp_dir
	local extract_dir
	local source_dir
	tmp_dir="$(mktemp -d)"
	extract_dir="${tmp_dir}/extract"
	mkdir -p "${extract_dir}"

	print_status "Downloading release tarball..."
	curl -fsSL "${HOMEIO_RELEASE_TARBALL_URL}" -o "${tmp_dir}/release.tar.gz"
	tar -xzf "${tmp_dir}/release.tar.gz" -C "${extract_dir}"

	if [[ -f "${extract_dir}/package.json" ]]; then
		source_dir="${extract_dir}"
	else
		source_dir="$(find "${extract_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
	fi

	[[ -n "${source_dir:-}" && -f "${source_dir}/package.json" ]] || { print_error "Could not locate app root in tarball."; exit 1; }

	print_status "Deploying tarball contents..."
	# .env and .env.local are the operator's, not the release's: they hold
	# DATABASE_URL and AUTH_SESSION_SECRET, and --delete would take them with
	# everything else the tarball does not contain. Losing AUTH_SESSION_SECRET
	# ends every session and orphans TOTP secrets, whose key is derived from it.
	# The git path has always excluded them; this one did not.
	rsync -a \
		--delete \
		--exclude ".git" \
		--exclude "node_modules" \
		--exclude ".next" \
		--exclude ".env" \
		--exclude ".env.local" \
		"${source_dir}/" "${INSTALL_DIR}/"

	rm -rf "${tmp_dir}"
}

install_dependencies_if_needed() {
	NEW_LOCK_HASH="$(hash_file "${INSTALL_DIR}/package-lock.json" || true)"

	if [[ "${PREVIOUS_LOCK_HASH}" != "${NEW_LOCK_HASH}" || ! -d "${INSTALL_DIR}/node_modules" ]]; then
		print_status "Dependency changes detected. Installing npm dependencies..."
		cd "${INSTALL_DIR}" && npm ci --silent --no-audit --no-fund 1>/dev/null
	else
		print_status "No dependency changes detected. Skipping npm ci."
	fi
}

run_database_migrations() {
	print_status "Syncing database schema..."

	if [[ ! -f "${ENV_FILE}" ]]; then
		print_error "Environment file not found: ${ENV_FILE}. Cannot sync schema."
		exit 1
	fi

	(set -a && source "${ENV_FILE}" && set +a && cd "${INSTALL_DIR}" && npm run db:init) \
		|| { print_error "Database schema sync failed. Rolling back."; exit 1; }

	print_status "Database schema synced successfully."
}

install_go() {
	local arch go_arch
	arch="$(detect_arch)"
	go_arch="amd64"
	[[ "${arch}" == "arm64" ]] && go_arch="arm64"

	if command_exists go; then
		local current
		current="$(go version 2>/dev/null | awk '{print $3}' | sed 's/^go//')"
		if [[ "${current}" == "${GO_VERSION}" ]]; then
			print_status "Go ${GO_VERSION} already installed."
			export PATH="/usr/local/go/bin:${PATH}"
			return
		fi
		print_status "Existing Go ${current} detected; installing Go ${GO_VERSION}."
	fi

	print_status "Installing Go ${GO_VERSION}..."
	local tarball="go${GO_VERSION}.linux-${go_arch}.tar.gz"
	curl -fsSL "https://go.dev/dl/${tarball}" -o "/tmp/${tarball}"
	rm -rf /usr/local/go
	tar -C /usr/local -xzf "/tmp/${tarball}"
	rm -f "/tmp/${tarball}"

	if [[ ! -f /etc/profile.d/go.sh ]]; then
		echo 'export PATH="/usr/local/go/bin:$PATH"' > /etc/profile.d/go.sh
	fi
	export PATH="/usr/local/go/bin:${PATH}"
	print_status "Go ${GO_VERSION} installed."
}

build_upload_server() {
	print_status "Building upload server (Go)..."

	# Go refuses to build without a cache directory, and a transient systemd
	# unit has no HOME to derive one from — that is how an in-app update once
	# left the server stuck on "Applying Homeio update…" forever.
	export HOME="${HOME:-/root}"
	export GOCACHE="${GOCACHE:-${HOME}/.cache/go-build}"
	export GOPATH="${GOPATH:-${HOME}/go}"
	mkdir -p "${GOCACHE}" "${GOPATH}"

	local src="${INSTALL_DIR}/services/upload-server"
	[[ -d "${src}" ]] || { print_error "Upload server source not found at ${src}"; exit 1; }

	mkdir -p "${INSTALL_DIR}/bin"

	local build_log
	build_log="$(mktemp)"
	if ! (cd "${src}" && env HOME="${HOME}" GOCACHE="${GOCACHE}" GOPATH="${GOPATH}" go build -o "${INSTALL_DIR}/bin/upload-server" .) >"${build_log}" 2>&1; then
		print_error "Failed to build upload server."
		print_error "Last output:"
		tail -10 "${build_log}" >&2
		rm -f "${build_log}"
		exit 1
	fi
	rm -f "${build_log}"

	print_status "Upload server built: ${INSTALL_DIR}/bin/upload-server"
}

stop_upload_server() {
	if systemctl cat "${UPLOAD_SERVICE_UNIT}" >/dev/null 2>&1; then
		print_status "Stopping ${UPLOAD_SERVICE_NAME} service..."
		systemctl stop "${UPLOAD_SERVICE_UNIT}" >/dev/null 2>&1 || true
	fi
}

restart_upload_server_service() {
	local unit_file="/etc/systemd/system/${UPLOAD_SERVICE_UNIT}"
	local is_new=false

	[[ ! -f "${unit_file}" ]] && is_new=true

	print_status "Writing ${UPLOAD_SERVICE_NAME} unit file..."
	cat >"${unit_file}" <<EOF
[Unit]
Description=${APP_NAME} Upload Service
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=${ENV_FILE}
Environment=UPLOAD_SERVER_ADDR=/run/home-server/upload.sock
RuntimeDirectory=home-server
RuntimeDirectoryMode=0755
ExecStart=${INSTALL_DIR}/bin/upload-server
Restart=always
RestartSec=5
KillMode=process
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${UPLOAD_SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
	if [[ "${is_new}" == "true" ]]; then
		systemctl enable "${UPLOAD_SERVICE_UNIT}"
	fi

	if [[ ! -f "${INSTALL_DIR}/bin/upload-server" ]]; then
		print_warn "Upload server binary not found; skipping service restart."
		return
	fi

	print_status "Restarting ${UPLOAD_SERVICE_NAME} service..."
	systemctl daemon-reload
	systemctl restart "${UPLOAD_SERVICE_UNIT}"

	sleep 1
	if systemctl is-active --quiet "${UPLOAD_SERVICE_UNIT}"; then
		print_status "Upload server service restarted successfully."
	else
		print_warn "Upload server service failed to start. Check: journalctl -u ${UPLOAD_SERVICE_NAME} -n 20"
	fi
}

build_app() {
	print_status "Building Next.js application..."
	local build_log
	build_log="$(mktemp)"
	if ! (cd "${INSTALL_DIR}" && npm run build >"${build_log}" 2>&1); then
		print_error "Build failed."
		print_error "Last output:"
		tail -20 "${build_log}" >&2
		rm -f "${build_log}"
		exit 1
	fi
	rm -f "${build_log}"
}

stop_service() {
	print_status "Stopping ${SERVICE_NAME} service..."
	systemctl stop "${SERVICE_UNIT}" >/dev/null 2>&1 || true
}

ensure_service_shutdown_behavior() {
	local unit_name="${SERVICE_UNIT%.service}"
	local drop_in_dir="/etc/systemd/system/${unit_name}.service.d"
	local drop_in_file="${drop_in_dir}/10-shutdown.conf"

	print_status "Ensuring clean ${SERVICE_NAME} shutdown settings..."
	mkdir -p "${drop_in_dir}"
	cat >"${drop_in_file}" <<'EOF'
[Service]
KillMode=control-group
TimeoutStopSec=30s
EOF

	systemctl daemon-reload
}

start_service() {
	print_status "Starting ${SERVICE_NAME} service..."
	systemctl daemon-reload
	systemctl start "${SERVICE_UNIT}"
}

restart_dbus_helper_service() {
	if ! systemctl cat "${DBUS_SERVICE_UNIT}" >/dev/null 2>&1; then
		print_warn "DBus helper unit ${DBUS_SERVICE_UNIT} not found; skipping helper restart."
		return
	fi

	print_status "Restarting DBus helper service..."
	systemctl daemon-reload
	systemctl enable --now "${DBUS_SERVICE_UNIT}"
	systemctl restart "${DBUS_SERVICE_UNIT}"
}

configure_reverse_proxy() {
	if ! command_exists nginx; then
		print_warn "nginx is not installed; skipping reverse proxy update."
		return
	fi

	local nginx_conf="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"
	local nginx_enabled="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"
	local maintenance_root="/var/lib/homeio-maintenance"
	local maintenance_file="${maintenance_root}/__homeio_unavailable.html"

	print_status "Configuring nginx reverse proxy on :${PUBLIC_PORT} -> 127.0.0.1:${APP_PORT}..."

	# The page itself ships in the repository, at
	# packages/os/overlay-common/var/lib/homeio-maintenance/. It used to be a
	# heredoc in this script *and* in the other one, and the two had drifted:
	# update.sh overwrote install.sh's copy on the first update, so the
	# installer's version was never seen by anyone and never maintained.
	#
	# The checkout is on disk by the time this runs — the repository sync is a
	# step earlier in both scripts — so it is a copy, not a generated file.
	mkdir -p "${maintenance_root}"
	local maintenance_src="${INSTALL_DIR}/packages/os/overlay-common/var/lib/homeio-maintenance/__homeio_unavailable.html"
	if [[ -f "${maintenance_src}" ]]; then
		cp "${maintenance_src}" "${maintenance_file}"
	else
		# An older checkout predates the file. The page is what a visitor sees
		# while the app restarts, so its absence is cosmetic — nginx falls back
		# to its own 502 — and is not worth failing an install or an update for.
		print_warn "Maintenance page not found at ${maintenance_src}; nginx will serve its default 502."
	fi

	cat >"${nginx_conf}" <<EOF
upstream homeio_backend {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen ${PUBLIC_PORT};
    listen [::]:${PUBLIC_PORT};
    server_name _;

    client_max_body_size 10G;
    client_body_timeout 7200s;
    client_header_timeout 300s;
    client_body_buffer_size 128k;

    proxy_read_timeout 7200s;
    proxy_send_timeout 7200s;
    proxy_connect_timeout 300s;

    proxy_intercept_errors on;
    error_page 502 503 504 /__homeio_unavailable.html;

    location = /__homeio_unavailable.html {
        root ${maintenance_root};
        default_type text/html;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    # Route file uploads directly to the Go upload server, bypassing Next.js.
    location = /api/v1/files/upload {
        proxy_pass http://unix:/run/home-server/upload.sock:/upload;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://homeio_backend;
        proxy_http_version 1.1;

        proxy_request_buffering off;
        proxy_buffering off;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";

        gzip off;
    }
}
EOF

	ln -sf "${nginx_conf}" "${nginx_enabled}"
	rm -f /etc/nginx/sites-enabled/default >/dev/null 2>&1 || true

	nginx -t
	systemctl enable --now nginx
	systemctl reload nginx
}

healthcheck() {
	local attempts=0
	while (( attempts < HOMEIO_HEALTHCHECK_RETRIES )); do
		if curl -fsS --max-time 5 "${HOMEIO_HEALTHCHECK_URL}" >/dev/null; then
			return 0
		fi
		attempts=$((attempts + 1))
		sleep "${HOMEIO_HEALTHCHECK_DELAY_SEC}"
	done

	return 1
}

rollback_release() {
	trap - ERR
	ROLLBACK_DONE="true"

	print_error "Update failed! Attempting rollback..."
	stop_upload_server
	stop_service

	if [[ -n "${BACKUP_DIR}" && -d "${BACKUP_DIR}" ]]; then
		print_status "Restoring backup from ${BACKUP_DIR}..."
		rsync -a --delete "${BACKUP_DIR}/" "${INSTALL_DIR}/"
	elif [[ -n "${PREVIOUS_GIT_REV}" && -d "${INSTALL_DIR}/.git" ]]; then
		print_status "Restoring previous git revision ${PREVIOUS_GIT_REV}..."
		git -C "${INSTALL_DIR}" checkout --force "${PREVIOUS_GIT_REV}" --quiet
	else
		print_error "No rollback source available."; exit 1;
	fi

	print_status "Rebuilding application after rollback..."
	cd "${INSTALL_DIR}" && npm ci --no-audit --no-fund
	cd "${INSTALL_DIR}" && npm run build
	build_upload_server || true
	start_service
	restart_upload_server_service || true

	if healthcheck; then
		print_status "Rollback succeeded."
	else
		print_error "Rollback failed health check. Manual intervention required."; exit 1;
	fi
}

on_error() {
	local line_no="${1}"
	local exit_code="${2}"
	if [[ "${ROLLBACK_READY}" == "true" && "${ROLLBACK_DONE}" != "true" ]]; then
		print_error "Update failed at line ${line_no} (exit ${exit_code})."
		rollback_release || true
	fi
	exit "${exit_code}"
}

print_summary() {
	local host primary_ip local_url network_url
	host="$(hostnamectl --static 2>/dev/null || hostname)"
	primary_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"

	if [[ "${PUBLIC_PORT}" == "80" ]]; then
		local_url="http://${host}.local"
	else
		local_url="http://${host}.local:${PUBLIC_PORT}"
	fi

	if [[ -n "${primary_ip}" ]]; then
		if [[ "${PUBLIC_PORT}" == "80" ]]; then
			network_url="http://${primary_ip}"
		else
			network_url="http://${primary_ip}:${PUBLIC_PORT}"
		fi
	fi

	echo ""
	echo -e "${GREEN}╭────────────────────────────────────────────────────╮${NC}"
	echo -e "${GREEN}│         Update Complete!                          │${NC}"
	echo -e "${GREEN}├────────────────────────────────────────────────────┤${NC}"
	echo -e "${GREEN}│${NC}  ${APP_NAME} has been updated successfully!      ${GREEN}│${NC}"
	echo -e "${GREEN}│${NC}                                                  ${GREEN}│${NC}"
	printf "%b\n" "${GREEN}│${NC}  ${BLUE}*${NC} Local:      ${BLUE}${local_url}${NC}"
	if [[ -n "${network_url}" ]]; then
		printf "%b\n" "${GREEN}│${NC}  ${BLUE}*${NC} Network:    ${BLUE}${network_url}${NC}"
	fi
	echo -e "${GREEN}│${NC}                                                  ${GREEN}│${NC}"
	echo -e "${GREEN}╰────────────────────────────────────────────────────╯${NC}"
	echo ""

	echo -e "${BLUE}Manage service:${NC}"
	echo -e "  sudo systemctl [start|stop|restart|status] ${SERVICE_UNIT}"
	echo ""
	echo -e "${BLUE}View logs:${NC}"
	echo -e "  sudo journalctl -u ${SERVICE_UNIT} -f"
	echo -e "  sudo journalctl -u ${DBUS_SERVICE_UNIT} -f"
	echo ""
	echo -e "${BLUE}Health check:${NC}"
	echo -e "  ${HOMEIO_HEALTHCHECK_URL}"
	echo ""
	if [[ -n "${BACKUP_DIR}" && -d "${BACKUP_DIR}" ]]; then
		echo -e "${BLUE}Backup location:${NC}"
		echo -e "  ${BACKUP_DIR}"
		echo ""
	fi
}

main() {
	require_root
	check_prerequisites
	capture_current_state
	create_backup

	ROLLBACK_READY="true"
	trap 'on_error ${LINENO} $?' ERR

	ensure_service_shutdown_behavior
	stop_upload_server
	stop_service

	if [[ -n "${HOMEIO_RELEASE_TAG}" ]]; then
		if [[ "${HOMEIO_RELEASE_TAG}" == "latest" ]]; then
			print_status "Fetching latest release URL..."
			HOMEIO_RELEASE_TARBALL_URL="$(curl -fsSL \
				"https://api.github.com/repos/doctor-io/homeio/releases/latest" \
				| jq -r '.tarball_url')"
			[[ -n "${HOMEIO_RELEASE_TARBALL_URL}" ]] || {
				print_error "Could not fetch latest release URL."; false
			}
		else
			HOMEIO_RELEASE_TARBALL_URL="https://github.com/doctor-io/homeio/archive/refs/tags/${HOMEIO_RELEASE_TAG}.tar.gz"
		fi
		deploy_from_tarball
	elif [[ -n "${HOMEIO_RELEASE_TARBALL_URL}" ]]; then
		deploy_from_tarball
	else
		deploy_from_git
	fi

	ensure_security_dependencies
	install_go
	install_dependencies_if_needed
	run_database_migrations
	build_app
	build_upload_server
	start_service
	configure_reverse_proxy
	restart_dbus_helper_service
	restart_upload_server_service

	print_status "Running health check..."
	if ! healthcheck; then
		print_error "Health check failed at ${HOMEIO_HEALTHCHECK_URL}"; exit 1;
	fi

	ROLLBACK_READY="false"
	print_summary
}

main "$@"
