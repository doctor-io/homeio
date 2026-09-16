import "server-only";

import { run } from "@/lib/server/platform/process";

/**
 * Host identity and firewall — the settings that belong to the machine rather
 * than to Homeio.
 *
 * Every function here can legitimately be unavailable. `hostnamectl` and
 * `timedatectl` are systemd's, and Homeio runs in containers that have neither;
 * `ufw` is a Debian convenience that plenty of hosts do not install. Callers
 * are expected to catch and fall back, which is why nothing here swallows a
 * failure on its own: a wrapper that turned "not installed" into a silent
 * no-op would leave a user believing a firewall rule had been applied.
 */

/** The static hostname, as systemd records it. */
export async function getHostname(): Promise<string> {
  const { stdout } = await run("hostnamectl", ["--static"], {
    timeoutMs: 10_000,
    loggableArgs: ["--static"],
  });
  return stdout.trim();
}

/** The running hostname, where `hostnamectl` is absent. */
export async function getHostnameLegacy(): Promise<string> {
  const { stdout } = await run("hostname", [], { timeoutMs: 10_000, loggableArgs: [] });
  return stdout.trim();
}

export async function getTimezone(): Promise<string> {
  const args = ["show", "--property=Timezone", "--value"];
  const { stdout } = await run("timedatectl", args, { timeoutMs: 10_000, loggableArgs: args });
  return stdout.trim();
}

/** `ufw status verbose`, raw, for the caller to parse. */
export async function firewallStatus(): Promise<string> {
  const args = ["status", "verbose"];
  const { stdout } = await run("ufw", args, { timeoutMs: 30_000, loggableArgs: args });
  return stdout.trim();
}

export async function setHostname(hostname: string) {
  await run("hostnamectl", ["set-hostname", hostname], {
    timeoutMs: 15_000,
    loggableArgs: ["set-hostname", hostname],
  });
}

/**
 * The pre-systemd way, for hosts without `hostnamectl`.
 *
 * Fails with EPERM in a container without SYS_ADMIN, which the caller treats
 * as "the hosts file is the best we can do here" rather than as an error.
 */
export async function setHostnameLegacy(hostname: string) {
  await run("hostname", [hostname], { timeoutMs: 15_000, loggableArgs: [hostname] });
}

export async function setTimezone(timezone: string) {
  await run("timedatectl", ["set-timezone", timezone], {
    timeoutMs: 15_000,
    loggableArgs: ["set-timezone", timezone],
  });
}

export type FirewallPolicy = string;

/** `ufw default <policy> incoming|outgoing`. */
export async function setFirewallDefault(policy: FirewallPolicy, direction: "incoming" | "outgoing") {
  const args = ["default", policy, direction];
  await run("ufw", args, { timeoutMs: 30_000, loggableArgs: args });
}

/**
 * Turns the firewall on or off.
 *
 * `--force` is what keeps `ufw enable` from stopping to ask whether you
 * understand it may disrupt existing ssh connections — a question nobody is
 * there to answer.
 */
export async function setFirewallEnabled(enabled: boolean) {
  const args = ["--force", enabled ? "enable" : "disable"];
  await run("ufw", args, { timeoutMs: 30_000, loggableArgs: args });
}
