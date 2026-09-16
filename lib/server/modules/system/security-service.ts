import "server-only";

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as systemd from "@/lib/server/platform/systemd";
import {
  SYSTEM_SECURITY_BAN_DURATION_MAX,
  SYSTEM_SECURITY_BAN_DURATION_MIN,
  SYSTEM_SECURITY_MAX_RETRIES_MAX,
  SYSTEM_SECURITY_MAX_RETRIES_MIN,
  SYSTEM_SECURITY_POLICY_OPTIONS,
  type SystemSecurityPolicy,
  type SystemSecuritySettings,
} from "@/lib/shared/contracts/system";

const SECURITY_POLICY_SET = new Set<SystemSecurityPolicy>(SYSTEM_SECURITY_POLICY_OPTIONS);
const DEFAULT_FIREWALL_INCOMING_POLICY: SystemSecurityPolicy = "deny";
const DEFAULT_FIREWALL_OUTGOING_POLICY: SystemSecurityPolicy = "allow";
const DEFAULT_FAIL2BAN_MAX_RETRIES = 5;
const DEFAULT_FAIL2BAN_BAN_DURATION_SECONDS = 3_600;

function resolveFail2BanOverridePath() {
  return process.env.HOMEIO_FAIL2BAN_OVERRIDE_PATH ?? "/etc/fail2ban/jail.d/homeio.local";
}

function normalizeSecurityPolicy(value: string, fieldName: string): SystemSecurityPolicy {
  const normalized = value.trim().toLowerCase() as SystemSecurityPolicy;
  if (!SECURITY_POLICY_SET.has(normalized)) {
    throw new Error(`Invalid ${fieldName}. Choose allow, deny, or reject.`);
  }
  return normalized;
}

function normalizeBoundedInteger(
  fieldName: string,
  value: number,
  min: number,
  max: number,
) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getExecFailureDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { stdout: "", stderr: "", message: String(error ?? "") };
  }

  const execError = error as Error & { stdout?: string; stderr?: string };
  return {
    stdout: execError.stdout ?? "",
    stderr: execError.stderr ?? "",
    message: execError.message,
  };
}

function isToolUnavailable(error: unknown) {
  const { stdout, stderr, message } = getExecFailureDetails(error);
  const haystack = `${message}\n${stdout}\n${stderr}`.toLowerCase();
  return (
    haystack.includes("enoent") ||
    haystack.includes("not found") ||
    haystack.includes("not-found") ||
    haystack.includes("could not be found") ||
    haystack.includes("no such file") ||
    haystack.includes("unit fail2ban.service could not be found")
  );
}

async function readCommandOutput(command: string, args: string[]) {
  const { stdout } = await execFileAsync(command, args);
  return stdout.trim();
}

