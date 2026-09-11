#!/usr/bin/env bash
set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_NAME="home-server"
APP_USER="${HOMEIO_USER:-homeio}"
APP_GROUP="${HOMEIO_GROUP:-${APP_USER}}"
INSTALL_DIR="${HOMEIO_INSTALL_DIR:-/opt/home-server}"
DATA_DIR="${HOMEIO_DATA_DIR:-/var/lib/home-server}"
ENV_DIR="${HOMEIO_ENV_DIR:-/etc/home-server}"
ENV_FILE="${HOMEIO_ENV_FILE:-${ENV_DIR}/home-server.env}"
SERVICE_NAME="${HOMEIO_SERVICE_NAME:-home-server}"
DBUS_SERVICE_NAME="${HOMEIO_DBUS_SERVICE_NAME:-home-server-dbus}"
NGINX_SITE_NAME="${HOMEIO_NGINX_SITE_NAME:-home-server}"

PURGE="false"
ASSUME_YES="false"
REMOVE_SYSTEM_USER="false"

SERVICE_UNIT="${SERVICE_NAME}"
if [[ "${SERVICE_UNIT}" != *.service ]]; then
	SERVICE_UNIT="${SERVICE_UNIT}.service"
fi

DBUS_SERVICE_UNIT="${DBUS_SERVICE_NAME}"
if [[ "${DBUS_SERVICE_UNIT}" != *.service ]]; then
	DBUS_SERVICE_UNIT="${DBUS_SERVICE_UNIT}.service"
fi

print_status() { echo -e "${GREEN}[+]${NC} $1"; }
print_error() { echo -e "${RED}[!]${NC} $1" >&2; }
print_warn() { echo -e "${YELLOW}[*]${NC} $1"; }

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

require_root() {
	[[ "${EUID}" -eq 0 ]] || { print_error "Run this uninstall script as root (for example: sudo bash uninstall.sh)."; exit 1; }
}

get_env_value() {
	local key="${1}"
	local file="${2}"
	[[ -f "${file}" ]] || return 1
	grep -E "^${key}=" "${file}" | head -n 1 | cut -d '=' -f 2-
}

confirm() {
	local message="${1}"
	if [[ "${ASSUME_YES}" == "true" ]]; then
		return 0
	fi

	local reply=""

	if [[ -t 0 ]]; then
		# Normal interactive mode
		read -r -p "${message} [y/N]: " reply
	elif read -r -p "${message} [y/N]: " reply 2>/dev/null </dev/tty; then
		# stdin is a pipe (curl ... | bash) but a terminal is still attached
		:
	else
		# Piped with no usable terminal: /dev/tty can exist yet not be openable,
		# as over a non-interactive ssh, so this is decided by trying it.
		print_error "Script is running non-interactively. Use --yes flag to proceed without confirmation."
		exit 1
	fi

	[[ "${reply}" == "y" || "${reply}" == "Y" ]]
}

usage() {
	cat <<EOF
Usage: sudo bash uninstall.sh [options]

Options:
  --purge         Remove data, env, and PostgreSQL database/role.
  --remove-user   Remove system user/group (only with --purge).
  -y, --yes       Do not ask for confirmation.
  -h, --help      Show this help.
EOF
}

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "${1}" in
			--purge)
				PURGE="true"
				shift
				;;
			--remove-user)
				REMOVE_SYSTEM_USER="true"
				shift
				;;
			-y|--yes)
				ASSUME_YES="true"
				shift
				;;
			-h|--help)
				usage
				exit 0
				;;
			*)
				print_error "Unknown option: ${1}"
				exit 1
				;;
		esac
	done

	if [[ "${REMOVE_SYSTEM_USER}" == "true" && "${PURGE}" != "true" ]]; then
		print_error "--remove-user requires --purge."
		exit 1
	fi
}

stop_and_remove_service() {
	if command_exists systemctl; then
		print_status "Stopping and disabling ${SERVICE_UNIT}..."
		systemctl stop "${SERVICE_UNIT}" >/dev/null 2>&1 || true
		systemctl disable "${SERVICE_UNIT}" >/dev/null 2>&1 || true
		print_status "Stopping and disabling ${DBUS_SERVICE_UNIT}..."
		systemctl stop "${DBUS_SERVICE_UNIT}" >/dev/null 2>&1 || true
		systemctl disable "${DBUS_SERVICE_UNIT}" >/dev/null 2>&1 || true
	fi

	local unit_file="/etc/systemd/system/${SERVICE_UNIT}"
	if [[ -f "${unit_file}" ]]; then
		print_status "Removing systemd service files..."
		rm -f "${unit_file}"
	fi
	local dbus_unit_file="/etc/systemd/system/${DBUS_SERVICE_UNIT}"
	if [[ -f "${dbus_unit_file}" ]]; then
		rm -f "${dbus_unit_file}"
	fi

	if command_exists systemctl; then
		systemctl daemon-reload
		systemctl reset-failed >/dev/null 2>&1 || true
	fi

	rm -f /run/home-server/dbus-helper.sock >/dev/null 2>&1 || true
	rmdir /run/home-server >/dev/null 2>&1 || true
}

