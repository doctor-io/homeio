import { describe, expect, it } from "vitest";

import {
  detectLogLevel,
  parseDockerLogLine,
  stripAnsi,
} from "@/lib/server/modules/docker/logs";

// Written with String.fromCharCode so the escape byte stays visible in the
// source rather than hiding inside a string literal.
const ESC = String.fromCharCode(27);

// A real line from Uptime Kuma, which colours every field it prints.
const COLOURED_WARNING =
  `${ESC}[36m2026-09-12T10:19:08+02:00${ESC}[0m ` +
  `[${ESC}[38;5;119mMONITOR${ESC}[0m] ` +
  `${ESC}[33mWARN:${ESC}[0m Monitor #4 'Music': Failing: getaddrinfo ENOTFOUND`;

describe("stripAnsi", () => {
  it("removes the colour sequences containers actually emit", () => {
    const cleaned = stripAnsi(COLOURED_WARNING);

    expect(cleaned).not.toContain(ESC);
    expect(cleaned).toBe(
      "2026-09-12T10:19:08+02:00 [MONITOR] WARN: Monitor #4 'Music': Failing: getaddrinfo ENOTFOUND",
    );
  });

  it("leaves a line without escapes untouched", () => {
    const plain = "2026-09-12T10:19:08Z [MONITOR] WARN: nothing to strip";
    expect(stripAnsi(plain)).toBe(plain);
  });
});

describe("detectLogLevel", () => {
  it("reads the level through the colour codes wrapping it", () => {
    // `\x1b[33mWARN` puts a word character immediately before WARN, so the
    // \bWARN\b boundary never matched: the level came back null and the viewer
    // fell through to its stderr badge, labelling every warning an error.
    expect(detectLogLevel(COLOURED_WARNING)).toBe("WARN");
  });

  it("still classifies uncoloured lines", () => {
    expect(detectLogLevel("2026-01-01 ERROR something broke")).toBe("ERROR");
    expect(detectLogLevel("2026-01-01 INFO started")).toBe("INFO");
    expect(detectLogLevel("2026-01-01 DEBUG verbose")).toBe("DEBUG");
    expect(detectLogLevel("2026-01-01 nothing in particular")).toBeNull();
  });
});

describe("parseDockerLogLine", () => {
  it("hands the viewer a message with no escape sequences in it", () => {
    const parsed = parseDockerLogLine(
      `2026-09-12T10:19:08.000000000Z ${COLOURED_WARNING}`,
      "stderr",
    );

    expect(parsed.timestamp).toBe("2026-09-12T10:19:08.000000000Z");
    expect(parsed.stream).toBe("stderr");
    expect(parsed.message).not.toContain(ESC);
    expect(parsed.message).toContain("WARN:");
  });

  it("strips escapes from a line carrying no docker timestamp", () => {
    const parsed = parseDockerLogLine(COLOURED_WARNING, "stdout");
    expect(parsed.message).not.toContain(ESC);
  });
});