function execFileAsync(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, (error, stdout = "", stderr = "") => {
      if (error) {
        const execError = error as Error & { stdout?: string; stderr?: string };
        execError.stdout = stdout;
        execError.stderr = stderr;
        reject(execError);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function readUfwStatus() {
  let stdout = "";

  try {
    stdout = await readCommandOutput("ufw", ["status", "verbose"]);
  } catch (error) {
    if (isToolUnavailable(error)) {
      return null;
    }
    throw error;
  }

  const enabled = /^status:\s+active$/im.test(stdout);
  const defaultLine = stdout.match(/^default:\s+(.+)$/im)?.[1]?.toLowerCase() ?? "";
  const incomingPolicy =
    (defaultLine.match(/(allow|deny|reject)\s+\(incoming\)/)?.[1] as
      | SystemSecurityPolicy
      | undefined) ?? DEFAULT_FIREWALL_INCOMING_POLICY;
  const outgoingPolicy =
    (defaultLine.match(/(allow|deny|reject)\s+\(outgoing\)/)?.[1] as
      | SystemSecurityPolicy
      | undefined) ?? DEFAULT_FIREWALL_OUTGOING_POLICY;

  return {
    enabled,
    incomingPolicy,
    outgoingPolicy,
  };
}

async function readFail2BanEnabled() {
  try {
    const state = await readCommandOutput("systemctl", ["is-enabled", "fail2ban"]);
    return state === "enabled";
  } catch (error) {
    const { stdout } = getExecFailureDetails(error);
    const normalizedStdout = stdout.trim().toLowerCase();
    if (["disabled", "masked", "indirect", "static", "not-found"].includes(normalizedStdout)) {
      return false;
    }

    if (isToolUnavailable(error)) {
      return false; // systemctl not available (e.g. Alpine / non-systemd host)
    }

    throw error;
  }
}

function parseFail2BanOverride(content: string) {
  const maxRetries = Number.parseInt(
    content.match(/^\s*maxretry\s*=\s*(\d+)\s*$/im)?.[1] ??
      String(DEFAULT_FAIL2BAN_MAX_RETRIES),
    10,
  );
  const banDuration = Number.parseInt(
    content.match(/^\s*bantime\s*=\s*(\d+)\s*$/im)?.[1] ??
      String(DEFAULT_FAIL2BAN_BAN_DURATION_SECONDS),
    10,
  );

  return {
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : DEFAULT_FAIL2BAN_MAX_RETRIES,
    banDuration:
      Number.isFinite(banDuration) ? banDuration : DEFAULT_FAIL2BAN_BAN_DURATION_SECONDS,
  };
}

async function readFail2BanSettings() {
  const enabled = await readFail2BanEnabled();
  const overridePath = resolveFail2BanOverridePath();

  try {
    const content = await readFile(overridePath, "utf8");
    const parsed = parseFail2BanOverride(content);
    return {
      enabled,
      maxRetries: parsed.maxRetries,
      banDuration: parsed.banDuration,
    };
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException | undefined)?.code;
    if (errorCode === "ENOENT") {
      return {
        enabled,
        maxRetries: DEFAULT_FAIL2BAN_MAX_RETRIES,
        banDuration: DEFAULT_FAIL2BAN_BAN_DURATION_SECONDS,
      };
    }
    throw error;
  }
}

export function buildFail2BanOverrideContent(input: {
  maxRetries: number;
  banDurationSeconds: number;
}) {
  return [
    "[DEFAULT]",
    `maxretry = ${input.maxRetries}`,
    `bantime = ${input.banDurationSeconds}`,
    "",
  ].join("\n");
}

async function writeFail2BanOverrideFile(input: {
  maxRetries: number;
  banDurationSeconds: number;
}) {
  const overridePath = resolveFail2BanOverridePath();
  await mkdir(path.dirname(overridePath), { recursive: true });
  await writeFile(overridePath, buildFail2BanOverrideContent(input), "utf8");
}

async function applyFail2BanSettings(input: {
  enabled: boolean;
  maxRetries: number;
  banDurationSeconds: number;
}) {
  try {
    await writeFail2BanOverrideFile(input);

    if (input.enabled) {
      await systemd.enable("fail2ban", { now: true });
      await systemd.restart("fail2ban");
      return;
    }

    await systemd.disable("fail2ban", { now: true });
  } catch (error) {
    if (isToolUnavailable(error)) {
      throw new Error("Fail2Ban is not installed or unavailable on this host.");
    }
    throw error;
  }
}

async function applyFirewallSettings(input: {
  enabled: boolean;
  incomingPolicy: SystemSecurityPolicy;
  outgoingPolicy: SystemSecurityPolicy;
}) {
  try {
    await execFileAsync("ufw", ["default", input.incomingPolicy, "incoming"]);
    await execFileAsync("ufw", ["default", input.outgoingPolicy, "outgoing"]);
    await execFileAsync("ufw", ["--force", input.enabled ? "enable" : "disable"]);
  } catch (error) {
    if (isToolUnavailable(error)) {
      throw new Error("UFW is not installed or unavailable on this host.");
    }
    throw error;
  }
}

function normalizeSecuritySettings(input: SystemSecuritySettings): SystemSecuritySettings {
  return {
    firewallEnabled: Boolean(input.firewallEnabled),
    firewallIncomingPolicy: normalizeSecurityPolicy(
      input.firewallIncomingPolicy,
      "incoming policy",
    ),
    firewallOutgoingPolicy: normalizeSecurityPolicy(
      input.firewallOutgoingPolicy,
      "outgoing policy",
    ),
    fail2banEnabled: Boolean(input.fail2banEnabled),
    fail2banMaxRetries: normalizeBoundedInteger(
      "Fail2Ban max retries",
      input.fail2banMaxRetries,
      SYSTEM_SECURITY_MAX_RETRIES_MIN,
      SYSTEM_SECURITY_MAX_RETRIES_MAX,
    ),
    fail2banBanDurationSeconds: normalizeBoundedInteger(
      "Fail2Ban ban duration",
      input.fail2banBanDurationSeconds,
      SYSTEM_SECURITY_BAN_DURATION_MIN,
      SYSTEM_SECURITY_BAN_DURATION_MAX,
    ),
  };
}

export async function getSystemSecuritySettings(): Promise<SystemSecuritySettings> {
  const [firewall, fail2ban] = await Promise.all([readUfwStatus(), readFail2BanSettings()]);

  return {
    firewallEnabled: firewall?.enabled ?? false,
    firewallIncomingPolicy: firewall?.incomingPolicy ?? DEFAULT_FIREWALL_INCOMING_POLICY,
    firewallOutgoingPolicy: firewall?.outgoingPolicy ?? DEFAULT_FIREWALL_OUTGOING_POLICY,
    fail2banEnabled: fail2ban.enabled,
    fail2banMaxRetries: fail2ban.maxRetries,
    fail2banBanDurationSeconds: fail2ban.banDuration,
  };
}

export async function updateSystemSecuritySettings(input: SystemSecuritySettings) {
  const next = normalizeSecuritySettings(input);

  try {
    await applyFirewallSettings({
      enabled: next.firewallEnabled,
      incomingPolicy: next.firewallIncomingPolicy,
      outgoingPolicy: next.firewallOutgoingPolicy,
    });
    await applyFail2BanSettings({
      enabled: next.fail2banEnabled,
      maxRetries: next.fail2banMaxRetries,
      banDurationSeconds: next.fail2banBanDurationSeconds,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }

  return getSystemSecuritySettings();
}
