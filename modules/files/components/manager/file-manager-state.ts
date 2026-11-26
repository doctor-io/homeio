import type { FileInfoResponse } from "@/lib/shared/contracts/files";
import type { FileEntry } from "@/modules/files/components/file-manager-presenters";

export type ViewMode = "grid" | "list";
export type SortBy = "name" | "modified" | "size";
export type OpenFileState = { path: string[]; entry: FileEntry };
export type ClipboardState = {
  sourcePaths: string[];
  names: string[];
  operation: "copy" | "move";
};
export type CreateEntryDialogState = {
  kind: "file" | "folder";
  name: string;
  error: string | null;
};
export type RenameDialogState = {
  entry: FileEntry;
  name: string;
  error: string | null;
};
export type PasteConflictState = {
  pendingSourcePaths: string[];
  conflictName: string;
  destinationPath: string;
  operation: "copy" | "move";
};

export type FileManagerState = {
  currentPath: string[];
  viewMode: ViewMode;
  selectedFile: string | null;
  selectedFiles: Set<string>;
  searchQuery: string;
  debouncedSearchQuery: string;
  sortBy: SortBy;
  sortDir: "asc" | "desc";
  showContextMenu: { x: number; y: number; entry: FileEntry } | null;
  showBackgroundContextMenu: { x: number; y: number } | null;
  openFile: OpenFileState | null;
  fileDrafts: Record<string, string>;
  editorNotice: string | null;
  statusNotice: string | null;
  showNetworkDialog: boolean;
  showGoogleDriveDialog: boolean;
  showUsbDialog: boolean;
  clipboardState: ClipboardState | null;
  isEmptyingTrash: boolean;
  includeHidden: boolean;
  createEntryDialog: CreateEntryDialogState | null;
  renameDialog: RenameDialogState | null;
  fileInfoDialog: FileInfoResponse | null;
  pendingEntryPath: string | null;
  showEmptyTrashConfirm: boolean;
  isDragOver: boolean;
  globalSearch: boolean;
  uploadProgress: { loaded: number; total: number } | null;
  pasteConflict: PasteConflictState | null;
  searchDisplayLimit: number;
};

export const SEARCH_DISPLAY_LIMIT = 100;

export const initialState: FileManagerState = {
  currentPath: [],
  viewMode: "grid",
  selectedFile: null,
  selectedFiles: new Set(),
  searchQuery: "",
  debouncedSearchQuery: "",
  sortBy: "name",
  sortDir: "asc",
  showContextMenu: null,
  showBackgroundContextMenu: null,
  openFile: null,
  fileDrafts: {},
  editorNotice: null,
  statusNotice: null,
  showNetworkDialog: false,
  showGoogleDriveDialog: false,
  showUsbDialog: false,
  clipboardState: null,
  isEmptyingTrash: false,
  includeHidden: false,
  createEntryDialog: null,
  renameDialog: null,
  fileInfoDialog: null,
  pendingEntryPath: null,
  showEmptyTrashConfirm: false,
  isDragOver: false,
  globalSearch: false,
  uploadProgress: null,
  pasteConflict: null,
  searchDisplayLimit: SEARCH_DISPLAY_LIMIT,
};

