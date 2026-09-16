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
  mountpoint: "asking whether a path is already a mount",
  net: "Samba usershare management",
  smbclient: "listing what an SMB server offers",
  "avahi-browse": "discovering shares advertised on the local network",
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
  bash: "restore and factory-reset scripts, which are shell by nature",
  sh: "vendor install scripts",
} as const;

/**
 * What this list does not cover, said plainly.
 *
 * `bash` and `sh` are on it, and anything they are handed runs outside every
 * guarantee above. The restore script alone reaches psql, tar, find and rm —
 * none of which appear here, because Node never spawns them. The allowlist
 * governs what this process starts, not what those processes go on to start.
 *
 * That is why the shell commands in backup-service are built in code, from
 * values that never came off a request, and escaped with `shellEscape`. The
 * boundary for them is the code that writes the string, not this file. Adding
 * a shell command that interpolates user input would step around everything
 * here without tripping a single test.
 */

export type AllowedBinary = keyof typeof ALLOWED_BINARIES;

export type RunOptions = {
  cwd?: string;
  /** Defaults to 60s. A command with no ceiling is a hung request. */
  timeoutMs?: number;
  /** Bytes of stdout to buffer. Defaults to 1 MB. */
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Exit codes to treat as success, beyond 0. `unzip` answers 1 for "extracted,
   * with warnings", which some callers accept and others do not — so it is the
   * caller that says, rather than the wrapper deciding for everyone.
   */
  allowedExitCodes?: readonly number[];
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
  /**
   * The system error code — `ENOENT` when the binary is not installed,
   * `EACCES` when it cannot be run. Several features degrade rather than fail
   * when a tool is absent, and this is how they tell the difference between
   * "not here" and "here and unhappy". Dropping it, as an earlier version of
   * this class did, turns a missing command into a generic failure.
   */
  readonly code: string | null;
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
    this.code = typeof cause.code === "string" ? cause.code : null;
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

    // `promisify(execFile)` normally resolves with `{ stdout, stderr }`,
    // through a custom symbol on the real function. Replace child_process and
    // that symbol goes with it, leaving plain promisify semantics: the first
    // value after the error, which is stdout on its own. The previous
    // hand-rolled wrappers each carried this branch; it belongs here now.
    if (typeof result === "string" || Buffer.isBuffer(result)) {
      return { stdout: result.toString(), stderr: "" };
    }

    return {
      stdout: result?.stdout?.toString() ?? "",
      stderr: result?.stderr?.toString() ?? "",
    };
  } catch (cause) {
    const error = new ProcessError(binary, cause as NodeJS.ErrnoException);

    if (
      error.exitCode !== null &&
      options.allowedExitCodes?.includes(error.exitCode) &&
      !error.timedOut
    ) {
      const partial = cause as { stdout?: string; stderr?: string };
      return {
        stdout: partial?.stdout?.toString() ?? "",
        stderr: partial?.stderr?.toString() ?? "",
      };
    }

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
