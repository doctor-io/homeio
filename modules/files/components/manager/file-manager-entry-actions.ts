"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import {
  buildDownloadUrl,
  buildZipUrl,
  toFilePath,
} from "@/modules/files/hooks/useFiles";
import type { FileInfoResponse } from "@/lib/shared/contracts/files";
import type { FileEntry } from "@/modules/files/components/file-manager-presenters";
import type {
  CreateEntryDialogState,
  FileManagerAction,
  OpenFileState,
  RenameDialogState,
} from "@/modules/files/components/manager/file-manager-state";

type AsyncMutation<TArgs, TResult = unknown> = {
  mutateAsync: (args: TArgs) => Promise<TResult>;
};

export type UseFileManagerEntryActionsArgs = {
  createEntryDialog: CreateEntryDialogState | null;
  createFileMutation: AsyncMutation<{ parentPath: string; name: string }, { path: string }>;
  createFolderMutation: AsyncMutation<{ parentPath: string; name: string }, { path: string }>;
  createLocalShareMutation: AsyncMutation<{ path: string }, { sharedPath: string }>;
  currentPath: string[];
  deleteFromTrashMutation: AsyncMutation<{ path: string }>;
  deleteLocalShareMutation: AsyncMutation<string>;
  dispatch: (action: FileManagerAction) => void;
  emptyTrashMutation: AsyncMutation<void, { deletedCount: number }>;
  fileDrafts: Record<string, string>;
  filesRootPath: string;
  getFileInfoMutation: AsyncMutation<string, FileInfoResponse>;
  includeHidden: boolean;
  isEmptyingTrash: boolean;
  isStarredView: boolean;
  isTrashView: boolean;
  moveToTrashMutation: AsyncMutation<{ path: string }, { trashPath: string }>;
  openFile: OpenFileState | null;
  openFileKey: string | null;
  openFileViewer: { mode: string; content?: string | null; mtimeMs: number } | null;
  renameDialog: RenameDialogState | null;
  renameFileEntryMutation: AsyncMutation<{ path: string; newName: string }, { path: string }>;
  restoreFromTrashMutation: AsyncMutation<{ path: string; collision: "keep-both" }, { restoredPath: string }>;
  saveFileContentMutation: AsyncMutation<{ path: string; content: string; expectedMtimeMs: number }>;
  selectedFiles: Set<string>;
  setStatusNotice: (message: string | null) => void;
  sortedEntries: FileEntry[];
  systemHostname: string;
  systemNetworkAddress: string;
  toggleStarMutation: AsyncMutation<string, { starred: boolean }>;
  uploadAbortControllerRef: { current: AbortController | null };
  uploadFilesMutation: AsyncMutation<{
    destinationPath: string;
    files: File[];
    includeHidden: boolean;
    onProgress: (loaded: number, total: number) => void;
    signal: AbortSignal;
  }, { uploaded: unknown[]; skipped: unknown[] }>;
  unzipFileMutation: AsyncMutation<string, { destinationPath: string }>;
};