export type FileManagerAction =
  | { type: "NAVIGATE_TO_PATH"; path: string[] }
  | { type: "NAVIGATE_UP" }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "SELECT_FILE"; path: string | null }
  | { type: "TOGGLE_FILE_SELECTION"; path: string }
  | { type: "SET_SELECTED_FILES"; files: Set<string> }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_DEBOUNCED_SEARCH_QUERY"; query: string }
  | { type: "SET_SORT_BY"; by: SortBy }
  | { type: "TOGGLE_SORT_DIR" }
  | { type: "SHOW_CONTEXT_MENU"; x: number; y: number; entry: FileEntry }
  | { type: "HIDE_CONTEXT_MENU" }
  | { type: "SHOW_BACKGROUND_CONTEXT_MENU"; x: number; y: number }
  | { type: "HIDE_BACKGROUND_CONTEXT_MENU" }
  | { type: "OPEN_FILE"; path: string[]; entry: FileEntry }
  | { type: "CLOSE_FILE" }
  | { type: "SET_FILE_DRAFT"; key: string; value: string }
  | { type: "INIT_FILE_DRAFT"; key: string; value: string }
  | { type: "SET_EDITOR_NOTICE"; notice: string | null }
  | { type: "SET_STATUS_NOTICE"; notice: string | null }
  | { type: "SHOW_NETWORK_DIALOG" }
  | { type: "HIDE_NETWORK_DIALOG" }
  | { type: "SHOW_GOOGLE_DRIVE_DIALOG" }
  | { type: "HIDE_GOOGLE_DRIVE_DIALOG" }
  | { type: "SHOW_USB_DIALOG" }
  | { type: "HIDE_USB_DIALOG" }
  | { type: "SET_CLIPBOARD"; sourcePaths: string[]; names: string[]; operation: "copy" | "move" }
  | { type: "CLEAR_CLIPBOARD" }
  | { type: "SET_IS_EMPTYING_TRASH"; value: boolean }
  | { type: "TOGGLE_INCLUDE_HIDDEN" }
  | { type: "OPEN_CREATE_ENTRY_DIALOG"; kind: "file" | "folder" }
  | { type: "CLOSE_CREATE_ENTRY_DIALOG" }
  | { type: "UPDATE_CREATE_ENTRY_DIALOG"; name: string; error: string | null }
  | { type: "SET_CREATE_ENTRY_ERROR"; error: string }
  | { type: "OPEN_RENAME_DIALOG"; entry: FileEntry }
  | { type: "CLOSE_RENAME_DIALOG" }
  | { type: "UPDATE_RENAME_DIALOG"; name: string; error: string | null }
  | { type: "SET_RENAME_ERROR"; error: string }
  | { type: "OPEN_FILE_INFO_DIALOG"; info: FileInfoResponse }
  | { type: "CLOSE_FILE_INFO_DIALOG" }
  | { type: "SET_PENDING_ENTRY_PATH"; path: string | null }
  | { type: "SHOW_EMPTY_TRASH_CONFIRM" }
  | { type: "HIDE_EMPTY_TRASH_CONFIRM" }
  | { type: "SET_DRAG_OVER"; value: boolean }
  | { type: "TOGGLE_GLOBAL_SEARCH" }
  | { type: "SET_UPLOAD_PROGRESS"; loaded: number; total: number }
  | { type: "CLEAR_UPLOAD_PROGRESS" }
  | { type: "SHOW_PASTE_CONFLICT"; conflict: PasteConflictState }
  | { type: "HIDE_PASTE_CONFLICT" }
  | { type: "LOAD_MORE_SEARCH" };

