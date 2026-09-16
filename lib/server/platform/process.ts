import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logServerAction } from "@/lib/server/logging/logger";

const execFileAsync = promisify(execFile);

/**
 * The one place in the server that starts a process.
 *
 * Before this existed, nineteen files reached for `execFile` on their own and
 * between them launched twenty different binaries. Nothing listed what the app
 * could run, so nothing could be reviewed: a feature that wanted to shell out
 * just did, and `disks/wipe` sat at the same distance from the operating system
 * as the weather widget.
 *
 * Feature modules call the small wrappers beside this file — `systemd.ts`,
 * `docker.ts` — and those call `run`. `platform-boundary.test.ts` keeps it that
 * way: `node:child_process` is importable here and nowhere else under
 * `lib/server`.
 */

/** Everything the server is allowed to execute, and why. */
export const ALLOWED_BINARIES = {
  systemctl: "service lifecycle",
  "systemd-run": "detached units that outlive the request that scheduled them",
  docker: "container and compose operations",
  git: "app store catalog checkouts",
  tar: "backup archives",
  unzip: "app store archive extraction",
  mount: "removable and network storage",
  umount: "removable and network storage",
  lsblk: "disk inventory",
  parted: "partitioning",
  wipefs: "erasing a disk the operator asked to erase",
  // One entry per filesystem rather than a pattern: the point of the list is
  // that a reader can see everything the app can run, and "mkfs.*" hides how
  // many of those there are and what they do.
  "mkfs.ext4": "formatting a partition as ext4",
  "mkfs.ext3": "formatting a partition as ext3",
  "mkfs.btrfs": "formatting a partition as btrfs",
  "mkfs.xfs": "formatting a partition as xfs",
  "mkfs.ntfs": "formatting a partition as ntfs",
  "mkfs.vfat": "formatting a partition as vfat",
  "mkfs.exfat": "formatting a partition as exfat",
  udisksctl: "desktop-session disk operations",
  tailscale: "tailnet status and enrolment",
  ufw: "firewall rules",
  timedatectl: "reading and setting the system timezone",
  hostnamectl: "reading and setting the system hostname",
  hostname: "reading the hostname where hostnamectl is absent",
  which: "locating a binary before depending on it",
  pg_dump: "database backups",
  psql: "database restores",
  bash: "restore and factory-reset scripts, which are shell by nature",
  sh: "vendor install scripts",
} as const;

export type AllowedBinary = keyof typeof ALLOWED_BINARIES;

export type RunOptions = {
  cwd?: string;
  /** Defaults to 60s. A command with no ceiling is a hung request. */
  timeoutMs?: number;
  /** Bytes of stdout to buffer. Defaults to 1 MB. */
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Arguments safe to write to the log. Anything not listed is replaced, so a
   * connector token pasted into an argument does not end up in the journal.
   */
  loggableArgs?: readonly string[];
};

export type RunResult = {
  stdout: string;
  stderr: string;
};

export class ProcessError extends Error {
  readonly binary: AllowedBinary;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(
    binary: AllowedBinary,
    cause: NodeJS.ErrnoException & { code?: number | string; stderr?: string; killed?: boolean; signal?: string },
  ) {
    const timedOut = cause.killed === true || cause.signal === "SIGTERM" || cause.code === "ETIMEDOUT";
    const stderr = typeof cause.stderr === "string" ? cause.stderr.trim() : "";

    super(
      timedOut
        ? `${binary} timed out`
        : stderr || cause.message || `${binary} failed`,
    );

    this.name = "ProcessError";
    this.binary = binary;
    this.exitCode = typeof cause.code === "number" ? cause.code : null;
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

function redact(args: readonly string[], loggable?: readonly string[]) {
  if (!loggable) return args.map(() => "…");
  return args.map((arg) => (loggable.includes(arg) ? arg : "…"));
}

/**
 * Runs an allowed binary and returns its output.
 *
 * Throws {@link ProcessError} on a non-zero exit or a timeout — with the
 * child's stderr as the message, because the shape of the failure is what the
 * caller needs to report and the alternative is "command failed".
 */
export async function run(
  binary: AllowedBinary,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  if (!(binary in ALLOWED_BINARIES)) {
    // Unreachable through the type system; reachable through a cast, which is
    // exactly the case worth refusing loudly.
    throw new Error(`Refusing to run "${binary}": not in the platform allowlist`);
  }

  const timeoutMs = options.timeoutMs ?? 60_000;

  try {
    // `execFile` normally resolves with both streams. A command that writes
    // nothing — or a stub standing in for one — can leave the result, or
    // either stream, undefined. The caller should get empty strings rather
    // than a crash inside the wrapper that exists to make this safer.
    const result = await execFileAsync(binary, [...args], {
      cwd: options.cwd,
      timeout: timeoutMs,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      env: options.env,
    });

    return {
      stdout: result?.stdout?.toString() ?? "",
      stderr: result?.stderr?.toString() ?? "",
    };
  } catch (cause) {
    const error = new ProcessError(binary, cause as NodeJS.ErrnoException);

    logServerAction({
      level: "error",
      layer: "system",
      action: "platform.run",
      status: "error",
      meta: {
        binary,
        args: redact(args, options.loggableArgs),
        timedOut: error.timedOut,
        exitCode: error.exitCode,
      },
      error,
    });

    throw error;
  }
}

/**
 * Whether a binary is present, without caring what it prints.
 *
 * Several features degrade rather than fail when a tool is missing, and they
 * were each calling `which` and interpreting the throw. This gives them one
 * answer to read.
 */
export async function isAvailable(binary: AllowedBinary): Promise<boolean> {
  return run("which", [binary], { timeoutMs: 5_000 })
    .then(({ stdout }) => stdout.trim().length > 0)
    .catch(() => false);
}