export function useFileManagerEntryActions({
  createEntryDialog,
  createFileMutation,
  createFolderMutation,
  createLocalShareMutation,
  currentPath,
  deleteFromTrashMutation,
  deleteLocalShareMutation,
  dispatch,
  emptyTrashMutation,
  fileDrafts,
  filesRootPath,
  getFileInfoMutation,
  includeHidden,
  isEmptyingTrash,
  isStarredView,
  isTrashView,
  moveToTrashMutation,
  openFile,
  openFileKey,
  openFileViewer,
  renameDialog,
  renameFileEntryMutation,
  restoreFromTrashMutation,
  saveFileContentMutation,
  selectedFiles,
  setStatusNotice,
  sortedEntries,
  systemHostname,
  systemNetworkAddress,
  toggleStarMutation,
  uploadAbortControllerRef,
  uploadFilesMutation,
  unzipFileMutation,
}: UseFileManagerEntryActionsArgs) {
  return useMemo(() => {
    async function handleTrashSelected() {
      if (selectedFiles.size === 0) return;
      dispatch({ type: "CLEAR_SELECTION" });
      for (const path of selectedFiles) {
        if (!sortedEntries.some((entry) => entry.path === path)) continue;
        try {
          await moveToTrashMutation.mutateAsync({ path });
        } catch {
          // Errors surface through mutation state.
        }
      }
    }

    async function handleMoveSelectedToTrash(entry: FileEntry) {
      dispatch({ type: "SET_PENDING_ENTRY_PATH", path: entry.path });
      try {
        const result = await moveToTrashMutation.mutateAsync({ path: entry.path });
        if (openFile && toFilePath(openFile.path) === entry.path) dispatch({ type: "CLOSE_FILE" });
        dispatch({ type: "SELECT_FILE", path: null });
        setStatusNotice(`Moved to Trash: ${result.trashPath}`);
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to move item to Trash");
      } finally {
        dispatch({ type: "SET_PENDING_ENTRY_PATH", path: null });
      }
    }

    async function handleRestoreFromTrash(entry: FileEntry) {
      dispatch({ type: "SET_PENDING_ENTRY_PATH", path: entry.path });
      try {
        const result = await restoreFromTrashMutation.mutateAsync({
          path: entry.path,
          collision: "keep-both",
        });
        dispatch({ type: "SELECT_FILE", path: null });
        setStatusNotice(`Restored: ${result.restoredPath}`);
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to restore item from Trash");
      } finally {
        dispatch({ type: "SET_PENDING_ENTRY_PATH", path: null });
      }
    }

    async function handleDeleteFromTrash(entry: FileEntry) {
      dispatch({ type: "SET_PENDING_ENTRY_PATH", path: entry.path });
      try {
        await deleteFromTrashMutation.mutateAsync({ path: entry.path });
        dispatch({ type: "SELECT_FILE", path: null });
        setStatusNotice(`Deleted permanently: ${entry.name}`);
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to permanently delete item");
      } finally {
        dispatch({ type: "SET_PENDING_ENTRY_PATH", path: null });
      }
    }

    function handleEmptyTrash() {
      if (!isTrashView || sortedEntries.length === 0 || isEmptyingTrash) return;
      dispatch({ type: "SHOW_EMPTY_TRASH_CONFIRM" });
    }

    async function confirmEmptyTrash() {
      dispatch({ type: "HIDE_EMPTY_TRASH_CONFIRM" });
      dispatch({ type: "SET_IS_EMPTYING_TRASH", value: true });
      try {
        const result = await emptyTrashMutation.mutateAsync(undefined);
        setStatusNotice(`Trash emptied (${result.deletedCount} item${result.deletedCount !== 1 ? "s" : ""})`);
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to empty Trash");
      } finally {
        dispatch({ type: "SET_IS_EMPTYING_TRASH", value: false });
      }
    }

    async function submitCreateEntryDialog() {
      if (!createEntryDialog) return;
      const name = createEntryDialog.name.trim();
      if (!name) {
        dispatch({ type: "SET_CREATE_ENTRY_ERROR", error: `Invalid ${createEntryDialog.kind} name` });
        return;
      }
      const parentPath = toFilePath(currentPath);
      try {
        const result =
          createEntryDialog.kind === "folder"
            ? await createFolderMutation.mutateAsync({ parentPath, name })
            : await createFileMutation.mutateAsync({ parentPath, name });
        dispatch({ type: "CLOSE_CREATE_ENTRY_DIALOG" });
        setStatusNotice(`${createEntryDialog.kind === "folder" ? "Folder" : "File"} created: ${result.path}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `Failed to create ${createEntryDialog.kind}`;
        dispatch({ type: "SET_CREATE_ENTRY_ERROR", error: message });
        setStatusNotice(message);
      }
    }

    function handleRenameEntry(entry: FileEntry) {
      if (isTrashView) {
        setStatusNotice("Rename is disabled in Trash");
        return;
      }
      dispatch({ type: "OPEN_RENAME_DIALOG", entry });
    }

    async function submitRenameDialog() {
      if (!renameDialog) return;
      const newName = renameDialog.name.trim();
      if (!newName || newName === renameDialog.entry.name) {
        dispatch({ type: "CLOSE_RENAME_DIALOG" });
        return;
      }
      try {
        const result = await renameFileEntryMutation.mutateAsync({
          path: renameDialog.entry.path,
          newName,
        });
        dispatch({ type: "CLOSE_RENAME_DIALOG" });
        dispatch({ type: "SELECT_FILE", path: null });
        setStatusNotice(`Renamed to ${result.path.split("/").pop() ?? newName}`);
      } catch (error) {
        dispatch({
          type: "SET_RENAME_ERROR",
          error: error instanceof Error ? error.message : "Failed to rename item",
        });
      }
    }

    async function handleGetInfo(entry: FileEntry) {
      try {
        const info = await getFileInfoMutation.mutateAsync(entry.path);
        dispatch({ type: "OPEN_FILE_INFO_DIALOG", info });
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to get item info");
      }
    }

    async function handleToggleStar(entry: FileEntry) {
      try {
        const result = await toggleStarMutation.mutateAsync(entry.path);
        setStatusNotice(result.starred ? `Starred ${entry.name}` : `Unstarred ${entry.name}`);
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to toggle star");
      }
    }

    async function handleUploadFiles(files: File[]) {
      if (files.length === 0 || isTrashView || isStarredView) return;
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      uploadAbortControllerRef.current?.abort();
      const controller = new AbortController();
      uploadAbortControllerRef.current = controller;
      dispatch({ type: "SET_UPLOAD_PROGRESS", loaded: 0, total: totalSize });
      const isCurrentUpload = () => uploadAbortControllerRef.current === controller;
      try {
        const result = await uploadFilesMutation.mutateAsync({
          destinationPath: toFilePath(currentPath),
          files,
          includeHidden,
          onProgress: (loaded, total) => {
            dispatch({ type: "SET_UPLOAD_PROGRESS", loaded, total: total || totalSize });
          },
          signal: controller.signal,
        });
        if (!isCurrentUpload()) return;
        dispatch({ type: "CLEAR_UPLOAD_PROGRESS" });
        const uploaded = result.uploaded.length;
        const skipped = result.skipped.length;
        if (uploaded > 0 && skipped === 0) setStatusNotice(`Uploaded ${uploaded} file${uploaded !== 1 ? "s" : ""}`);
        else if (uploaded > 0) setStatusNotice(`Uploaded ${uploaded}, skipped ${skipped} (already exist)`);
        else setStatusNotice(`Skipped ${skipped} file${skipped !== 1 ? "s" : ""} (already exist)`);
      } catch (error) {
        if (!isCurrentUpload()) return;
        dispatch({ type: "CLEAR_UPLOAD_PROGRESS" });
        if (error instanceof Error && error.name === "AbortError") {
          setStatusNotice("Upload canceled");
        } else {
          setStatusNotice(error instanceof Error ? error.message : "Upload failed");
        }
      } finally {
        if (uploadAbortControllerRef.current === controller) {
          uploadAbortControllerRef.current = null;
        }
      }
    }

    function handleDownloadEntry(entry: FileEntry) {
      window.open(entry.type === "folder" ? buildZipUrl(entry.path) : buildDownloadUrl(entry.path), "_blank", "noopener,noreferrer");
    }

    async function handleUnzipEntry(entry: FileEntry) {
      try {
        await unzipFileMutation.mutateAsync(entry.path);
        setStatusNotice("Unzipped successfully");
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to unzip");
      }
    }

    async function handleShareFolder(entry: FileEntry) {
      try {
        const result = await createLocalShareMutation.mutateAsync({ path: entry.path });
        setStatusNotice(`Shared over network: /${result.sharedPath}`);
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to share folder");
      }
    }

    async function handleUnshareFolder(shareId: string) {
      try {
        await deleteLocalShareMutation.mutateAsync(shareId);
        setStatusNotice("Shared folder removed");
      } catch (error) {
        setStatusNotice(error instanceof Error ? error.message : "Failed to remove shared folder");
      }
    }

    async function handleCopyEntryPath(entry: FileEntry) {
      const basePath = filesRootPath ? `${filesRootPath}/${entry.path}` : `/${entry.path}`;
      const networkBase = systemNetworkAddress || systemHostname;
      const fullPath =
        entry.path === "Shared" || entry.path.startsWith("Shared/")
          ? networkBase
            ? `smb://${networkBase}${basePath}`
            : basePath
          : basePath;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(fullPath);
        else {
          const el = document.createElement("textarea");
          el.value = fullPath;
          el.style.position = "fixed";
          el.style.opacity = "0";
          document.body.appendChild(el);
          el.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(el);
          if (!ok) throw new Error("execCommand failed");
        }
        toast.success("Path copied to clipboard");
      } catch {
        toast.error("Could not copy automatically", { description: fullPath });
      }
    }

    async function handleSaveOpenFile() {
      if (!openFileKey || openFileViewer?.mode !== "text") return;
      let nextContent = fileDrafts[openFileKey] ?? openFileViewer.content ?? "";

      const ext = openFileKey.split(".").pop()?.toLowerCase();
      if (ext === "json") {
        try {
          nextContent = JSON.stringify(JSON.parse(nextContent), null, 2);
          dispatch({ type: "SET_FILE_DRAFT", key: openFileKey, value: nextContent });
        } catch {
          // malformed JSON — save as-is
        }
      }

      try {
        await saveFileContentMutation.mutateAsync({
          path: openFileKey,
          content: nextContent,
          expectedMtimeMs: openFileViewer.mtimeMs,
        });
        dispatch({ type: "SET_EDITOR_NOTICE", notice: "Saved" });
      } catch (error) {
        dispatch({
          type: "SET_EDITOR_NOTICE",
          notice: error instanceof Error ? error.message : "Failed to save file",
        });
      }
    }

    return {
      confirmEmptyTrash,
      handleCopyEntryPath,
      handleDeleteFromTrash,
      handleDownloadEntry,
      handleEmptyTrash,
      handleGetInfo,
      handleMoveSelectedToTrash,
      handleRenameEntry,
      handleRestoreFromTrash,
      handleSaveOpenFile,
      handleShareFolder,
      handleToggleStar,
      handleTrashSelected,
      handleUnshareFolder,
      handleUnzipEntry,
      handleUploadFiles,
      submitCreateEntryDialog,
      submitRenameDialog,
    };
  }, [
    createEntryDialog,
    createFileMutation,
    createFolderMutation,
    createLocalShareMutation,
    currentPath,
    deleteFromTrashMutation,
    deleteLocalShareMutation,
    dispatch,
    emptyTrashMutation,
    fileDrafts,
    filesRootPath,
    getFileInfoMutation,
    includeHidden,
    isEmptyingTrash,
    isStarredView,
    isTrashView,
    moveToTrashMutation,
    openFile,
    openFileKey,
    openFileViewer,
    renameDialog,
    renameFileEntryMutation,
    restoreFromTrashMutation,
    saveFileContentMutation,
    selectedFiles,
    setStatusNotice,
    sortedEntries,
    systemHostname,
    systemNetworkAddress,
    toggleStarMutation,
    uploadAbortControllerRef,
    uploadFilesMutation,
    unzipFileMutation,
  ]);
}
