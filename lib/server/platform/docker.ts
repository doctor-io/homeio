import "server-only";

import { run, type RunOptions, type RunResult } from "@/lib/server/platform/process";

/**
 * The Docker CLI, as the rest of the server is allowed to see it.
 *
 * Most container reads go through the socket API rather than here — listing,
 * inspecting and streaming stats all speak HTTP to `/var/run/docker.sock`. The
 * CLI is for what the socket cannot do on its own: `docker compose`, which is a
 * plugin rather than an API, and `prune`, which is a CLI convenience over a
 * dozen socket calls.
 *
 * That split is worth knowing when a Docker feature misbehaves, because the two
 * paths fail differently. In 1.9 the image shipped without the CLI at all: the
 * socket kept answering, so containers still listed, while every install
 * silently failed. Reading the list proved nothing about being able to act.
 */

/** `docker` with arbitrary arguments. Prefer the named helpers below. */
export function docker(args: readonly string[], options?: RunOptions): Promise<RunResult> {
  return run("docker", args, options);
}

export type ComposeOptions = {
  composePath: string;
  envPath: string;
  /**
   * The compose project name. Not always the directory name and not always the
   * `name:` inside the file — `-p` overrides both, and a row in the database
   * that disagrees with the label on the container means compose quietly finds
   * nothing to act on.
   */
  projectName: string;
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
};

/**
 * `docker compose -f … --env-file … -p … <args>`.
 *
 * The cwd is the stack directory, and it has to exist: Node reports a missing
 * cwd as `spawn docker ENOENT`, which names the binary and sends people looking
 * for a broken Docker install when the truth is that the stack's files are
 * gone. Callers check the compose file before calling.
 */
export function compose(
  { composePath, envPath, projectName, cwd, timeoutMs, maxBuffer }: ComposeOptions,
  args: readonly string[],
): Promise<RunResult> {
  return run(
    "docker",
    ["compose", "-f", composePath, "--env-file", envPath, "-p", projectName, ...args],
    {
      cwd,
      timeoutMs,
      maxBuffer,
      // Paths and the project name are safe to log; a compose file can carry
      // secrets in its environment, so nothing else is.
      loggableArgs: ["compose", "-f", composePath, "-p", projectName, ...args],
    },
  );
}

/** The compose plugin's version, or null when it is not installed. */
export async function composeVersion(): Promise<string | null> {
  return docker(["compose", "version", "--short"], {
    timeoutMs: 10_000,
    loggableArgs: ["compose", "version", "--short"],
  })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
}

export async function removeVolume(name: string) {
  await docker(["volume", "rm", name], { loggableArgs: ["volume", "rm", name] });
}

/**
 * `prune`, which deletes. The arguments are named by the caller and logged in
 * full — this is the one place where knowing exactly what was run matters more
 * than brevity.
 */
export function prune(args: readonly string[], options?: RunOptions): Promise<RunResult> {
  return docker(args, { ...options, loggableArgs: args });
}
