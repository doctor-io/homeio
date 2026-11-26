"use client";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEffect, useMemo, useReducer, useRef, type MouseEvent } from "react";
import {
  getEditorLanguage,
  normalizePathForBackend,
  type FileEntry,
} from "@/modules/files/components/file-manager-presenters";
import {
  toFilePath,
  useCreateFile,
  useCreateFolder,
  useFileContent,
  useFileEntryInfo,
  useFilesDirectory,
  useFilesRoot,
  usePasteFileEntry,
  useRenameFileEntry,
  useSaveFileContent,
  useSearchFiles,
  useStarredFiles,
  useToggleFileStar,
  useUnzipFile,
  useUploadFiles,
} from "@/modules/files/hooks/useFiles";
import {
  useCreateLocalFolderShare,
  useDeleteLocalFolderShare,
  useLocalFolderShares,
} from "@/modules/files/hooks/useLocalFolderShares";
import { useNetworkShares } from "@/modules/files/hooks/useNetworkShares";
import { useUsbDrives } from "@/modules/files/hooks/useUsbDrives";
import { useGoogleDriveConnections } from "@/modules/files/hooks/useGoogleDrive";
import { Cloud } from "@/components/icons/platform-icons";
import { OsIcon } from "@/components/icons/OsIcon";
import { FILE_SIDEBAR_ICONS } from "@/components/icons/icon-assets";
import {
  useDeleteFromTrash,
  useEmptyTrash,
  useMoveToTrash,
  useRestoreFromTrash,
} from "@/modules/files/hooks/useTrashActions";
import { useSystemMetrics } from "@/modules/system/hooks/useSystemMetrics";
import { useFileManagerActions } from "@/modules/files/components/manager/file-manager-actions";
import {
  getBrowserCounts,
  getClipboardDisplayName,
  getCurrentEntries,
  getCurrentPathForDisplay,
  getDriveItems,
  getLocalSharesByPath,
  getLocationItems,
  getOpenFileDetails,
  getRemovableItems,
  getStorageSummary,
  getViewFlags,
  sidebarSections,
  sortEntries,
} from "@/modules/files/components/manager/file-manager-derived";
import { useFileManagerKeyboard } from "@/modules/files/components/manager/file-manager-keyboard";
import {
  fileManagerReducer,
  initialState,
} from "@/modules/files/components/manager/file-manager-state";
import { FileManagerView } from "@/modules/files/components/manager/file-manager-view";

