import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: (_file: string, _args: string[], _options: unknown, callback: unknown) => {
    execFileMock(_file, _args);
    (callback as (e: null, o: string, s: string) => void)(null, "", "");
  },
}));

vi.mock("@/lib/server/logging/logger", () => ({
  logServerAction: vi.fn(),
  withServerTiming: async <T>(_meta: unknown, fn: () => Promise<T>) => fn(),
}));

import {
  InvalidDeviceError,
  createPartition,
  createPartitionTable,
  mount,
  powerOff,
  removePartition,
  wipeSignatures,
} from "@/lib/server/platform/storage";

describe("storage device validation", () => {
  beforeEach(() => execFileMock.mockClear());

  // Device paths arrive from request bodies and end up as arguments to
  // `wipefs --all --force`. execFile takes no shell, so there is no injection
  // through metacharacters — but nothing else stops a path that is not a
  // block device, and nothing downstream will ask twice.
  const rejected = [
    "/dev/../etc/passwd",
    "/dev/sda; rm -rf /",
    "/etc/passwd",
    "sda",
    "",
    "/dev/",
    "/dev/disk/by-uuid/1234",
  ];

  for (const device of rejected) {
    it(`refuses to wipe ${JSON.stringify(device)}`, async () => {
      await expect(wipeSignatures(device)).rejects.toBeInstanceOf(InvalidDeviceError);
      expect(execFileMock).not.toHaveBeenCalled();
    });
  }

  const accepted = ["/dev/sda", "/dev/sdb1", "/dev/nvme0n1", "/dev/nvme0n1p2", "/dev/mmcblk0p1"];

  for (const device of accepted) {
    it(`accepts ${device}`, async () => {
      await wipeSignatures(device);
      expect(execFileMock).toHaveBeenCalledWith("wipefs", ["--all", "--force", device]);
    });
  }

  it("guards every destructive entry point, not only the wipe", async () => {
    const bad = "/dev/../etc";

    await expect(createPartitionTable(bad)).rejects.toBeInstanceOf(InvalidDeviceError);
    await expect(createPartition(bad, "0%", "100%")).rejects.toBeInstanceOf(InvalidDeviceError);
    await expect(removePartition(bad, 1)).rejects.toBeInstanceOf(InvalidDeviceError);
    await expect(mount(bad, "/mnt/x")).rejects.toBeInstanceOf(InvalidDeviceError);
    await expect(powerOff(bad)).rejects.toBeInstanceOf(InvalidDeviceError);

    expect(execFileMock).not.toHaveBeenCalled();
  });
});
