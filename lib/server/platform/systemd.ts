import "server-only";

import { run } from "@/lib/server/platform/process";

/**
 * systemd, as the rest of the server is allowed to see it.
 *
 * Eighteen call sites across seven modules were spelling these out by hand, and
 * the two that matter most — the backup restore and the factory reset — build a
 * transient unit whose whole purpose is to outlive the process that asked for
 * it. Getting that wrong does not fail loudly; it leaves a half-restored
 * machine.
 */

/**
 * `active`, `inactive`, `failed`, `activating`… — whatever systemd says, or
 * `unknown` when it will not say.
 *
 * `systemctl is-active` exits non-zero for anything that is not active, so the
 * status has to be read from stdout rather than from the exit code. Call sites
 * that used `execFile` directly had to remember that; several did not, and read
 * a stopped service as an error.
 */
/**
 * The exit codes these two queries use to mean "no".
 *
 * 1 is disabled or generic, 3 inactive, 4 no such unit — none of them a fault.
 * Listing them keeps a routine "is this running?" out of the journal's error
 * stream: the answer is on stdout either way, and a service that is simply not
 * installed was producing an ERROR line on every poll.
 */
const ANSWERED_BY_EXIT_CODE = [1, 2, 3, 4];

export async function isActive(unit: string): Promise<string> {
  return run("systemctl", ["is-active", unit], {
    timeoutMs: 10_000,
    loggableArgs: ["is-active", unit],
    allowedExitCodes: ANSWERED_BY_EXIT_CODE,
  })
    .then(({ stdout }) => stdout.trim() || "unknown")
    .catch((error: unknown) => {
      const stdout = (error as { stdout?: string })?.stdout;
      if (typeof stdout === "string" && stdout.trim()) return stdout.trim();
      return "unknown";
    });
}

export async function start(unit: string) {
  await run("systemctl", ["start", unit], { loggableArgs: ["start", unit] });
}

export async function stop(unit: string) {
  await run("systemctl", ["stop", unit], { loggableArgs: ["stop", unit] });
}

export async function restart(unit: string) {
  await run("systemctl", ["restart", unit], { loggableArgs: ["restart", unit] });
}

/**
 * `enabled`, `disabled`, `masked`… or `unknown`. Same exit-code trap as
 * {@link isActive}: systemd answers on stdout and exits non-zero for anything
 * that is not enabled.
 */
export async function isEnabled(unit: string): Promise<string> {
  return run("systemctl", ["is-enabled", unit], {
    timeoutMs: 10_000,
    loggableArgs: ["is-enabled", unit],
    allowedExitCodes: ANSWERED_BY_EXIT_CODE,
  })
    .then(({ stdout }) => stdout.trim() || "unknown")
    .catch((error: unknown) => {
      const stdout = (error as { stdout?: string })?.stdout;
      if (typeof stdout === "string" && stdout.trim()) return stdout.trim();
      return "unknown";
    });
}

/**
 * Units matching a glob, restricted to the given states. Returns the raw lines,
 * empty when nothing matches — used to refuse a second update while one runs.
 */
export async function listUnits(pattern: string, states: readonly string[]): Promise<string[]> {
  const args = ["list-units", `--state=${states.join(",")}`, "--no-pager", "--no-legend", pattern];
  const { stdout } = await run("systemctl", args, { timeoutMs: 15_000, loggableArgs: args });
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Clears a unit's failed state so the next start is not refused. */
export async function resetFailed(unit: string) {
  await run("systemctl", ["reset-failed", unit], {
    timeoutMs: 10_000,
    loggableArgs: ["reset-failed", unit],
  });
}

export async function reload() {
  await run("systemctl", ["daemon-reload"], { loggableArgs: ["daemon-reload"] });
}

export async function enable(unit: string, { now = false } = {}) {
  const args = now ? ["enable", "--now", unit] : ["enable", unit];
  await run("systemctl", args, { loggableArgs: args });
}

export async function disable(unit: string, { now = false } = {}) {
  const args = now ? ["disable", "--now", unit] : ["disable", unit];
  await run("systemctl", args, { loggableArgs: args });
}

export type TransientUnitOptions = {
  /** Unit name, without `.service`. Must be unique; callers append a timestamp. */
  unit: string;
  description?: string;
  env?: Record<string, string>;
  /** Raw `--property=` values, e.g. `KillMode=control-group`. */
  properties?: readonly string[];
  /** Extra systemd-run flags, e.g. `--quiet`, `--collect`. */
  flags?: readonly string[];
};

function baseArgs({ unit, description, env, properties, flags }: TransientUnitOptions) {
  return [
    `--unit=${unit}`,
    ...(description ? [`--description=${description}`] : []),
    "--no-block",
    ...(flags ?? []).filter((flag) => flag !== "--no-block"),
    ...(properties ?? []).map((property) => `--property=${property}`),
    ...Object.entries(env ?? {}).flatMap(([key, value]) => ["--setenv", `${key}=${value}`]),
  ];
}

/**
 * Why any of this runs in a transient unit rather than a detached child.
 *
 * `spawn(..., { detached: true })` is not enough, and the difference is not
 * obvious: detached gives the child its own process *group*, but it stays in
 * this service's cgroup, and systemd's default `KillMode=control-group` takes
 * the whole cgroup down when the service stops. The restore flow stops
 * home-server as one of its own steps — a detached child would kill itself
 * halfway through and leave the machine between two states.
 *
 * A transient unit gets its own cgroup and survives.
 */
export async function runDetachedScript(
  scriptPath: string,
  options: TransientUnitOptions,
) {
  // The env carries DATABASE_URL, so only the unit name is loggable.
  await run("systemd-run", [...baseArgs(options), "bash", scriptPath], {
    loggableArgs: [`--unit=${options.unit}`, "--no-block", "bash", scriptPath],
  });
}

/**
 * The same, for a command built in code rather than a file on disk.
 *
 * Prefer {@link runDetachedScript} where there is a script to point at: a
 * filename can be reviewed once and reasoned about, where a string assembled at
 * runtime has to be re-read every time it changes.
 */
export async function runDetachedCommand(
  command: string,
  options: TransientUnitOptions,
) {
  await run("systemd-run", [...baseArgs(options), "bash", "-lc", command], {
    loggableArgs: [`--unit=${options.unit}`, "--no-block"],
  });
}

/** Whether systemd is here at all — several features degrade without it. */
export async function isAvailable(): Promise<boolean> {
  return run("systemd-run", ["--version"], { timeoutMs: 5_000 })
    .then(() => true)
    .catch(() => false);
}
