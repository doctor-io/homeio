import type * as NodeFsPromises from "node:fs/promises";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { statMock, openMock, listUnitsMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  openMock: vi.fn(),
  listUnitsMock: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFsPromises>();
  return { ...original, stat: statMock, open: openMock };
});

vi.mock("@/lib/server/platform/systemd", () => ({
  listUnits: listUnitsMock,
}));

import { readUpdateLog } from "@/lib/server/modules/system/update-service";

/** Serve `content` as the log file, the way a real read would see it. */
function serveLog(content: string) {
  const buffer = Buffer.from(content, "utf8");
  statMock.mockResolvedValue({ size: buffer.length });
  openMock.mockResolvedValue({
    read: async (target: Buffer, offset: number, length: number, position: number) => {
      const copied = buffer.copy(target, offset, position, position + length);
      return { bytesRead: copied };
    },
    close: async () => undefined,
  });
  return buffer.length;
}

const MARKER = "=== homeio update homeio-self-update-1700000000000 ===";

describe("readUpdateLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUnitsMock.mockResolvedValue([]);
    delete process.env.HOMEIO_CONTAINER;
  });

  afterEach(() => {
    delete process.env.HOMEIO_CONTAINER;
  });

  it("says why there is nothing to show in a container, rather than showing an empty log", async () => {
    process.env.HOMEIO_CONTAINER = "true";

    const result = await readUpdateLog();

    expect(result.available).toBe(false);
    expect(result.lines).toEqual([]);
    expect(result.unavailableReason).toContain("docker compose");
  });

  it("says so when no update has ever run", async () => {
    statMock.mockRejectedValue(new Error("ENOENT"));

    const result = await readUpdateLog();

    expect(result.available).toBe(false);
    expect(result.unavailableReason).toContain("No update");
  });

  it("starts at the current run, not at every update the machine has done", async () => {
    // The updater appends, so the file holds older runs too. Without the marker
    // the pane would replay them as though they were happening now.
    serveLog(
      [
        "=== homeio update homeio-self-update-1600000000000 ===",
        "an update from last month",
        MARKER,
        "Pulling latest changes...",
        "Installing npm dependencies...",
        "",
      ].join("\n"),
    );

    const result = await readUpdateLog();

    expect(result.lines).toEqual([
      "Pulling latest changes...",
      "Installing npm dependencies...",
    ]);
    expect(result.available).toBe(true);
  });

  it("returns only what was appended since the offset the caller held", async () => {
    const first = "line one\nline two\n";
    const size = serveLog(`${first}line three\n`);

    const result = await readUpdateLog(first.length);

    expect(result.lines).toEqual(["line three"]);
    expect(result.nextOffset).toBe(size);
  });

  it("keeps the offset the caller should send next", async () => {
    const size = serveLog(`${MARKER}\nonly line\n`);

    const result = await readUpdateLog();

    expect(result.nextOffset).toBe(size);
  });

  it("starts over when the log shrank under a held offset", async () => {
    // Rotation or truncation: the held position now points into a different
    // file, so reading from it would return whatever happens to be there.
    serveLog(`${MARKER}\nfresh line\n`);

    const result = await readUpdateLog(999_999);

    expect(result.lines).toEqual(["fresh line"]);
  });

  it("reports an update that is still under way", async () => {
    listUnitsMock.mockResolvedValue(["homeio-self-update-1700000000000.service loaded active running"]);
    serveLog(`${MARKER}\nworking\n`);

    await expect(readUpdateLog()).resolves.toMatchObject({ running: true });
  });

  it("treats systemctl being unavailable as 'not running' rather than failing the read", async () => {
    listUnitsMock.mockRejectedValue(new Error("systemctl: not found"));
    serveLog(`${MARKER}\nworking\n`);

    const result = await readUpdateLog();

    expect(result.running).toBe(false);
    expect(result.lines).toEqual(["working"]);
  });
});
