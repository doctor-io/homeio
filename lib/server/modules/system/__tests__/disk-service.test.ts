import { describe, expect, it, vi, beforeEach } from "vitest";

const { execFileMock, readFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

import { wipeDisk, mountPartition, unmountPartition } from "@/lib/server/modules/system/disk-service";

describe("disk-service safety validations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
    readFileMock.mockReset();
  });

  describe("wipeDisk", () => {
    it("rejects invalid or dangerous device paths", async () => {
      await expect(wipeDisk("/dev/sda; rm -rf /")).rejects.toThrow("Invalid disk device path");
      await expect(wipeDisk("/dev/../etc/passwd")).rejects.toThrow("Invalid disk device path");
      await expect(wipeDisk("sda")).rejects.toThrow("Invalid disk device path");
      await expect(wipeDisk("/dev/sda1")).rejects.toThrow("Invalid disk device path");
    });

    it("rejects wiping a disk containing active mounts in /proc/mounts", async () => {
      readFileMock.mockResolvedValueOnce(
        "/dev/sdb1 /data ext4 rw,relatime 0 0\n" +
        "/dev/sda2 / ext4 rw,relatime 0 0\n"
      );

      await expect(wipeDisk("/dev/sdb")).rejects.toThrow("Cannot modify active mounted device");
    });

    it("rejects wiping a system disk mounted at /", async () => {
      readFileMock.mockResolvedValueOnce(
        "/dev/sda1 /boot/efi vfat rw 0 0\n" +
        "/dev/sda2 / ext4 rw,relatime 0 0\n"
      );

      await expect(wipeDisk("/dev/sda")).rejects.toThrow("Cannot modify system device containing critical mountpoint");
    });
  });

  describe("mountPartition", () => {
    it("rejects invalid partition device paths", async () => {
      await expect(mountPartition("/dev/sda", "/mnt/data"))
        .rejects.toThrow("Invalid partition device path");
      await expect(mountPartition("/dev/sda1; rm -rf /", "/mnt/data"))
        .rejects.toThrow("Invalid partition device path");
    });

    it("rejects mountpoints containing newlines or carriage returns", async () => {
      await expect(mountPartition("/dev/sdb1", "/mnt/data\n/dev/sdc1 /"))
        .rejects.toThrow("Mount point must be a safe, absolute path");
      await expect(mountPartition("/dev/sdb1", "/mnt/data\r\n"))
        .rejects.toThrow("Mount point must be a safe, absolute path");
      await expect(mountPartition("/dev/sdb1", "relative/path"))
        .rejects.toThrow("Mount point must be a safe, absolute path");
    });

    it("rejects dangerous system mountpoints", async () => {
      await expect(mountPartition("/dev/sdb1", "/"))
        .rejects.toThrow("Cannot mount partition over critical system directory: /");
      await expect(mountPartition("/dev/sdb1", "/etc"))
        .rejects.toThrow("Cannot mount partition over critical system directory: /etc");
    });
  });

  describe("unmountPartition", () => {
    it("rejects unmounting root or system directories", async () => {
      await expect(unmountPartition("/")).rejects.toThrow("Cannot unmount critical system directory: /");
      await expect(unmountPartition("/boot")).rejects.toThrow("Cannot unmount critical system directory: /boot");
    });
  });
});