export function FileManager({ keyboardEnabled = true }: { keyboardEnabled?: boolean } = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const statusNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const [state, dispatch] = useReducer(fileManagerReducer, initialState);
  const currentUserQuery = useCurrentUser();

  const filesRootQuery = useFilesRoot();
  const viewFlags = getViewFlags(state.currentPath);
  const directoryQuery = useFilesDirectory(viewFlags.isStarredView ? [] : state.currentPath, state.includeHidden, {
    enabled: !viewFlags.isStarredView,
  });
  const starredFilesQuery = useStarredFiles();
  const systemMetricsQuery = useSystemMetrics();
  const networkSharesQuery = useNetworkShares();
  const localSharesQuery = useLocalFolderShares();
  const usbDrivesQuery = useUsbDrives();
  const googleDriveConnectionsQuery = useGoogleDriveConnections();
  const createFolderMutation = useCreateFolder();
  const createFileMutation = useCreateFile();
  const pasteFileEntryMutation = usePasteFileEntry();
  const createLocalShareMutation = useCreateLocalFolderShare();
  const deleteLocalShareMutation = useDeleteLocalFolderShare();
  const saveFileContentMutation = useSaveFileContent();
  const moveToTrashMutation = useMoveToTrash();
  const restoreFromTrashMutation = useRestoreFromTrash();
  const deleteFromTrashMutation = useDeleteFromTrash();
  const emptyTrashMutation = useEmptyTrash();
  const renameFileEntryMutation = useRenameFileEntry();
  const getFileInfoMutation = useFileEntryInfo();
  const toggleStarMutation = useToggleFileStar();
  const uploadFilesMutation = useUploadFiles();
  const unzipFileMutation = useUnzipFile();

  const openFilePath = state.openFile ? toFilePath(state.openFile.path) : null;
  const fileContentQuery = useFileContent(openFilePath);
  const globalSearchQuery = useSearchFiles({
    query: state.debouncedSearchQuery,
    basePath: undefined,
    includeHidden: state.includeHidden,
    enabled: state.globalSearch && state.debouncedSearchQuery.trim().length >= 2,
  });
  const isGlobalSearchActive = state.globalSearch && state.debouncedSearchQuery.trim().length >= 2;

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      dispatch({ type: "SET_DEBOUNCED_SEARCH_QUERY", query: state.searchQuery });
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [state.searchQuery]);

  const currentEntries = useMemo(
    () =>
      getCurrentEntries({
        directoryEntries: directoryQuery.data?.entries,
        globalEntries: globalSearchQuery.data?.entries,
        isGlobalSearchActive,
        isStarredView: viewFlags.isStarredView,
        starredEntries: starredFilesQuery.data?.entries,
      }),
    [
      directoryQuery.data?.entries,
      globalSearchQuery.data?.entries,
      isGlobalSearchActive,
      starredFilesQuery.data?.entries,
      viewFlags.isStarredView,
    ],
  );
  const sortedEntries = useMemo(
    () =>
      sortEntries({
        currentEntries,
        isGlobalSearchActive,
        searchQuery: state.searchQuery,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      }),
    [currentEntries, isGlobalSearchActive, state.searchQuery, state.sortBy, state.sortDir],
  );
  const visibleEntries = isGlobalSearchActive
    ? sortedEntries.slice(0, state.searchDisplayLimit)
    : sortedEntries;
  const hasMoreSearchResults = isGlobalSearchActive && sortedEntries.length > state.searchDisplayLimit;

  const openFileLanguage = state.openFile ? getEditorLanguage(state.openFile.entry) : "plaintext";
  const openFileViewer =
    openFilePath && fileContentQuery.data?.path === openFilePath ? fileContentQuery.data : null;
  const openFileState = getOpenFileDetails({
    fileDrafts: state.fileDrafts,
    filePath: openFilePath,
    language: openFileLanguage,
    viewer: openFileViewer,
  });
  const canSaveOpenFile = Boolean(
    openFilePath &&
      openFileViewer?.mode === "text" &&
      !fileContentQuery.isLoading &&
      !saveFileContentMutation.isPending &&
      openFileState.hasUnsavedChanges,
  );

  const storageSummary = getStorageSummary(systemMetricsQuery.data?.storage);
  const currentPathForDisplay = getCurrentPathForDisplay(state.currentPath);
  const filesRootPath = filesRootQuery.data?.rootPath ?? "";
  const rootLabel = filesRootPath || "/DATA";
  const isDemoMode = currentUserQuery.data?.isDemoMode ?? false;
  const localSharesByPath = useMemo(() => getLocalSharesByPath(localSharesQuery.data), [localSharesQuery.data]);
  const locationItems = useMemo(
    () => (isDemoMode ? [] : getLocationItems(networkSharesQuery.data)),
    [isDemoMode, networkSharesQuery.data],
  );
  const removableItems = useMemo(
    () => (isDemoMode ? [] : getRemovableItems(usbDrivesQuery.drives)),
    [isDemoMode, usbDrivesQuery.drives],
  );
  const driveItems = useMemo(
    () =>
      isDemoMode
        ? []
        : getDriveItems(googleDriveConnectionsQuery.data?.connections).map((item) => ({
            ...item,
            icon: (
              <OsIcon
                src={FILE_SIDEBAR_ICONS.googleDrive}
                className="size-4 object-contain"
                fallback={<Cloud className="size-4 text-sky-400" />}
              />
            ),
            accountEmail: item.email,
          })),
    [isDemoMode, googleDriveConnectionsQuery.data],
  );
  const activeDriveConnection = useMemo(() => {
    if (!viewFlags.isDriveView) return null;
    const connectionId = state.currentPath[1];
    const conn = googleDriveConnectionsQuery.data?.connections.find((c) => c.id === connectionId);
    return conn ? { id: conn.id, email: conn.email } : null;
  }, [viewFlags.isDriveView, state.currentPath, googleDriveConnectionsQuery.data]);
  const counts = useMemo(() => getBrowserCounts(sortedEntries), [sortedEntries]);
  const clipboardDisplayName = getClipboardDisplayName(state.clipboardState);
  const contextShare =
    state.showContextMenu?.entry.type === "folder"
      ? localSharesByPath.get(state.showContextMenu.entry.path)
      : undefined;
  const trashItemCount = viewFlags.isTrashView
    ? (directoryQuery.data?.entries.length ?? currentEntries.length)
    : 0;

  function setStatusNotice(message: string | null) {
    if (statusNoticeTimerRef.current) clearTimeout(statusNoticeTimerRef.current);
    dispatch({ type: "SET_STATUS_NOTICE", notice: message });
    if (message !== null) {
      statusNoticeTimerRef.current = setTimeout(() => {
        dispatch({ type: "SET_STATUS_NOTICE", notice: null });
      }, 4000);
    }
  }

  const actions = useFileManagerActions({
    clipboardState: state.clipboardState,
    createEntryDialog: state.createEntryDialog,
    createFileMutation,
    createFolderMutation,
    createLocalShareMutation,
    currentPath: state.currentPath,
    deleteFromTrashMutation,
    deleteLocalShareMutation,
    dispatch,
    emptyTrashMutation,
    fileDrafts: state.fileDrafts,
    filesRootPath,
    getFileInfoMutation,
    includeHidden: state.includeHidden,
    isEmptyingTrash: state.isEmptyingTrash,
    isStarredView: viewFlags.isStarredView,
    isTrashView: viewFlags.isTrashView,
    moveToTrashMutation,
    openFile: state.openFile,
    openFileKey: openFilePath,
    openFileViewer,
    pasteConflict: state.pasteConflict,
    pasteFileEntryMutation,
    renameDialog: state.renameDialog,
    renameFileEntryMutation,
    restoreFromTrashMutation,
    saveFileContentMutation,
    selectedFiles: state.selectedFiles,
    setStatusNotice,
    sortedEntries,
    systemHostname: systemMetricsQuery.data?.hostname ?? "",
    systemNetworkAddress: systemMetricsQuery.data?.wifi?.ipv4 ?? "",
    toggleStarMutation,
    uploadAbortControllerRef,
    uploadFilesMutation,
    unzipFileMutation,
  });

  useEffect(() => {
    if (!openFilePath || !openFileViewer || openFileViewer.mode !== "text") return;
    dispatch({ type: "INIT_FILE_DRAFT", key: openFilePath, value: openFileViewer.content ?? "" });
  }, [openFilePath, openFileViewer]);

  useEffect(() => {
    dispatch({ type: "SET_EDITOR_NOTICE", notice: null });
  }, [openFilePath]);

  function navigateTo(entry: FileEntry) {
    if (entry.type === "folder") {
      dispatch({ type: "NAVIGATE_TO_PATH", path: entry.path.split("/").filter(Boolean) });
      return;
    }
    dispatch({ type: "OPEN_FILE", path: entry.path.split("/").filter(Boolean), entry });
  }

  function navigateToPath(pathSegments: string[]) {
    dispatch({ type: "NAVIGATE_TO_PATH", path: normalizePathForBackend(pathSegments) });
  }

  function handleEntryClick(event: MouseEvent, entry: FileEntry) {
    if (event.ctrlKey || event.metaKey) {
      dispatch({ type: "TOGGLE_FILE_SELECTION", path: entry.path });
      return;
    }
    if (event.shiftKey && state.selectedFile) {
      const anchor = sortedEntries.findIndex((candidate) => candidate.path === state.selectedFile);
      const clicked = sortedEntries.findIndex((candidate) => candidate.path === entry.path);
      if (anchor !== -1 && clicked !== -1) {
        const [from, to] = anchor <= clicked ? [anchor, clicked] : [clicked, anchor];
        dispatch({
          type: "SET_SELECTED_FILES",
          files: new Set(sortedEntries.slice(from, to + 1).map((candidate) => candidate.path)),
        });
      }
      dispatch({ type: "SELECT_FILE", path: entry.path });
      return;
    }
    dispatch({ type: "SET_SELECTED_FILES", files: new Set([entry.path]) });
    dispatch({ type: "SELECT_FILE", path: entry.path });
  }

  useFileManagerKeyboard({
    enabled: keyboardEnabled,
    clipboardState: state.clipboardState,
    createEntryDialogOpen: Boolean(state.createEntryDialog),
    currentPath: state.currentPath,
    dispatch,
    fileInfoDialogOpen: Boolean(state.fileInfoDialog),
    isStarredView: viewFlags.isStarredView,
    isTrashView: viewFlags.isTrashView,
    onCopyEntries: actions.setClipboardFromEntries,
    onDeleteFromTrash: actions.handleDeleteFromTrash,
    onMoveToTrash: actions.handleMoveSelectedToTrash,
    onNavigateTo: navigateTo,
    onNavigateUp: () => dispatch({ type: "NAVIGATE_UP" }),
    onPaste: actions.handlePasteToDestination,
    onRenameEntry: actions.handleRenameEntry,
    openFileOpen: Boolean(state.openFile),
    pasteConflict: state.pasteConflict,
    renameDialogOpen: Boolean(state.renameDialog),
    searchQuery: state.searchQuery,
    selectedFile: state.selectedFile,
    selectedFiles: state.selectedFiles,
    showContextMenuOpen: Boolean(state.showContextMenu),
    showEmptyTrashConfirmOpen: state.showEmptyTrashConfirm,
    sortedEntries,
  });

  function positionMenu(event: MouseEvent, dimensions: { width: number; height: number }) {
    const rootRect = rootRef.current?.getBoundingClientRect();
    if (!rootRect) return null;
    return {
      x: Math.max(8, Math.min(event.clientX - rootRect.left, rootRect.width - dimensions.width - 8)),
      y: Math.max(8, Math.min(event.clientY - rootRect.top, rootRect.height - dimensions.height - 8)),
    };
  }

  return (
    <FileManagerView
      keyboardEnabled={keyboardEnabled}
      rootRef={rootRef}
      actions={actions}
      canSaveOpenFile={canSaveOpenFile}
      clipboardDisplayName={clipboardDisplayName}
      clipboardState={state.clipboardState}
      contextShare={contextShare}
      counts={counts}
      createDialog={state.createEntryDialog}
      createFilePending={createFileMutation.isPending}
      createFolderPending={createFolderMutation.isPending}
      currentEntriesCount={currentEntries.length}
      currentPath={state.currentPath}
      currentPathForDisplay={currentPathForDisplay}
      directoryErrorMessage={directoryQuery.error instanceof Error ? directoryQuery.error.message : "Failed to load files"}
      directoryIsError={directoryQuery.isError}
      directoryIsLoading={directoryQuery.isLoading}
      dispatch={dispatch}
      editorNotice={state.editorNotice}
      emptyTrashPending={emptyTrashMutation.isPending}
      fileContentErrorMessage={fileContentQuery.error instanceof Error ? fileContentQuery.error.message : "Failed to open file"}
      fileContentIsError={fileContentQuery.isError}
      fileContentIsLoading={fileContentQuery.isLoading}
      fileInfoDialog={state.fileInfoDialog}
      globalSearch={state.globalSearch}
      globalSearchIsFetching={globalSearchQuery.isFetching}
      hasMoreSearchResults={hasMoreSearchResults}
      includeHidden={state.includeHidden}
      isDragOver={state.isDragOver}
      isEmptyingTrash={state.isEmptyingTrash}
      isGlobalSearchActive={isGlobalSearchActive}
      isSharedView={viewFlags.isSharedView}
      isStarredView={viewFlags.isStarredView}
      isTrashView={viewFlags.isTrashView}
      locationItems={locationItems}
      cloudItems={driveItems}
      activeDriveConnection={activeDriveConnection}
      removableItems={removableItems}
      onMountDrive={usbDrivesQuery.mount}
      onEjectDrive={usbDrivesQuery.eject}
      onCancelUpload={() => uploadAbortControllerRef.current?.abort()}
      navigateTo={navigateTo}
      navigateToPath={navigateToPath}
      onEntryClick={handleEntryClick}
      onPositionBackgroundContextMenu={(event) => {
        if (viewFlags.isTrashView || viewFlags.isStarredView) return;
        event.preventDefault();
        event.stopPropagation();
        const next = positionMenu(event, { width: 176, height: 112 });
        if (!next) return;
        dispatch({ type: "SHOW_BACKGROUND_CONTEXT_MENU", ...next });
      }}
      onPositionEntryContextMenu={(event, entry) => {
        event.preventDefault();
        event.stopPropagation();
        const next = positionMenu(event, { width: 220, height: 400 });
        if (!next) return;
        dispatch({ type: "SHOW_CONTEXT_MENU", entry, ...next });
        dispatch({ type: "SELECT_FILE", path: entry.path });
      }}
      openFile={state.openFile}
      hasUnsavedChanges={openFileState.hasUnsavedChanges}
      openFileBadgeLabel={openFileState.badgeLabel}
      openFileContent={openFileState.content}
      openFileKey={openFilePath}
      openFileLanguage={openFileLanguage}
      openFileViewer={openFileViewer}
      pasteConflict={state.pasteConflict}
      pastePending={pasteFileEntryMutation.isPending}
      pendingEntryPath={state.pendingEntryPath}
      renameDialog={state.renameDialog}
      renamePending={renameFileEntryMutation.isPending}
      rootLabel={rootLabel}
      searchQuery={state.searchQuery}
      selectedFiles={state.selectedFiles}
      showBackgroundContextMenu={state.showBackgroundContextMenu}
      showContextMenu={state.showContextMenu}
      showEmptyTrashConfirm={state.showEmptyTrashConfirm}
      showNetworkDialog={state.showNetworkDialog && !isDemoMode}
      showGoogleDriveDialog={state.showGoogleDriveDialog && !isDemoMode}
      showUsbDialog={state.showUsbDialog && !isDemoMode}
      sidebarSections={sidebarSections}
      sortedEntries={visibleEntries}
      storageUsagePercent={storageSummary.percent}
      storageUsageText={storageSummary.text}
      sortBy={state.sortBy}
      sortDir={state.sortDir}
      statusNotice={state.statusNotice}
      totalEntriesCount={sortedEntries.length}
      trashItemCount={trashItemCount}
      uploadInputRef={uploadInputRef}
      uploadPending={uploadFilesMutation.isPending}
      uploadProgress={state.uploadProgress}
      unzipPending={unzipFileMutation.isPending}
      viewMode={state.viewMode}
    />
  );
}
