"use client";

import { FileManagerSidebar, FileManagerStatusBar, FileManagerToolbar, type FileManagerSidebarItem, type FileManagerSidebarSection, type RemovableSidebarItem, type CloudSidebarItem } from "@/modules/files/components/file-manager-chrome";
import { FileManagerFileArea } from "@/modules/files/components/content/file-manager-content";
import { FILES_PANEL_SHELL } from "@/modules/files/components/file-manager-surface";
import { FileManagerDialogLayer } from "@/modules/files/components/manager/file-manager-dialog-layer";
import { validateEntryName } from "@/modules/files/components/manager/file-manager-derived";
import { GoogleDrivePanel } from "@/modules/files/components/panels/google-drive-panel";
import { buildAssetUrl, toFilePath } from "@/modules/files/hooks/useFiles";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MouseEvent, RefObject, SetStateAction } from "react";
import type { FileEntry } from "@/modules/files/components/file-manager-presenters";
import type { FileInfoResponse, FileReadResponse } from "@/lib/shared/contracts/files";
import type { ClipboardState, CreateEntryDialogState, FileManagerAction, OpenFileState, PasteConflictState, RenameDialogState, ViewMode } from "@/modules/files/components/manager/file-manager-state";

type FileManagerViewProps = {
  rootRef: RefObject<HTMLDivElement | null>;
  actions: {
    confirmEmptyTrash: () => Promise<void>;
    handleConflictResolution: (choice: "replace" | "keep-both" | "skip" | "skip-all") => Promise<void>;
    handleCopyEntryPath: (entry: FileEntry) => Promise<void>;
    handleDeleteFromTrash: (entry: FileEntry) => Promise<void>;
    handleDownloadEntry: (entry: FileEntry) => void;
    handleUnzipEntry: (entry: FileEntry) => Promise<void>;
    handleEmptyTrash: () => void;
    handleGetInfo: (entry: FileEntry) => Promise<void>;
    handleMoveSelectedToTrash: (entry: FileEntry) => Promise<void>;
    handlePasteToDestination: (destinationPath: string) => Promise<void>;
    handleRenameEntry: (entry: FileEntry) => void;
    handleRestoreFromTrash: (entry: FileEntry) => Promise<void>;
    handleSaveOpenFile: () => Promise<void>;
    handleShareFolder: (entry: FileEntry) => Promise<void>;
    handleToggleStar: (entry: FileEntry) => Promise<void>;
    handleTrashSelected: () => Promise<void>;
    handleUnshareFolder: (shareId: string) => Promise<void>;
    handleUploadFiles: (files: File[]) => Promise<void>;
    setClipboardFromEntries: (entries: FileEntry[], operation: "copy" | "move") => void;
    submitCreateEntryDialog: () => Promise<void>;
    submitRenameDialog: () => Promise<void>;
  };
  canSaveOpenFile: boolean;
  clipboardDisplayName: string | null;
  clipboardState: ClipboardState | null;
  contextShare: { id: string } | undefined;
  counts: { fileCount: number; folderCount: number };
  createDialog: CreateEntryDialogState | null;
  createFilePending: boolean;
  createFolderPending: boolean;
  currentEntriesCount: number;
  currentPath: string[];
  currentPathForDisplay: string[];
  directoryErrorMessage: string;
  directoryIsError: boolean;
  directoryIsLoading: boolean;
  dispatch: (action: FileManagerAction) => void;
  editorNotice: string | null;
  emptyTrashPending: boolean;
  fileContentErrorMessage: string;
  fileContentIsError: boolean;
  fileContentIsLoading: boolean;
  fileInfoDialog: FileInfoResponse | null;
  globalSearch: boolean;
  globalSearchIsFetching: boolean;
  hasMoreSearchResults: boolean;
  includeHidden: boolean;
  isDragOver: boolean;
  isEmptyingTrash: boolean;
  isGlobalSearchActive: boolean;
  isSharedView: boolean;
  isStarredView: boolean;
  isTrashView: boolean;
  locationItems: FileManagerSidebarItem[];
  cloudItems: CloudSidebarItem[];
  activeDriveConnection: { id: string; email: string } | null;
  removableItems: RemovableSidebarItem[];
  onMountDrive: (driveId: string) => void;
  onEjectDrive: (driveId: string) => void;
  onCancelUpload: () => void;
  navigateTo: (entry: FileEntry) => void;
  navigateToPath: (pathSegments: string[]) => void;
  onEntryClick: (event: MouseEvent, entry: FileEntry) => void;
  onPositionBackgroundContextMenu: (event: MouseEvent) => void;
  onPositionEntryContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  hasUnsavedChanges: boolean;
  openFile: OpenFileState | null;
  openFileBadgeLabel: string;
  openFileContent: string;
  openFileKey: string | null;
  openFileLanguage: string;
  openFileViewer: FileReadResponse | null;
  pasteConflict: PasteConflictState | null;
  pastePending: boolean;
  pendingEntryPath: string | null;
  renameDialog: RenameDialogState | null;
  renamePending: boolean;
  rootLabel: string;
  searchQuery: string;
  selectedFiles: Set<string>;
  showBackgroundContextMenu: { x: number; y: number } | null;
  showContextMenu: { x: number; y: number; entry: FileEntry } | null;
  showEmptyTrashConfirm: boolean;
  showNetworkDialog: boolean;
  showGoogleDriveDialog: boolean;
  showUsbDialog: boolean;
  sidebarSections: FileManagerSidebarSection[];
  sortedEntries: FileEntry[];
  storageUsagePercent: number;
  storageUsageText: string;
  sortBy: "name" | "modified" | "size";
  sortDir: "asc" | "desc";
  statusNotice: string | null;
  totalEntriesCount: number;
  trashItemCount: number;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  uploadPending: boolean;
  uploadProgress: { loaded: number; total: number } | null;
  unzipPending: boolean;
  viewMode: ViewMode;
};

