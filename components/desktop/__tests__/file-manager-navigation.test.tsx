/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileManagerElement,
  mockDirectory,
  mockUseFilesDirectory,
  mockUseCurrentUser,
  mockUseMoveToTrash,
  mockUseNetworkShares,
  mockUseSearchFiles,
  renderFileManager,
  resetFileManagerMocks,
} from "./file-manager-test-utils";

describe("FileManager navigation", () => {
  beforeEach(resetFileManagerMocks);

  it("navigates to /Shared from sidebar Shared button", async () => {
    await renderFileManager();
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));

    await waitFor(() => {
      const calls = mockUseFilesDirectory.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toEqual(["Shared"]);
    });
  });

  it("shows network hosts under Locations", () => {
    mockUseNetworkShares.mockReturnValue({
      data: [
        {
          id: "share-1",
          host: "nastabib.local",
          share: "Media",
          username: "user",
          mountPath: "Network/nastabib.local/Media",
          isMounted: true,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });

    return renderFileManager().then(() => {
      expect(screen.getByRole("button", { name: "nastabib.local" })).toBeTruthy();
    });
  });

  it("hides network storage in demo mode", () => {
    mockUseCurrentUser.mockReturnValue({
      data: {
        id: "demo-user",
        username: "homeio",
        isDemoMode: true,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUseNetworkShares.mockReturnValue({
      data: [
        {
          id: "share-1",
          host: "nastabib.local",
          share: "Media",
          username: "user",
          mountPath: "Network/nastabib.local/Media",
          isMounted: true,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });

    return renderFileManager().then(() => {
      expect(screen.queryByRole("button", { name: "nastabib.local" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Add location" })).toBeNull();
    });
  });

  it("navigates Apps favorite to /AppData", async () => {
    await renderFileManager();
    fireEvent.click(screen.getByRole("button", { name: "Apps" }));

    await waitFor(() => {
      const calls = mockUseFilesDirectory.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toEqual(["AppData"]);
    });
  });

  it("renders real storage usage text in sidebar", () => {
    return renderFileManager().then(() => {
      expect(screen.getByText("1.8 TB / 4 TB")).toBeTruthy();
    });
  });

  it("moves only the selected paths to Trash when mobile rows have the same name", async () => {
    const originalMatchMedia = window.matchMedia;
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...originalMatchMedia(query),
      matches: query.includes("pointer: coarse"),
    }));
    const moveToTrash = vi.fn().mockResolvedValue({ trashPath: "Trash/file" });
    mockUseMoveToTrash.mockReturnValue({ mutateAsync: moveToTrash, isPending: false });
    mockUseSearchFiles.mockReturnValue(mockDirectory([
      { name: "notes.txt", path: "A/notes.txt", type: "file" },
      { name: "notes.txt", path: "B/notes.txt", type: "file" },
      { name: "notes.txt", path: "C/notes.txt", type: "file" },
    ]));

    try {
      await renderFileManager();
      fireEvent.click(screen.getByRole("button", { name: "Search everywhere" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Search files" }), { target: { value: "notes" } });
      const secondNotes = await screen.findByRole("button", { name: "notes.txt, B" });
      const firstNotes = screen.getByRole("button", { name: "notes.txt, A" });
      const thirdNotes = screen.getByRole("button", { name: "notes.txt, C" });
      expect(secondNotes.textContent).toContain("B");
      fireEvent.click(screen.getByRole("button", { name: "Select" }));
      fireEvent.click(secondNotes);
      expect(firstNotes.getAttribute("aria-pressed")).toBe("false");
      expect(secondNotes.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(thirdNotes);
      fireEvent.click(screen.getByRole("button", { name: "Trash selected" }));

      await waitFor(() => expect(moveToTrash.mock.calls).toEqual([
        [{ path: "B/notes.txt" }],
        [{ path: "C/notes.txt" }],
      ]));
    } finally {
      media.mockRestore();
    }
  });

  it("ignores Delete while Files is hidden or its last selection is deselected", async () => {
    const moveToTrash = vi.fn().mockResolvedValue({ trashPath: "Trash/notes.txt" });
    mockUseMoveToTrash.mockReturnValue({ mutateAsync: moveToTrash, isPending: false });
    mockUseFilesDirectory.mockReturnValue(mockDirectory([{ name: "notes.txt", path: "notes.txt", type: "file" }]));

    const view = render(fileManagerElement());
    const notes = screen.getByRole("button", { name: "notes.txt" });
    fireEvent.click(notes);
    view.rerender(fileManagerElement(false));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(moveToTrash).not.toHaveBeenCalled();

    view.rerender(fileManagerElement());
    fireEvent.click(notes, { ctrlKey: true });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(moveToTrash).not.toHaveBeenCalled();

    fireEvent.click(notes);
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(moveToTrash).toHaveBeenCalledExactlyOnceWith({ path: "notes.txt" }));
  });

  it("shows Empty Trash in header and deletes all trash entries", async () => {
    mockUseFilesDirectory.mockImplementation((pathSegments: string[]) => {
      if (pathSegments[0] === "Trash") {
        return mockDirectory([
          { name: "a.txt", path: "Trash/a.txt", type: "file" },
          { name: "b.txt", path: "Trash/b.txt", type: "file" },
        ]);
      }
      return mockDirectory([]);
    });

    await renderFileManager();
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    fireEvent.click(await screen.findByRole("button", { name: /empty trash/i }));
    fireEvent.click(
      await screen.findAllByRole("button", { name: /empty trash/i }).then((buttons) => buttons.at(-1)!),
    );

    await waitFor(() => {
      expect(screen.getByText(/trash emptied/i)).toBeTruthy();
    });
  });
});
