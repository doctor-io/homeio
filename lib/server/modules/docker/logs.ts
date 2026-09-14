import "server-only";

import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import { serverEnv } from "@/lib/server/env";

export type DockerLogLine = {
  timestamp: string;
  stream: "stdout" | "stderr";
  message: string;
};

/**
 * Opens a streaming HTTP connection to the Docker socket for container logs.
 * Returns the raw IncomingMessage — caller is responsible for destroying it.
 *
 * The response body uses Docker's multiplexed stream format:
 *   byte 0:   stream type (1 = stdout, 2 = stderr)
 *   bytes 1-3: reserved zeros
 *   bytes 4-7: big-endian uint32 payload size
 *   then:     payload bytes
 */
export function streamDockerContainerLogs(
  containerName: string,
  tail = 200,
): Promise<IncomingMessage> {
  const path = `/containers/${encodeURIComponent(containerName)}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=${tail}`;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: serverEnv.DOCKER_SOCKET_PATH,
        path,
        method: "GET",
        headers: { Host: "docker" },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () => {
            reject(
              new Error(
                `Docker API error (${res.statusCode}): ${body}`,
              ),
            );
          });
          return;
        }
        resolve(res);
      },
    );

    req.on("error", reject);
    req.end();
  });
}

/**
 * Containers that colour their output — most Node images do, Uptime Kuma
 * among them — emit SGR escape sequences the viewer has no way to render, so
 * they showed up as literal `[36m` and `[38;5;119m` noise wrapped around every
 * field. Worse, the codes glue onto the words: `\x1b[33mWARN:` has no word
 * boundary before WARN, so level detection missed it entirely and the line
 * fell through to the stderr badge, marking warnings as errors.
 *
 * Covers the CSI sequences containers actually produce (colour, cursor) and
 * the two-character escapes; anything else is left alone rather than guessed at.
 */
 
const ANSI_ESCAPE_PATTERN = /\u001B(?:\[[0-?]*[ -\/]*[@-~]|[@-Z\\-_])/g;

export function stripAnsi(value: string) {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

/**
 * Parses a single raw log line produced by Docker's multiplexed stream.
 * Docker prepends RFC3339Nano timestamps when `timestamps=1` is set:
 *   "2024-01-01T00:00:00.000000000Z actual log message here"
 */
export function parseDockerLogLine(
  raw: string,
  stream: "stdout" | "stderr",
): DockerLogLine {
  // Timestamp is the first space-delimited token when timestamps=1
  const spaceIdx = raw.indexOf(" ");
  if (spaceIdx > 0) {
    const ts = raw.slice(0, spaceIdx);
    const msg = raw.slice(spaceIdx + 1);
    // Validate it looks like an ISO timestamp
    if (ts.includes("T") && ts.includes("Z")) {
      return { timestamp: ts, stream, message: stripAnsi(msg) };
    }
  }
  return { timestamp: new Date().toISOString(), stream, message: stripAnsi(raw) };
}

/**
 * Detects a log level from a log message string.
 */
export function detectLogLevel(
  message: string,
): "ERROR" | "WARN" | "INFO" | "DEBUG" | null {
  const upper = stripAnsi(message).toUpperCase();
  if (/\bERROR\b|\bERR\b|\bFATAL\b|\bCRIT\b/.test(upper)) return "ERROR";
  if (/\bWARN\b|\bWARNING\b/.test(upper)) return "WARN";
  if (/\bINFO\b/.test(upper)) return "INFO";
  if (/\bDEBUG\b|\bTRACE\b/.test(upper)) return "DEBUG";
  return null;
}

/**
 * Reads Docker's multiplexed binary frame header and emits complete log lines.
 * Calls `onLine` for each decoded line.
 */
export function createDockerLogParser(
  onLine: (line: DockerLogLine) => void,
): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0);

  return function processChunk(chunk: Buffer) {
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 8) {
      const streamType = buf[0];
      const frameSize = buf.readUInt32BE(4);

      if (buf.length < 8 + frameSize) break;

      const payload = buf.slice(8, 8 + frameSize).toString("utf8");
      buf = buf.slice(8 + frameSize);

      const stream: "stdout" | "stderr" =
        streamType === 2 ? "stderr" : "stdout";

      // A single frame may contain multiple newline-delimited lines
      const lines = payload.split("\n");
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed.length === 0) continue;
        onLine(parseDockerLogLine(trimmed, stream));
      }
    }
  };
}
