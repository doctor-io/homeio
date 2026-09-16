import { describe, expect, it } from "vitest";

import { ProcessError } from "@/lib/server/platform/process";
import {
  DiskRequestError,
  describeDiskFailure,
} from "@/lib/server/modules/system/disk-service";

/**
 * Who is at fault, and what the user is told.
 *
 * Found on the real server: formatting through the UI answered
 * `500 "Failed to format partition"`, and the journal knew perfectly well that
 * the device did not exist. Five of the six disk routes threw that same fixed
 * sentence away every reason they had; the sixth sorted them by matching the
 * first two words of the message.
 */

function processFailure(stderr: string) {
  const cause = new Error("Command failed") as NodeJS.ErrnoException & {
    code?: number;
    stderr?: string;
  };
  cause.code = 1;
  cause.stderr = stderr;
  return new ProcessError("mkfs.ext4", cause);
}

describe("describeDiskFailure", () => {
  it("calls a bad request a bad request", () => {
    const failure = describeDiskFailure(
      new DiskRequestError("Invalid partition device path"),
      "Failed to format partition",
    );

    expect(failure).toEqual({ status: 400, message: "Invalid partition device path" });
  });

  it("does not sort errors by how their message begins", () => {
    // The old rule. A refusal worded any other way was a 500, and renaming a
    // message was enough to change an HTTP status somewhere else in the file.
    const failure = describeDiskFailure(
      new Error("Cannot modify active mounted device"),
      "Failed to wipe disk",
    );

    expect(failure.status).toBe(500);
  });

  it("repeats the tool's own words rather than a fixed sentence", () => {
    const failure = describeDiskFailure(
      processFailure(
        "mke2fs 1.47.0 (5-Feb-2023)\nThe file /dev/nvme0n1p1 does not exist and no size was specified.",
      ),
      "Failed to format partition",
    );

    // The last line, not the first: mkfs opens with its version banner, which
    // is exactly the useless half.
    expect(failure).toEqual({
      status: 500,
      message: "The file /dev/nvme0n1p1 does not exist and no size was specified.",
    });
  });

  it("keeps a diagnosis the wrapper made itself", () => {
    const missing = new Error("spawn mkfs.ext4 ENOENT") as NodeJS.ErrnoException;
    missing.code = "ENOENT";

    expect(describeDiskFailure(new ProcessError("mkfs.ext4", missing), "Failed to format")).toEqual({
      status: 500,
      message: "mkfs.ext4 is not available on this host",
    });
  });

  it("falls back when the tool said nothing useful", () => {
    // Node's own "Command failed" says less than naming the operation does.
    expect(describeDiskFailure(processFailure(""), "Failed to mount partition")).toEqual({
      status: 500,
      message: "Failed to mount partition",
    });
    expect(describeDiskFailure("not an error at all", "Failed to mount partition")).toEqual({
      status: 500,
      message: "Failed to mount partition",
    });
  });
});
