/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileManagerElement,
  mockDirectory,
  mockUseFileContent,
  mockUseFilesDirectory,
  renderFileManager,
  resetFileManagerMocks,
} from "./file-manager-test-utils";

vi.mock("@/modules/files/components/content/file-manager-editor-pane", () => ({
  MonacoEditorPane: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Editor" value={value} onChange={(event) => onChange(event.target.value)} />,
}));

describe("FileManager open-file dialog", () => {
  beforeEach(resetFileManagerMocks);

  it("opens a file in a dialog overlay instead of replacing the file list", async () => {
    mockUseFilesDirectory.mockReturnValue(mockDirectory([{ name: "notes.txt", path: "notes.txt", type: "file" }]));
    mockUseFileContent.mockImplementation((filePath: string | null) => {
      if (filePath === "notes.txt") {
        return {
          data: {
            root: "/DATA",
            path: "notes.txt",
            name: "notes.txt",
            ext: "txt",
            mode: "text",
            mimeType: "text/plain",
            sizeBytes: 12,
            modifiedAt: "2026-02-27T00:00:00.000Z",
            mtimeMs: 1234,
            content: "hello world",
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      return { data: null, isLoading: false, isError: false, error: null };
    });

    await renderFileManager();
    fireEvent.doubleClick(screen.getByRole("button", { name: "notes.txt" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "notes.txt" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Back to files" })).toBeNull();
  });

  it("hides a portaled editor while inactive and restores it on return", async () => {
    mockUseFilesDirectory.mockReturnValue(mockDirectory([{ name: "notes.txt", path: "notes.txt", type: "file" }]));
    mockUseFileContent.mockImplementation((path: string | null) => path === "notes.txt" ? {
      data: { root: "/DATA", path, name: path, ext: "txt", mode: "text", mimeType: "text/plain", sizeBytes: 12, modifiedAt: "2026-02-27T00:00:00.000Z", mtimeMs: 1234, content: "hello world" },
      isLoading: false, isError: false, error: null,
    } : { data: null, isLoading: false, isError: false, error: null });
    const view = render(fileManagerElement());
    fireEvent.doubleClick(screen.getByRole("button", { name: "notes.txt" }));
    expect(await screen.findByRole("dialog", { name: "notes.txt" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Editor"), { target: { value: "unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
    view.rerender(fileManagerElement(false));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "notes.txt" })).toBeNull());
    view.rerender(fileManagerElement(true));
    expect(await screen.findByRole("dialog", { name: "notes.txt" })).toBeTruthy();
    expect(screen.getByDisplayValue("unsaved draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
  });

  it("ignores stale text preview data when opening an audio file", async () => {
    mockUseFilesDirectory.mockReturnValue(mockDirectory([{ name: "song.mp3", path: "song.mp3", type: "file" }]));
    mockUseFileContent.mockImplementation((filePath: string | null) => {
      if (filePath === "song.mp3") {
        return {
          data: {
            root: "/DATA",
            path: "notes.txt",
            name: "notes.txt",
            ext: "txt",
            mode: "text",
            mimeType: "text/plain",
            sizeBytes: 12,
            modifiedAt: "2026-02-27T00:00:00.000Z",
            mtimeMs: 1234,
            content: "stale text",
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      return { data: null, isLoading: false, isError: false, error: null };
    });

    await renderFileManager();
    fireEvent.doubleClick(screen.getByRole("button", { name: "song.mp3" }));

    await waitFor(() => {
      expect(screen.getByText("Loading file...")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
