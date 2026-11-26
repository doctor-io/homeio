import { render } from "@testing-library/react";
import { vi } from "vitest";
import { FileManager } from "@/modules/files/components/file-manager";
export const fileManagerElement = (keyboardEnabled = true) => <FileManager keyboardEnabled={keyboardEnabled} />;

export const mockUseFilesDirectory = vi.fn();
export const mockUseFileContent = vi.fn();
export const mockUseSaveFileContent = vi.fn();
export const mockUseCreateFolder = vi.fn();
export const mockUseCreateFile = vi.fn();
export const mockUsePasteFileEntry = vi.fn();
export const mockUseRenameFileEntry = vi.fn();
export const mockUseFileEntryInfo = vi.fn();
export const mockUseToggleFileStar = vi.fn();
export const mockUseStarredFiles = vi.fn();
export const mockUseFilesRoot = vi.fn();
export const mockUseSearchFiles = vi.fn();
export const mockUseUploadFiles = vi.fn();
export const mockUseMoveToTrash = vi.fn();
export const mockUseRestoreFromTrash = vi.fn();
export const mockUseDeleteFromTrash = vi.fn();
export const mockUseEmptyTrash = vi.fn();
export const mockUseNetworkShares = vi.fn();
export const mockUseLocalFolderShares = vi.fn();
export const mockUseCreateLocalFolderShare = vi.fn();
export const mockUseDeleteLocalFolderShare = vi.fn();
export const mockUseSystemMetrics = vi.fn();
export const mockUseCurrentUser = vi.fn();
export const mockUseUsbDrives = vi.fn();
export const mockUseGoogleDriveConnections = vi.fn();
export const mockUseUnzipFile = vi.fn();

vi.mock("@/modules/files/hooks/useFiles", () => ({
  buildAssetUrl: (filePath: string) => `/api/v1/files/asset?path=${encodeURIComponent(filePath)}`,
  buildDownloadUrl: (filePath: string) => `/api/v1/files/download?path=${encodeURIComponent(filePath)}`,
  toFilePath: (segments: string[]) => segments.join("/"),
  useFilesRoot: (...args: unknown[]) => mockUseFilesRoot(...args),
  useFilesDirectory: (...args: unknown[]) => mockUseFilesDirectory(...args),
  useFileContent: (...args: unknown[]) => mockUseFileContent(...args),
  useSaveFileContent: (...args: unknown[]) => mockUseSaveFileContent(...args),
  useCreateFolder: (...args: unknown[]) => mockUseCreateFolder(...args),
  useCreateFile: (...args: unknown[]) => mockUseCreateFile(...args),
  usePasteFileEntry: (...args: unknown[]) => mockUsePasteFileEntry(...args),
  useRenameFileEntry: (...args: unknown[]) => mockUseRenameFileEntry(...args),
  useFileEntryInfo: (...args: unknown[]) => mockUseFileEntryInfo(...args),
  useToggleFileStar: (...args: unknown[]) => mockUseToggleFileStar(...args),
  useStarredFiles: (...args: unknown[]) => mockUseStarredFiles(...args),
  useSearchFiles: (...args: unknown[]) => mockUseSearchFiles(...args),
  useUploadFiles: (...args: unknown[]) => mockUseUploadFiles(...args),
  useUnzipFile: (...args: unknown[]) => mockUseUnzipFile(...args),
}));

vi.mock("@/modules/files/hooks/useTrashActions", () => ({
  useMoveToTrash: (...args: unknown[]) => mockUseMoveToTrash(...args),
  useRestoreFromTrash: (...args: unknown[]) => mockUseRestoreFromTrash(...args),
  useDeleteFromTrash: (...args: unknown[]) => mockUseDeleteFromTrash(...args),
  useEmptyTrash: (...args: unknown[]) => mockUseEmptyTrash(...args),
}));

vi.mock("@/modules/files/hooks/useNetworkShares", () => ({
  useNetworkShares: (...args: unknown[]) => mockUseNetworkShares(...args),
}));

vi.mock("@/modules/system/hooks/useSystemMetrics", () => ({
  useSystemMetrics: (...args: unknown[]) => mockUseSystemMetrics(...args),
}));

vi.mock("@/modules/files/hooks/useUsbDrives", () => ({
  useUsbDrives: (...args: unknown[]) => mockUseUsbDrives(...args),
}));

vi.mock("@/modules/files/hooks/useGoogleDrive", () => ({
  useGoogleDriveConnections: (...args: unknown[]) => mockUseGoogleDriveConnections(...args),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: (...args: unknown[]) => mockUseCurrentUser(...args),
}));

vi.mock("@/modules/files/hooks/useLocalFolderShares", () => ({
  useLocalFolderShares: (...args: unknown[]) => mockUseLocalFolderShares(...args),
  useCreateLocalFolderShare: (...args: unknown[]) => mockUseCreateLocalFolderShare(...args),
  useDeleteLocalFolderShare: (...args: unknown[]) => mockUseDeleteLocalFolderShare(...args),
}));

