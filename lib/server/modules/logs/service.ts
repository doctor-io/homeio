import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { serverEnv } from "@/lib/server/env";
import type { StructuredLogEntry } from "@/lib/shared/contracts/logging";
import { run } from "@/lib/server/platform/process";


export type LogSource = "homeio" | "system" | "docker";

export type RawLogEntry = {
  raw: string;
  timestamp?: string;
  level?: StructuredLogEntry["level"];
  layer?: string;
  action?: string;
  message?: string;
  status?: string;
  error?: { message: string };
};

export type LogsResult = {
  entries: RawLogEntry[];
  source: LogSource;
  truncated: boolean;
  error?: string;
};

const MAX_LINES = 500;

function getLogFilePath(): string {
  const filePath = serverEnv.LOG_FILE_PATH || "logs/home-server.log";
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

async function readTailLines(
  filePath: string,
  maxLines: number,
): Promise<string[]> {
  try {
    await stat(filePath);
  } catch {
    return [];
  }

  return new Promise((resolve, reject) => {
    const lines: string[] = [];

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (line.trim()) {
        lines.push(line);
      }
    });

    rl.on("close", () => {
      // Return last maxLines
      resolve(lines.slice(-maxLines));
    });

    rl.on("error", reject);
  });
}

function parseHomeioLine(raw: string): RawLogEntry {
  try {
    const parsed = JSON.parse(raw) as Partial<StructuredLogEntry>;
    return {
      raw,
      timestamp: parsed.timestamp,
      level: parsed.level,
      layer: parsed.layer,
      action: parsed.action,
      message: parsed.message,
      status: parsed.status,
      error: parsed.error
        ? { message: parsed.error.message }
        : undefined,
    };
  } catch {
    return { raw };
  }
}

export async function getHomeioLogs(): Promise<LogsResult> {
  const filePath = getLogFilePath();

  try {
    const lines = await readTailLines(filePath, MAX_LINES);
    const total = lines.length;

    return {
      entries: lines.map(parseHomeioLine),
      source: "homeio",
      truncated: total >= MAX_LINES,
    };
  } catch (error) {
    return {
      entries: [],
      source: "homeio",
      truncated: false,
      error: error instanceof Error ? error.message : "Failed to read logs",
    };
  }
}

async function runJournalctl(unit?: string): Promise<LogsResult> {
  const source: LogSource = unit ? "docker" : "system";
  const args = [
    ...(unit ? ["-u", unit] : []),
    "-n",
    String(MAX_LINES),
    "--no-pager",
    "--output=short-iso",
  ];

  try {
    // Was a shell string with the unit interpolated into it. Nothing
    // user-supplied ever reached it — the route validates `source` against
    // three fixed values — but the shell was only there to fold stderr into
    // stdout, which is free when both come back separately.
    const { stdout, stderr } = await run("journalctl", args, {
      timeoutMs: 8_000,
      loggableArgs: args,
    });

    const lines = `${stdout}${stderr}`
      .split("\n")
      .filter((l) => l.trim())
      .slice(-MAX_LINES);

    return {
      entries: lines.map((raw) => ({ raw })),
      source,
      truncated: lines.length >= MAX_LINES,
    };
  } catch (error) {
    // journalctl may not be available (dev environment)
    const message =
      error instanceof Error ? error.message : "journalctl unavailable";
    return {
      entries: [],
      source,
      truncated: false,
      error: message.includes("not found") || message.includes("No such file")
        ? "journalctl is not available in this environment"
        : message,
    };
  }
}

export async function getSystemLogs(): Promise<LogsResult> {
  return runJournalctl();
}

export async function getDockerLogs(): Promise<LogsResult> {
  return runJournalctl("docker");
}