export function FileManagerView({
  rootRef,
  actions,
  canSaveOpenFile,
  clipboardDisplayName,
  clipboardState,
  contextShare,
  counts,
  createDialog,
  createFilePending,
  createFolderPending,
  currentEntriesCount,
  currentPath,
  currentPathForDisplay,
  directoryErrorMessage,
  directoryIsError,
  directoryIsLoading,
  dispatch,
  editorNotice,
  emptyTrashPending,
  fileContentErrorMessage,
  fileContentIsError,
  fileContentIsLoading,
  fileInfoDialog,
  globalSearch,
  globalSearchIsFetching,
  hasMoreSearchResults,
  hasUnsavedChanges,
  includeHidden,
  isDragOver,
  isEmptyingTrash,
  isGlobalSearchActive,
  isSharedView,
  isStarredView,
  isTrashView,
  locationItems,
  cloudItems,
  activeDriveConnection,
  removableItems,
  onMountDrive,
  onEjectDrive,
  onCancelUpload,
  navigateTo,
  navigateToPath,
  onEntryClick,
  onPositionBackgroundContextMenu,
  onPositionEntryContextMenu,
  openFile,
  openFileBadgeLabel,
  openFileContent,
  openFileKey,
  openFileLanguage,
  openFileViewer,
  pasteConflict,
  pastePending,
  pendingEntryPath,
  renameDialog,
  renamePending,
  rootLabel,
  searchQuery,
  selectedFiles,
  showBackgroundContextMenu,
  showContextMenu,
  showEmptyTrashConfirm,
  showNetworkDialog,
  showGoogleDriveDialog,
  showUsbDialog,
  sidebarSections,
  sortedEntries,
  storageUsagePercent,
  storageUsageText,
  sortBy,
  sortDir,
  statusNotice,
  totalEntriesCount,
  trashItemCount,
  uploadInputRef,
  uploadPending,
  uploadProgress,
  unzipPending,
  viewMode,
}: FileManagerViewProps) {
  // Narrow panels show the places list and the file list one at a time; the
  // switch itself is CSS (see @container/files below), so there is no width to
  // measure and no observer to mis-time. This state only remembers whether the
  // user opened the list while it was hidden.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      ref={rootRef}
      className="@container/files relative flex h-full"
      onClick={() => {
        dispatch({ type: "HIDE_CONTEXT_MENU" });
        dispatch({ type: "HIDE_BACKGROUND_CONTEXT_MENU" });
      }}
    >
      <FileManagerSidebar
        sidebarOpen={sidebarOpen}
        currentPath={currentPath}
        isSharedView={isSharedView}
        isTrashView={isTrashView}
        locationItems={locationItems}
        cloudItems={cloudItems}
        removableItems={removableItems}
        sidebarSections={sidebarSections}
        storageUsagePercent={storageUsagePercent}
        storageUsageText={storageUsageText}
        onNavigateToPath={(path) => {
          navigateToPath(path);
          setSidebarOpen(false);
        }}
        onOpenNetworkDialog={() => dispatch({ type: "SHOW_NETWORK_DIALOG" })}
        onOpenGoogleDriveDialog={() => dispatch({ type: "SHOW_GOOGLE_DRIVE_DIALOG" })}
        onOpenUsbDialog={() => dispatch({ type: "SHOW_USB_DIALOG" })}
        onMountDrive={onMountDrive}
        onEjectDrive={onEjectDrive}
      />
      {activeDriveConnection ? (
        <div className={`m-2 min-w-0 flex-1 overflow-hidden ${FILES_PANEL_SHELL}`}>
          <GoogleDrivePanel
            connectionId={activeDriveConnection.id}
            accountEmail={activeDriveConnection.email}
          />
        </div>
      ) : (
      <div
        className={cn(
          "m-2 min-w-0 flex-1 flex-col @2xl/files:flex",
          sidebarOpen ? "hidden" : "flex",
          FILES_PANEL_SHELL,
        )}
      >
        <FileManagerToolbar
          onOpenSidebar={() => setSidebarOpen(true)}
          canNavigateUp={currentPath.length > 0}
          currentEntriesCount={currentEntriesCount}
          currentPath={currentPath}
          currentPathForDisplay={currentPathForDisplay}
          emptyTrashPending={emptyTrashPending}
          globalSearch={globalSearch}
          globalSearchIsFetching={globalSearchIsFetching}
          includeHidden={includeHidden}
          isEmptyingTrash={isEmptyingTrash}
          isStarredView={isStarredView}
          isTrashView={isTrashView}
          rootLabel={rootLabel}
          searchQuery={searchQuery}
          sortBy={sortBy}
          sortDir={sortDir}
          uploadFilesPending={uploadPending}
          uploadInputRef={uploadInputRef}
          viewMode={viewMode}
          onSetSortBy={(by) => dispatch({ type: "SET_SORT_BY", by })}
          onEmptyTrash={actions.handleEmptyTrash}
          onNavigateToPath={navigateToPath}
          onNavigateUp={() => dispatch({ type: "NAVIGATE_UP" })}
          onSearchQueryChange={(query) => dispatch({ type: "SET_SEARCH_QUERY", query })}
          onSetViewMode={(mode) => dispatch({ type: "SET_VIEW_MODE", mode })}
          onToggleGlobalSearch={() => dispatch({ type: "TOGGLE_GLOBAL_SEARCH" })}
          onToggleIncludeHidden={() => dispatch({ type: "TOGGLE_INCLUDE_HIDDEN" })}
          onToggleSortDir={() => dispatch({ type: "TOGGLE_SORT_DIR" })}
          onUploadInputChange={(files) => {
            void actions.handleUploadFiles(files);
          }}
        />
        <FileManagerFileArea
          canSaveOpenFile={canSaveOpenFile}
          directoryErrorMessage={directoryErrorMessage}
          directoryIsError={directoryIsError}
          directoryIsLoading={directoryIsLoading}
          editorNotice={editorNotice}
          fileContentErrorMessage={fileContentErrorMessage}
          fileContentIsError={fileContentIsError}
          fileContentIsLoading={fileContentIsLoading}
          globalSearchIsFetching={globalSearchIsFetching}
          hasMoreSearchResults={hasMoreSearchResults}
          hasUnsavedChanges={hasUnsavedChanges}
          isDragOver={isDragOver}
          isGlobalSearchActive={isGlobalSearchActive}
          isStarredView={isStarredView}
          isTrashView={isTrashView}
          openFile={openFile}
          openFileAssetUrl={openFileKey ? buildAssetUrl(openFileKey) : ""}
          openFileBadgeLabel={openFileBadgeLabel}
          openFileContent={openFileContent}
          openFileKey={openFileKey}
          openFileLanguage={openFileLanguage}
          openFileViewer={openFileViewer}
          showSaveOpenFile={openFileViewer?.mode === "text"}
          pendingEntryPath={pendingEntryPath}
          searchQuery={searchQuery}
          selectedFiles={selectedFiles}
          sortedEntries={sortedEntries}
          totalEntriesCount={totalEntriesCount}
          viewMode={viewMode}
          onBackgroundContextMenu={onPositionBackgroundContextMenu}
          onChangeOpenFileDraft={(value: SetStateAction<string>) => {
            if (!openFileKey) return;
            dispatch({
              type: "SET_FILE_DRAFT",
              key: openFileKey,
              value: typeof value === "function" ? value(openFileContent) : value,
            });
          }}
          onCloseOpenFile={() => dispatch({ type: "CLOSE_FILE" })}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              dispatch({ type: "SET_DRAG_OVER", value: false });
            }
          }}
          onDragOver={(event) => {
            if (isTrashView || isStarredView) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            dispatch({ type: "SET_DRAG_OVER", value: true });
          }}
          onDrop={(event) => {
            event.preventDefault();
            dispatch({ type: "SET_DRAG_OVER", value: false });
            if (isTrashView || isStarredView) return;
            void actions.handleUploadFiles(Array.from(event.dataTransfer.files));
          }}
          onEntryClick={onEntryClick}
          onEntryContextMenu={onPositionEntryContextMenu}
          onLoadMoreSearch={() => dispatch({ type: "LOAD_MORE_SEARCH" })}
          onOpenEntry={navigateTo}
          onSaveOpenFile={() => {
            void actions.handleSaveOpenFile();
          }}
        />
        <FileManagerStatusBar
          clipboardName={clipboardDisplayName}
          clipboardOperation={clipboardState?.operation ?? null}
          currentPathForDisplay={currentPathForDisplay}
          fileCount={counts.fileCount}
          folderCount={counts.folderCount}
          isStarredView={isStarredView}
          isTrashView={isTrashView}
          rootLabel={rootLabel}
          selectedFilesCount={selectedFiles.size}
          statusNotice={statusNotice}
          onTrashSelected={() => {
            void actions.handleTrashSelected();
          }}
        />
      </div>
      )}
      <FileManagerDialogLayer
        clipboardState={clipboardState}
        contextShare={contextShare}
        createEntryDialog={createDialog}
        createPending={createFilePending || createFolderPending}
        fileInfoDialog={fileInfoDialog}
        isTrashView={isTrashView}
        pasteConflict={pasteConflict}
        pastePending={pastePending}
        renameDialog={renameDialog}
        renamePending={renamePending}
        showBackgroundContextMenu={showBackgroundContextMenu}
        showContextMenu={showContextMenu}
        showEmptyTrashConfirm={showEmptyTrashConfirm}
        showNetworkDialog={showNetworkDialog}
        showGoogleDriveDialog={showGoogleDriveDialog}
        showUsbDialog={showUsbDialog}
        trashItemCount={trashItemCount}
        uploadPending={uploadPending}
        uploadProgress={uploadProgress}
        unzipPending={unzipPending}
        onCancelEmptyTrash={() => dispatch({ type: "HIDE_EMPTY_TRASH_CONFIRM" })}
        onCancelUpload={onCancelUpload}
        onChangeCreateEntryDialog={(value) => dispatch({ type: "UPDATE_CREATE_ENTRY_DIALOG", name: value, error: validateEntryName(value) })}
        onChangeRenameDialog={(value) => dispatch({ type: "UPDATE_RENAME_DIALOG", name: value, error: validateEntryName(value) })}
        onCloseBackgroundContextMenu={() => dispatch({ type: "HIDE_BACKGROUND_CONTEXT_MENU" })}
        onCloseContextMenu={() => dispatch({ type: "HIDE_CONTEXT_MENU" })}
        onCloseCreateEntryDialog={() => dispatch({ type: "CLOSE_CREATE_ENTRY_DIALOG" })}
        onCloseFileInfoDialog={() => dispatch({ type: "CLOSE_FILE_INFO_DIALOG" })}
        onCloseNetworkDialog={() => dispatch({ type: "HIDE_NETWORK_DIALOG" })}
        onCloseGoogleDriveDialog={() => dispatch({ type: "HIDE_GOOGLE_DRIVE_DIALOG" })}
        onCloseUsbDialog={() => dispatch({ type: "HIDE_USB_DIALOG" })}
        onCloseRenameDialog={() => dispatch({ type: "CLOSE_RENAME_DIALOG" })}
        onConfirmEmptyTrash={() => {
          void actions.confirmEmptyTrash();
        }}
        onConflictResolution={(choice) => {
          void actions.handleConflictResolution(choice);
        }}
        onCopyContextEntry={() => showContextMenu && actions.setClipboardFromEntries([showContextMenu.entry], "copy")}
        onCopyContextPath={() => showContextMenu && void actions.handleCopyEntryPath(showContextMenu.entry)}
        onCutContextEntry={() => showContextMenu && actions.setClipboardFromEntries([showContextMenu.entry], "move")}
        onDeleteContextEntry={() => showContextMenu && void actions.handleDeleteFromTrash(showContextMenu.entry)}
        onDownloadContextEntry={() => showContextMenu && actions.handleDownloadEntry(showContextMenu.entry)}
        onUnzipContextEntry={() => showContextMenu && void actions.handleUnzipEntry(showContextMenu.entry)}
        onGetInfoContextEntry={() => showContextMenu && void actions.handleGetInfo(showContextMenu.entry)}
        onMoveContextEntryToTrash={() => showContextMenu && void actions.handleMoveSelectedToTrash(showContextMenu.entry)}
        onNavigateToNetwork={() => {
          dispatch({ type: "NAVIGATE_TO_PATH", path: ["Network"] });
          dispatch({ type: "HIDE_NETWORK_DIALOG" });
        }}
        onNavigateToUsb={(path) => {
          dispatch({ type: "NAVIGATE_TO_PATH", path });
        }}
        onOpenContextEntry={() => showContextMenu && navigateTo(showContextMenu.entry)}
        onOpenCreateEntryDialog={(kind) => dispatch({ type: "OPEN_CREATE_ENTRY_DIALOG", kind })}
        onPasteIntoBackground={() => {
          void actions.handlePasteToDestination(toFilePath(currentPath));
        }}
        onPasteIntoContextEntry={() => {
          if (!showContextMenu) return;
          void actions.handlePasteToDestination(
            showContextMenu.entry.type === "folder" ? showContextMenu.entry.path : toFilePath(currentPath),
          );
        }}
        onRenameContextEntry={() => showContextMenu && actions.handleRenameEntry(showContextMenu.entry)}
        onRestoreContextEntry={() => showContextMenu && void actions.handleRestoreFromTrash(showContextMenu.entry)}
        onSubmitCreateEntryDialog={() => {
          void actions.submitCreateEntryDialog();
        }}
        onSubmitRenameDialog={() => {
          void actions.submitRenameDialog();
        }}
        onToggleContextShare={() => {
          if (!showContextMenu) return;
          if (contextShare) {
            void actions.handleUnshareFolder(contextShare.id);
            return;
          }
          if (
            showContextMenu.entry.path === "Shared" ||
            showContextMenu.entry.path.startsWith("Shared/") ||
            showContextMenu.entry.path === "Network" ||
            showContextMenu.entry.path.startsWith("Network/")
          ) {
            return;
          }
          void actions.handleShareFolder(showContextMenu.entry);
        }}
        onToggleContextStar={() => showContextMenu && void actions.handleToggleStar(showContextMenu.entry)}
      />
    </div>
  );
}