export function fileManagerReducer(
  state: FileManagerState,
  action: FileManagerAction,
): FileManagerState {
  switch (action.type) {
    case "NAVIGATE_TO_PATH":
      return {
        ...state,
        currentPath: action.path,
        selectedFile: null,
        selectedFiles: new Set(),
        searchQuery: "",
        openFile: null,
        statusNotice: null,
        showContextMenu: null,
        showBackgroundContextMenu: null,
        searchDisplayLimit: SEARCH_DISPLAY_LIMIT,
      };
    case "NAVIGATE_UP":
      return {
        ...state,
        currentPath: state.currentPath.slice(0, -1),
        selectedFile: null,
        selectedFiles: new Set(),
        openFile: null,
        showContextMenu: null,
        showBackgroundContextMenu: null,
      };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    case "SELECT_FILE":
      return { ...state, selectedFile: action.path };
    case "TOGGLE_FILE_SELECTION": {
      const selectedFiles = new Set(state.selectedFiles);
      if (selectedFiles.delete(action.path)) {
        return { ...state, selectedFile: [...selectedFiles].at(-1) ?? null, selectedFiles };
      }
      selectedFiles.add(action.path);
      return { ...state, selectedFile: action.path, selectedFiles };
    }
    case "SET_SELECTED_FILES":
      return { ...state, selectedFiles: action.files };
    case "CLEAR_SELECTION":
      return { ...state, selectedFile: null, selectedFiles: new Set() };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query, searchDisplayLimit: SEARCH_DISPLAY_LIMIT };
    case "SET_DEBOUNCED_SEARCH_QUERY":
      return { ...state, debouncedSearchQuery: action.query };
    case "SET_SORT_BY":
      return { ...state, sortBy: action.by, sortDir: "asc" };
    case "TOGGLE_SORT_DIR":
      return { ...state, sortDir: state.sortDir === "asc" ? "desc" : "asc" };
    case "SHOW_CONTEXT_MENU":
      return {
        ...state,
        showContextMenu: { x: action.x, y: action.y, entry: action.entry },
        showBackgroundContextMenu: null,
      };
    case "HIDE_CONTEXT_MENU":
      return { ...state, showContextMenu: null };
    case "SHOW_BACKGROUND_CONTEXT_MENU":
      return {
        ...state,
        showBackgroundContextMenu: { x: action.x, y: action.y },
        showContextMenu: null,
      };
    case "HIDE_BACKGROUND_CONTEXT_MENU":
      return { ...state, showBackgroundContextMenu: null };
    case "OPEN_FILE":
      return {
        ...state,
        openFile: { path: action.path, entry: action.entry },
        selectedFile: action.entry.path,
        selectedFiles: new Set([action.entry.path]),
        editorNotice: null,
      };
    case "CLOSE_FILE":
      return { ...state, openFile: null };
    case "SET_FILE_DRAFT":
      return { ...state, fileDrafts: { ...state.fileDrafts, [action.key]: action.value } };
    case "INIT_FILE_DRAFT":
      if (state.fileDrafts[action.key] !== undefined) return state;
      return { ...state, fileDrafts: { ...state.fileDrafts, [action.key]: action.value } };
    case "SET_EDITOR_NOTICE":
      return { ...state, editorNotice: action.notice };
    case "SET_STATUS_NOTICE":
      return { ...state, statusNotice: action.notice };
    case "SHOW_NETWORK_DIALOG":
      return { ...state, showNetworkDialog: true };
    case "HIDE_NETWORK_DIALOG":
      return { ...state, showNetworkDialog: false };
    case "SHOW_GOOGLE_DRIVE_DIALOG":
      return { ...state, showGoogleDriveDialog: true };
    case "HIDE_GOOGLE_DRIVE_DIALOG":
      return { ...state, showGoogleDriveDialog: false };
    case "SHOW_USB_DIALOG":
      return { ...state, showUsbDialog: true };
    case "HIDE_USB_DIALOG":
      return { ...state, showUsbDialog: false };
    case "SET_CLIPBOARD":
      return {
        ...state,
        clipboardState: {
          sourcePaths: action.sourcePaths,
          names: action.names,
          operation: action.operation,
        },
      };
    case "CLEAR_CLIPBOARD":
      return { ...state, clipboardState: null };
    case "SET_IS_EMPTYING_TRASH":
      return { ...state, isEmptyingTrash: action.value };
    case "TOGGLE_INCLUDE_HIDDEN":
      return { ...state, includeHidden: !state.includeHidden };
    case "OPEN_CREATE_ENTRY_DIALOG":
      return { ...state, createEntryDialog: { kind: action.kind, name: "", error: null } };
    case "CLOSE_CREATE_ENTRY_DIALOG":
      return { ...state, createEntryDialog: null };
    case "UPDATE_CREATE_ENTRY_DIALOG":
      if (!state.createEntryDialog) return state;
      return { ...state, createEntryDialog: { ...state.createEntryDialog, name: action.name, error: action.error } };
    case "SET_CREATE_ENTRY_ERROR":
      if (!state.createEntryDialog) return state;
      return { ...state, createEntryDialog: { ...state.createEntryDialog, error: action.error } };
    case "OPEN_RENAME_DIALOG":
      return { ...state, renameDialog: { entry: action.entry, name: action.entry.name, error: null } };
    case "CLOSE_RENAME_DIALOG":
      return { ...state, renameDialog: null };
    case "UPDATE_RENAME_DIALOG":
      if (!state.renameDialog) return state;
      return { ...state, renameDialog: { ...state.renameDialog, name: action.name, error: action.error } };
    case "SET_RENAME_ERROR":
      if (!state.renameDialog) return state;
      return { ...state, renameDialog: { ...state.renameDialog, error: action.error } };
    case "OPEN_FILE_INFO_DIALOG":
      return { ...state, fileInfoDialog: action.info };
    case "CLOSE_FILE_INFO_DIALOG":
      return { ...state, fileInfoDialog: null };
    case "SET_PENDING_ENTRY_PATH":
      return { ...state, pendingEntryPath: action.path };
    case "SHOW_EMPTY_TRASH_CONFIRM":
      return { ...state, showEmptyTrashConfirm: true };
    case "HIDE_EMPTY_TRASH_CONFIRM":
      return { ...state, showEmptyTrashConfirm: false };
    case "SET_DRAG_OVER":
      return { ...state, isDragOver: action.value };
    case "TOGGLE_GLOBAL_SEARCH":
      return { ...state, globalSearch: !state.globalSearch, searchDisplayLimit: SEARCH_DISPLAY_LIMIT };
    case "SET_UPLOAD_PROGRESS":
      return { ...state, uploadProgress: { loaded: action.loaded, total: action.total } };
    case "CLEAR_UPLOAD_PROGRESS":
      return { ...state, uploadProgress: null };
    case "SHOW_PASTE_CONFLICT":
      return { ...state, pasteConflict: action.conflict };
    case "HIDE_PASTE_CONFLICT":
      return { ...state, pasteConflict: null };
    case "LOAD_MORE_SEARCH":
      return { ...state, searchDisplayLimit: state.searchDisplayLimit + SEARCH_DISPLAY_LIMIT };
    default:
      return state;
  }
}
