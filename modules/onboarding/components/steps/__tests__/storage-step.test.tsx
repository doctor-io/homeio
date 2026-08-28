/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageStep } from "@/modules/onboarding/components/steps/storage-step";

const DISKS = {
  data: {
    disks: [
      {
        name: "sda",
        device: "/dev/sda",
        model: "Samsung SSD 870",
        vendor: null,
        serial: null,
        sizeBytes: 2_000_398_934_016,
        mediaType: "ssd",
        transport: "sata",
        isRemovable: false,
        partitions: [
          {
            name: "sda1",
            device: "/dev/sda1",
            number: 1,
            fstype: "ext4",
            label: null,
            uuid: null,
            sizeBytes: 1_759_218_604_441,
            mountpoint: "/DATA",
            type: "part",
            ro: false,
          },
        ],
      },
      {
        name: "nvme0n1",
        device: "/dev/nvme0n1",
        model: "System disk",
        vendor: null,
        serial: null,
        sizeBytes: 256_060_514_304,
        mediaType: "nvme",
        transport: "nvme",
        isRemovable: false,
        partitions: [
          {
            name: "nvme0n1p2",
            device: "/dev/nvme0n1p2",
            number: 2,
            fstype: "ext4",
            label: null,
            uuid: null,
            sizeBytes: 45_097_156_608,
            mountpoint: "/",
            type: "part",
            ro: false,
          },
          {
            name: "nvme0n1p1",
            device: "/dev/nvme0n1p1",
            number: 1,
            fstype: "vfat",
            label: null,
            uuid: null,
            sizeBytes: 536_870_912,
            mountpoint: null,
            type: "part",
            ro: false,
          },
        ],
      },
    ],
  },
};

function mockDisks(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => payload });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("StorageStep", () => {
  it("lists mounted partitions and hides unmounted ones", async () => {
    mockDisks(DISKS);
    render(<StorageStep value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Samsung SSD 870")).toBeTruthy());
    expect(screen.getByText(/ext4 · 1.6 TB · \/DATA/)).toBeTruthy();
    // The EFI partition has no mountpoint, so it is not a storage choice.
    expect(screen.queryByText(/vfat/)).toBeNull();
  });

  it("reports the chosen mount point", async () => {
    mockDisks(DISKS);
    const onChange = vi.fn();
    render(<StorageStep value={null} onChange={onChange} />);

    await waitFor(() => expect(screen.getByText("Samsung SSD 870")).toBeTruthy());
    fireEvent.click(screen.getByText("Samsung SSD 870"));

    expect(onChange).toHaveBeenCalledWith("/DATA");
  });

  it("warns when the choice is the system partition", async () => {
    mockDisks(DISKS);
    render(<StorageStep value="/" onChange={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/fills the root partition/)).toBeTruthy(),
    );
  });

  it("falls back to a path field when the disk list fails", async () => {
    mockDisks({}, false);
    render(<StorageStep value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("Storage path")).toBeTruthy());
  });

  it("falls back to a path field when no drives are detected", async () => {
    // Docker without host block devices reports an empty list rather than failing.
    mockDisks({ data: { disks: [] } });
    render(<StorageStep value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("Storage path")).toBeTruthy());
    expect(screen.getByText(/normal in Docker without host block devices/)).toBeTruthy();
  });
});