vi.mock("@/modules/files/components/dialogs/network-storage-dialog", () => ({
  NetworkStorageDialog: () => null,
}));

vi.mock("@/modules/files/components/dialogs/google-drive-dialog", () => ({
  GoogleDriveDialog: () => null,
}));

vi.mock("@/modules/files/components/dialogs/usb-storage-dialog", () => ({
  UsbStorageDialog: () => null,
}));

export function renderFileManager() {
  return Promise.resolve(render(<FileManager />));
}

export function mockDirectory(entries: Array<{ name: string; path: string; type: "folder" | "file" }>) {
  return {
    data: {
      entries: entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
        ext: null,
        sizeBytes: entry.type === "file" ? 0 : null,
        modifiedAt: "2026-02-27T00:00:00.000Z",
        mtimeMs: 1234,
      })),
    },
    isLoading: false,
    isError: false,
    error: null,
  };
}

export function resetFileManagerMocks() {
  mockUseFilesDirectory.mockReset();
  mockUseFileContent.mockReset();
  mockUseSaveFileContent.mockReset();
  mockUseCreateFolder.mockReset();
  mockUseCreateFile.mockReset();
  mockUsePasteFileEntry.mockReset();
  mockUseRenameFileEntry.mockReset();
  mockUseFileEntryInfo.mockReset();
  mockUseToggleFileStar.mockReset();
  mockUseStarredFiles.mockReset();
  mockUseFilesRoot.mockReset();
  mockUseSearchFiles.mockReset();
  mockUseUploadFiles.mockReset();
  mockUseMoveToTrash.mockReset();
  mockUseRestoreFromTrash.mockReset();
  mockUseDeleteFromTrash.mockReset();
  mockUseEmptyTrash.mockReset();
  mockUseNetworkShares.mockReset();
  mockUseLocalFolderShares.mockReset();
  mockUseCreateLocalFolderShare.mockReset();
  mockUseDeleteLocalFolderShare.mockReset();
  mockUseSystemMetrics.mockReset();
  mockUseCurrentUser.mockReset();
  mockUseUsbDrives.mockReset();
  mockUseGoogleDriveConnections.mockReset();
  mockUseUnzipFile.mockReset();

  mockUseFilesDirectory.mockReturnValue(mockDirectory([]));
  mockUseFilesRoot.mockReturnValue({
    data: { rootPath: "/DATA", effectiveUid: 1000, effectiveGid: 1000, writable: true },
    isLoading: false,
    isError: false,
    error: null,
  });
  mockUseFileContent.mockReturnValue({ data: null, isLoading: false, isError: false, error: null });
  mockUseSaveFileContent.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseCreateFolder.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ root: "/DATA", path: "Documents/New Folder", type: "folder" }),
    isPending: false,
  });
  mockUseCreateFile.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ root: "/DATA", path: "Documents/New File.txt", type: "file" }),
    isPending: false,
  });
  mockUsePasteFileEntry.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ root: "/DATA", path: "Documents/FolderToShare", type: "folder" }),
    isPending: false,
  });
  mockUseRenameFileEntry.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseFileEntryInfo.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseToggleFileStar.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseStarredFiles.mockReturnValue({ data: [], isLoading: false, isError: false, error: null });
  mockUseMoveToTrash.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseRestoreFromTrash.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseDeleteFromTrash.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseEmptyTrash.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ deletedCount: 2 }),
    isPending: false,
  });
  mockUseNetworkShares.mockReturnValue({ data: [], isLoading: false, isError: false, error: null });
  mockUseSystemMetrics.mockReturnValue({
    data: {
      storage: {
        mountPath: "/DATA",
        totalBytes: 4 * 1024 ** 4,
        availableBytes: 2.2 * 1024 ** 4,
        usedBytes: 1.8 * 1024 ** 4,
        usedPercent: 45,
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  });
  mockUseCurrentUser.mockReturnValue({
    data: {
      id: "user-1",
      username: "admin",
      isDemoMode: false,
    },
    isLoading: false,
    isError: false,
    error: null,
  });
  mockUseUsbDrives.mockReturnValue({
    drives: [],
    mount: vi.fn(),
    unmount: vi.fn(),
    eject: vi.fn(),
    isMounting: false,
    isUnmounting: false,
    isEjecting: false,
  });
  mockUseGoogleDriveConnections.mockReturnValue({ data: { connections: [], configured: true }, isLoading: false, isError: false, error: null });
  mockUseLocalFolderShares.mockReturnValue({ data: [], isLoading: false, isError: false, error: null });
  mockUseCreateLocalFolderShare.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({
      id: "local-1",
      shareName: "FolderToShare",
      sourcePath: "FolderToShare",
      sharedPath: "Shared/FolderToShare",
      isMounted: true,
      isExported: true,
    }),
  });
  mockUseDeleteLocalFolderShare.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ removed: true, id: "local-1" }),
  });
  mockUseUploadFiles.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseUnzipFile.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseSearchFiles.mockReturnValue({
    data: { entries: [] },
    isLoading: false,
    isError: false,
    error: null,
  });
}