remove_reverse_proxy() {
	if ! command_exists nginx; then
		print_warn "nginx is not installed; skipping reverse proxy removal."
		return
	fi

	local nginx_conf="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"
	local nginx_enabled="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"
	local default_available="/etc/nginx/sites-available/default"
	local default_enabled="/etc/nginx/sites-enabled/default"

	if [[ -f "${nginx_conf}" || -L "${nginx_enabled}" ]]; then
		print_status "Removing nginx site ${NGINX_SITE_NAME}..."
		rm -f "${nginx_enabled}" >/dev/null 2>&1 || true
		rm -f "${nginx_conf}" >/dev/null 2>&1 || true
	fi

	if [[ -f "${default_available}" && ! -e "${default_enabled}" ]]; then
		print_status "Restoring nginx default site..."
		ln -sf "${default_available}" "${default_enabled}"
	fi

	nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
}

remove_app_files() {
	if [[ -d "${INSTALL_DIR}" ]]; then
		print_status "Removing app files from ${INSTALL_DIR}..."
		rm -rf "${INSTALL_DIR}"
	else
		print_warn "Install directory ${INSTALL_DIR} not found; skipping."
	fi
}

purge_database() {
	local db_name
	local db_user
	db_name="$(get_env_value HOMEIO_DB_NAME "${ENV_FILE}" || true)"
	db_user="$(get_env_value HOMEIO_DB_USER "${ENV_FILE}" || true)"

	[[ -n "${db_name}" ]] || db_name="home_server"
	[[ -n "${db_user}" ]] || db_user="home_server"

	if ! id -u postgres >/dev/null 2>&1; then
		print_warn "PostgreSQL OS user not found; skipping DB purge."
		return
	fi

	print_status "Dropping PostgreSQL database '${db_name}'..."
	runuser -u postgres -- dropdb --if-exists --force "${db_name}" >/dev/null 2>&1 || true

	print_status "Dropping PostgreSQL role '${db_user}'..."
	runuser -u postgres -- psql -v ON_ERROR_STOP=1 --set=db_user="${db_user}" >/dev/null 2>&1 <<'SQL' || true
SELECT format('DROP ROLE %I', :'db_user')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user')
\gexec
SQL
}

purge_data_and_env() {
	if [[ -d "${DATA_DIR}" ]]; then
		print_status "Removing data directory ${DATA_DIR}..."
		rm -rf "${DATA_DIR}"
	fi

	if [[ -f "${ENV_FILE}" ]]; then
		print_status "Removing env file ${ENV_FILE}..."
		rm -f "${ENV_FILE}"
	fi

	if [[ -d "${ENV_DIR}" ]]; then
		rmdir "${ENV_DIR}" >/dev/null 2>&1 || true
	fi
}

remove_system_user_group() {
	if [[ "${REMOVE_SYSTEM_USER}" != "true" ]]; then
		return
	fi

	if id -u "${APP_USER}" >/dev/null 2>&1; then
		print_status "Removing system user ${APP_USER}..."
		userdel "${APP_USER}" >/dev/null 2>&1 || true
	fi

	if getent group "${APP_GROUP}" >/dev/null 2>&1; then
		print_status "Removing system group ${APP_GROUP}..."
		groupdel "${APP_GROUP}" >/dev/null 2>&1 || true
	fi
}

print_summary() {
	echo ""
	if [[ "${PURGE}" == "true" ]]; then
		echo -e "${GREEN}╭────────────────────────────────────────────────────╮${NC}"
		echo -e "${GREEN}│         Uninstall Complete (Purge)                │${NC}"
		echo -e "${GREEN}├────────────────────────────────────────────────────┤${NC}"
		echo -e "${GREEN}│${NC}  ${APP_NAME} has been completely removed.          ${GREEN}│${NC}"
		echo -e "${GREEN}│${NC}  All data, database, and configuration deleted.${GREEN}│${NC}"
		echo -e "${GREEN}╰────────────────────────────────────────────────────╯${NC}"
	else
		echo -e "${GREEN}╭────────────────────────────────────────────────────╮${NC}"
		echo -e "${GREEN}│         Uninstall Complete                        │${NC}"
		echo -e "${GREEN}├────────────────────────────────────────────────────┤${NC}"
		echo -e "${GREEN}│${NC}  ${APP_NAME} has been removed.                     ${GREEN}│${NC}"
		echo -e "${GREEN}│${NC}                                                  ${GREEN}│${NC}"
		echo -e "${YELLOW}│${NC}  ${YELLOW}Note:${NC} Database and data were preserved.        ${GREEN}│${NC}"
		echo -e "${GREEN}│${NC}  Run with ${BLUE}--purge${NC} to remove everything.        ${GREEN}│${NC}"
		echo -e "${GREEN}╰────────────────────────────────────────────────────╯${NC}"
	fi
	echo ""
}

main() {
	parse_args "$@"
	require_root

	local mode="without purge"
	if [[ "${PURGE}" == "true" ]]; then
		mode="with purge"
	fi

	if ! confirm "Uninstall ${APP_NAME} (${mode})?"; then
		print_warn "Cancelled."
		exit 0
	fi

	stop_and_remove_service
	remove_reverse_proxy
	remove_app_files

	if [[ "${PURGE}" == "true" ]]; then
		purge_database
		purge_data_and_env
		remove_system_user_group
	fi

	print_summary
}

main "$@"
