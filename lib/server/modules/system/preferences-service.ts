import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import { SYSTEM_TIMEZONE_OPTIONS, type SystemPreferences } from "@/lib/shared/contracts/system";
import * as systemd from "@/lib/server/platform/systemd";
import * as host from "@/lib/server/platform/host";

const ALLOWED_TIMEZONE_SET = new Set<string>(SYSTEM_TIMEZONE_OPTIONS);

function normalizeHostname(input: string) {
  let hostname = input.trim().toLowerCase().replace(/\s+/g, "");
  if (hostname.endsWith(".local")) {
    hostname = hostname.slice(0, -6);
  }
  if (!hostname) {
    hostname = "homeio";
  }
  if (!/^[a-z0-9][a-z0-9.-]{0,62}$/.test(hostname)) {
    throw new Error(
      "Invalid hostname. Use lowercase letters, numbers, hyphens, and dots.",
    );
  }
  return hostname;
}



function resolveTimezoneFilePath() {
  return process.env.HOMEIO_TIMEZONE_FILE_PATH ?? "/etc/timezone";
}

function resolveHostsFilePath() {
  return process.env.HOMEIO_HOSTS_FILE_PATH ?? "/etc/hosts";
}

function isCommandUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("enoent") || message.includes("no such file");
}

function isOperationNotPermitted(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("operation not permitted") || message.includes("eperm");
}

function isIgnorableAvahiError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const stdout = (error as Error & { stdout?: string }).stdout ?? "";
  const stderr = (error as Error & { stderr?: string }).stderr ?? "";
  const haystack = `${error.message}\n${stdout}\n${stderr}`.toLowerCase();
  return (
    haystack.includes("avahi-daemon.service could not be found") ||
    haystack.includes("unit avahi-daemon.service not found") ||
    haystack.includes("not found") ||
    haystack.includes("enoent")
  );
}

async function readHostname() {
  try {
    const hostname = await host.getHostname();
    if (hostname.length > 0) return hostname;
  } catch {
    // fallback below
  }

  return host.getHostnameLegacy();
}

async function readTimezone() {
  try {
    const timezone = await host.getTimezone();
    if (timezone.length > 0) return timezone;
  } catch {
    // fallback below
  }

  try {
    const timezone = await readFile(resolveTimezoneFilePath(), "utf8");
    if (timezone.trim().length > 0) return timezone.trim();
  } catch {
    // fallback below
  }

  return "UTC";
}

async function syncHostsFile(hostname: string) {
  let currentHosts = "";
  const hostsFilePath = resolveHostsFilePath();
  try {
    currentHosts = await readFile(hostsFilePath, "utf8");
  } catch {
    currentHosts = "";
  }

  const hostsEntry = hostname.includes(".")
    ? `127.0.1.1 ${hostname}`
    : `127.0.1.1 ${hostname} ${hostname}.local`;

  let nextHosts: string;
  if (/^127\.0\.1\.1/m.test(currentHosts)) {
    nextHosts = currentHosts.replace(/^127\.0\.1\.1.*$/m, hostsEntry);
  } else {
    nextHosts = `${currentHosts.trimEnd()}\n${hostsEntry}\n`;

  }

  try {
    await writeFile(hostsFilePath, nextHosts, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
    // /etc/hosts is root-owned in containers — skip silently
  }
}

async function restartAvahiDaemon() {
  try {
    await systemd.restart("avahi-daemon");
  } catch (error) {
    if (isIgnorableAvahiError(error)) {
      return;
    }
    throw error;
  }
}

export async function getSystemPreferences(): Promise<SystemPreferences> {
  const [hostname, timezone] = await Promise.all([readHostname(), readTimezone()]);
  return { hostname, timezone };
}

export async function updateSystemPreferences(input: SystemPreferences) {
  const hostname = normalizeHostname(input.hostname);
  const current = await getSystemPreferences();
  const timezone = input.timezone.trim();

  if (!ALLOWED_TIMEZONE_SET.has(timezone) && timezone !== current.timezone) {
    throw new Error("Invalid timezone. Choose one of the supported timezone options.");
  }

  if (hostname !== current.hostname) {
    try {
      await host.setHostname(hostname);
    } catch (error) {
      if (!isCommandUnavailable(error)) throw error;
      try {
        await host.setHostnameLegacy(hostname);
      } catch (fallbackError) {
        if (!isOperationNotPermitted(fallbackError)) throw fallbackError;
        // container without SYS_ADMIN — system hostname unchanged, hosts file still updated below
      }
    }
    await syncHostsFile(hostname);
    await restartAvahiDaemon();
  }

  if (timezone !== current.timezone) {
    try {
      await host.setTimezone(timezone);
    } catch (error) {
      if (!isCommandUnavailable(error)) throw error;
      try {
        await writeFile(resolveTimezoneFilePath(), `${timezone}\n`, "utf8");
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EACCES") throw writeError;
        // /etc/timezone is root-owned in containers — skip silently
      }
    }
  }

  return getSystemPreferences();
}
