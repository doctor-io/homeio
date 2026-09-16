import "server-only";

import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { z } from "zod";
import { withServerTiming } from "@/lib/server/logging/logger";
import type {
  TerminalExecuteRequest,
  TerminalExecuteResult,
  TerminalOutputLine,
  TerminalServiceErrorCode,
} from "@/lib/shared/contracts/terminal";

const COMMAND_TIMEOUT_MS = 12_000;
const MAX_OUTPUT_BYTES = 128_000;

const executeSchema = z.object({
  command: z.string().trim().min(1).max(1024),
  cwd: z.string().trim().max(1024).optional(),
  history: z.array(z.string().max(1024)).max(200).optional(),
});

const ALLOWED_COMMANDS = new Set([
  "ls",
  "cd",
  "pwd",
  "cat",
  "echo",
  "whoami",
  "hostname",
  "uname",
  "uptime",
  "df",
  "free",
  "docker",
  "ping",
  "ip",
  "date",
  "history",
  "help",
  "clear",
  "exit",
]);

type RequestContext = {
  requestId?: string;
};

type ExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export class TerminalServiceError extends Error {
  readonly code: TerminalServiceErrorCode;
  readonly statusCode: number;

  constructor(
    message: string,
    options?: {
      code?: TerminalServiceErrorCode;
      statusCode?: number;
      cause?: unknown;
    },
  ) {
    super(message, {
      cause: options?.cause,
    });

    this.name = "TerminalServiceError";
    this.code = options?.code ?? "execution_failed";
    this.statusCode = options?.statusCode ?? 500;
  }
}

function tokenizeCommand(command: string) {
  const tokens = command.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g);
  if (!tokens) return [];

  return tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }

    return token;
  });
}

function validateInput(input: unknown) {
  const parsed = executeSchema.safeParse(input);
  if (!parsed.success) {
    throw new TerminalServiceError("Invalid terminal execute payload", {
      code: "invalid_request",
      statusCode: 400,
      cause: parsed.error,
    });
  }

  return parsed.data satisfies TerminalExecuteRequest;
}

function toOutputLine(type: TerminalOutputLine["type"], content: string): TerminalOutputLine {
  return {
    type,
    content,
  };
}

/**
 * Matches ANSI / VT100 escape sequences that programs emit for colours,
 * cursor movement, window titles, etc.  Stripping them keeps the HTTP
 * terminal output readable as plain text.
 *
 * Covers:
 *   CSI sequences  ESC [ … final-byte   (colours, erase, cursor, …)
 *   OSC sequences  ESC ] … BEL          (window title, hyperlinks, …)
 */
const ANSI_ESCAPE_RE =
  /\u001b(?:\[\??[0-9;]*[A-Za-z]|\][^\u0007]*\u0007|[()][AB012]|[<=>])/g;

function trimOutput(content: string) {
  return content
    .replace(ANSI_ESCAPE_RE, "") // strip ANSI escape sequences
    .replace(/\r\n/g, "\n") // normalise Windows CRLF
    .replace(/\r/g, "") // strip bare CR (progress-bar overwrites)
    .trimEnd();
}

function toHomePath(rawPath: string) {
  const home = os.homedir();
  if (rawPath === "~") return home;
  if (rawPath.startsWith("~/")) return path.join(home, rawPath.slice(2));
  return rawPath;
}

async function resolveWorkingDirectory(candidate: string | undefined) {
  const fallback = os.homedir();
  if (!candidate) return fallback;

  const resolved = path.resolve(toHomePath(candidate));

  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      return fallback;
    }

    await access(resolved);
    return resolved;
  } catch {
    return fallback;
  }
}

async function handleCd(currentDirectory: string, target: string | undefined) {
  const nextPath = target ? path.resolve(currentDirectory, toHomePath(target)) : os.homedir();

  try {
    const info = await stat(nextPath);
    if (!info.isDirectory()) {
      return {
        cwd: currentDirectory,
        lines: [
          toOutputLine("error", `cd: ${target ?? ""}: Not a directory`),
        ],
      };
    }

    await access(nextPath);
    return {
      cwd: nextPath,
      lines: [] satisfies TerminalOutputLine[],
    };
  } catch {
    return {
      cwd: currentDirectory,
      lines: [
        toOutputLine(
          "error",
          `cd: ${target ?? ""}: No such file or directory`,
        ),
      ],
    };
  }
}

function renderHistory(history: string[] | undefined) {
  const items = history ?? [];
  if (items.length === 0) {
    return [toOutputLine("info", "No command history yet.")];
  }

  const rendered = items
    .slice(-200)
    .map((command, index) => `${String(index + 1).padStart(4, " ")}  ${command}`)
    .join("\n");

  return [toOutputLine("output", rendered)];
}

function renderHelp() {
  return [
    toOutputLine(
      "info",
      `Supported commands:
  help           Show this help message
  ls [path]      List directory contents
  cd [path]      Change directory
  pwd            Print working directory
  cat <file>     Display file contents
  echo <text>    Print text
  whoami         Print current user
  hostname       Print hostname
  uname -a       Print system information
  uptime         Show system uptime
  df -h          Show disk usage
  free -h        Show memory usage
  docker ...     Run docker commands
  ping <host>    Ping a host
  ip addr        Show network interfaces
  date           Print current date
  history        Show command history
  clear          Clear the terminal

Note: commands run in non-interactive mode with a timeout.`,
    ),
  ];
}

/**
 * Deliberately outside `lib/server/platform`, and listed as an exception in
 * `platform-boundary.test.ts`.
 *
 * Everywhere else in the server, what gets run is decided when the code is
 * written, so an allowlist of binaries is the right guard. Here the whole
 * feature is "run the command the operator typed", and the guard that fits
 * that is ALLOWED_COMMANDS above — checked before this is ever reached.
 * Wrapping it in the platform allowlist as well would mean a second command
 * list that can disagree with the first, and this codebase has already paid
 * for one of those.
 *
 * `shell: false` is the other half: the command and its arguments stay
 * separate, so nothing in an argument can become a command.
 */
function executeExternalCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<ExecutionResult> {
  return new Promise<ExecutionResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 250).unref();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) {
        stdout = `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n\n[output truncated]`;
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT_BYTES) {
        stderr = `${stderr.slice(0, MAX_OUTPUT_BYTES)}\n\n[output truncated]`;
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        exitCode,
        timedOut,
      });
    });
  });
}

export async function executeTerminalCommand(
  input: unknown,
  context?: RequestContext,
): Promise<TerminalExecuteResult> {
  const validated = validateInput(input);

  return withServerTiming(
    {
      layer: "service",
      action: "terminal.execute",
      requestId: context?.requestId,
    },
    async () => {
      const startedAt = performance.now();
      const cwd = await resolveWorkingDirectory(validated.cwd);
      const tokens = tokenizeCommand(validated.command);
      const command = tokens[0];
      const args = tokens.slice(1);

      if (!command) {
        throw new TerminalServiceError("Command cannot be empty", {
          code: "invalid_request",
          statusCode: 400,
        });
      }

      if (!ALLOWED_COMMANDS.has(command)) {
        throw new TerminalServiceError(
          `Command '${command}' is not allowed in this terminal`,
          {
            code: "forbidden_command",
            statusCode: 403,
          },
        );
      }

      if (command === "help") {
        return {
          cwd,
          lines: renderHelp(),
          exitCode: 0,
          durationMs: Number((performance.now() - startedAt).toFixed(2)),
        };
      }

      if (command === "history") {
        return {
          cwd,
          lines: renderHistory(validated.history),
          exitCode: 0,
          durationMs: Number((performance.now() - startedAt).toFixed(2)),
        };
      }

      if (command === "clear") {
        return {
          cwd,
          lines: [toOutputLine("info", "__CLEAR__")],
          exitCode: 0,
          durationMs: Number((performance.now() - startedAt).toFixed(2)),
        };
      }

      if (command === "cd") {
        const next = await handleCd(cwd, args[0]);
        return {
          cwd: next.cwd,
          lines: next.lines,
          exitCode: next.lines.length === 0 ? 0 : 1,
          durationMs: Number((performance.now() - startedAt).toFixed(2)),
        };
      }

      try {
        const result = await executeExternalCommand(command, args, cwd);
        const lines: TerminalOutputLine[] = [];

        if (result.stdout) {
          lines.push(toOutputLine("output", result.stdout));
        }

        if (result.stderr) {
          lines.push(toOutputLine("error", result.stderr));
        }

        if (result.timedOut) {
          lines.push(
            toOutputLine(
              "error",
              `Command timed out after ${COMMAND_TIMEOUT_MS}ms`,
            ),
          );
          throw new TerminalServiceError("Terminal command timed out", {
            code: "timeout",
            statusCode: 408,
          });
        }

        if (result.exitCode !== 0 && !result.stderr) {
          lines.push(
            toOutputLine(
              "error",
              `Command exited with code ${result.exitCode}`,
            ),
          );
        }

        return {
          cwd,
          lines,
          exitCode: result.exitCode,
          durationMs: Number((performance.now() - startedAt).toFixed(2)),
        };
      } catch (error) {
        if (error instanceof TerminalServiceError) {
          throw error;
        }

        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          throw new TerminalServiceError(`Command not found: ${command}`, {
            code: "command_not_found",
            statusCode: 404,
            cause: error,
          });
        }

        throw new TerminalServiceError("Failed to execute terminal command", {
          code: "execution_failed",
          statusCode: 500,
          cause: error,
        });
      }
    },
  );
}
