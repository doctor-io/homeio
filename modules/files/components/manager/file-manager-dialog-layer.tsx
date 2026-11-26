"use client";

import { FileManagerBackgroundContextMenu, FileManagerContextMenu } from "@/modules/files/components/menus/file-manager-overlays";
import { OverlayActivityContext } from "@/components/ui/overlay-activity";
import {
  CreateEntryDialog,
  EmptyTrashConfirmDialog,
  FileInfoDialogOverlay,
  PasteConflictDialog,
  RenameEntryDialog,
  UploadProgressDialog,
} from "@/modules/files/components/dialogs/file-manager-dialogs";
import { NetworkStorageDialog } from "@/modules/files/components/dialogs/network-storage-dialog";
import { GoogleDriveDialog } from "@/modules/files/components/dialogs/google-drive-dialog";
import { UsbStorageDialog } from "@/modules/files/components/dialogs/usb-storage-dialog";
import type { FileInfoResponse } from "@/lib/shared/contracts/files";
import type { FileEntry } from "@/modules/files/components/file-manager-presenters";
import type {
  ClipboardState,
  CreateEntryDialogState,
  PasteConflictState,
  RenameDialogState,
} from "@/modules/files/components/manager/file-manager-state";

type FileManagerDialogLayerProps = {
  active: boolean;
  clipboardState: ClipboardState | null;
  contextShare:
    | {
        id: string;
      }
    | undefined;
  createEntryDialog: CreateEntryDialogState | null;
  fileInfoDialog: FileInfoResponse | null;
  isTrashView: boolean;
  pasteConflict: PasteConflictState | null;
  pastePending: boolean;
  renameDialog: RenameDialogState | null;
  showBackgroundContextMenu: { x: number; y: number } | null;
  showContextMenu: { x: number; y: number; entry: FileEntry } | null;
  showEmptyTrashConfirm: boolean;
  showNetworkDialog: boolean;
  showGoogleDriveDialog: boolean;
  showUsbDialog: boolean;
  trashItemCount: number;
  uploadPending: boolean;
  uploadProgress: { loaded: number; total: number } | null;
  unzipPending: boolean;
  createPending: boolean;
  renamePending: boolean;
  onCloseContextMenu: () => void;
  onCloseBackgroundContextMenu: () => void;
  onOpenCreateEntryDialog: (kind: "file" | "folder") => void;
  onCloseCreateEntryDialog: () => void;
  onChangeCreateEntryDialog: (value: string) => void;
  onSubmitCreateEntryDialog: () => void;
  onCloseRenameDialog: () => void;
  onChangeRenameDialog: (value: string) => void;
  onSubmitRenameDialog: () => void;
  onCancelEmptyTrash: () => void;
  onCancelUpload: () => void;
  onConfirmEmptyTrash: () => void;
  onCloseFileInfoDialog: () => void;
  onConflictResolution: (choice: "replace" | "keep-both" | "skip" | "skip-all") => void;
  onCloseNetworkDialog: () => void;
  onCloseGoogleDriveDialog: () => void;
  onCloseUsbDialog: () => void;
  onNavigateToNetwork: () => void;
  onNavigateToUsb: (path: string[]) => void;
  onCopyContextEntry: () => void;
  onCopyContextPath: () => void;
  onCutContextEntry: () => void;
  onDeleteContextEntry: () => void;
  onDownloadContextEntry: () => void;
  onUnzipContextEntry: () => void;
  onGetInfoContextEntry: () => void;
  onMoveContextEntryToTrash: () => void;
  onOpenContextEntry: () => void;
  onPasteIntoContextEntry: () => void;
  onPasteIntoBackground: () => void;
  onRenameContextEntry: () => void;
  onRestoreContextEntry: () => void;
  onToggleContextShare: () => void;
  onToggleContextStar: () => void;
};

export function FileManagerDialogLayer({
  active,
  clipboardState,
  contextShare,
  createEntryDialog,
  createPending,
  fileInfoDialog,
  isTrashView,
  onCancelEmptyTrash,
  onCancelUpload,
  onChangeCreateEntryDialog,
  onChangeRenameDialog,
  onCloseBackgroundContextMenu,
  onCloseContextMenu,
  onCloseCreateEntryDialog,
  onCloseFileInfoDialog,
  onCloseNetworkDialog,
  onCloseGoogleDriveDialog,
  onCloseUsbDialog,
  onCloseRenameDialog,
  onConfirmEmptyTrash,
  onConflictResolution,
  onCopyContextEntry,
  onCopyContextPath,
  onCutContextEntry,
  onDeleteContextEntry,
  onDownloadContextEntry,
  onUnzipContextEntry,
  onGetInfoContextEntry,
  onMoveContextEntryToTrash,
  onNavigateToNetwork,
  onNavigateToUsb,
  onOpenContextEntry,
  onOpenCreateEntryDialog,
  onPasteIntoBackground,
  onPasteIntoContextEntry,
  onRenameContextEntry,
  onRestoreContextEntry,
  onSubmitCreateEntryDialog,
  onSubmitRenameDialog,
  onToggleContextShare,
  onToggleContextStar,
  pasteConflict,
  pastePending,
  renameDialog,
  renamePending,
  showBackgroundContextMenu,
  showContextMenu,
  showEmptyTrashConfirm,
  showNetworkDialog,
  showGoogleDriveDialog,
  showUsbDialog,
  trashItemCount,
  uploadPending,
  uploadProgress,
  unzipPending,
}: FileManagerDialogLayerProps) {
  return (
    <OverlayActivityContext.Provider value={active}>
      {showContextMenu ? (
        <FileManagerContextMenu
          contextShareActive={Boolean(contextShare)}
          entry={showContextMenu.entry}
          isTrashView={isTrashView}
          pasteDisabled={!clipboardState || isTrashView || pastePending}
          x={showContextMenu.x}
          y={showContextMenu.y}
          onClose={onCloseContextMenu}
          onCopy={onCopyContextEntry}
          onCopyPath={onCopyContextPath}
          onCut={onCutContextEntry}
          onDeletePermanently={onDeleteContextEntry}
          onDownload={onDownloadContextEntry}
          onUnzip={onUnzipContextEntry}
          onGetInfo={onGetInfoContextEntry}
          onMoveToTrash={onMoveContextEntryToTrash}
          onOpen={onOpenContextEntry}
          onPaste={onPasteIntoContextEntry}
          onRename={onRenameContextEntry}
          onRestore={onRestoreContextEntry}
          onToggleShare={onToggleContextShare}
          onToggleStar={onToggleContextStar}
        />
      ) : null}

      {showBackgroundContextMenu ? (
        <FileManagerBackgroundContextMenu
          pasteDisabled={!clipboardState || pastePending}
          x={showBackgroundContextMenu.x}
          y={showBackgroundContextMenu.y}
          onClose={onCloseBackgroundContextMenu}
          onNewFolder={() => onOpenCreateEntryDialog("folder")}
          onNewFile={() => onOpenCreateEntryDialog("file")}
          onPaste={onPasteIntoBackground}
        />
      ) : null}

      {createEntryDialog ? (
        <CreateEntryDialog
          dialog={createEntryDialog}
          isCreatePending={createPending}
          onClose={onCloseCreateEntryDialog}
          onDialogChange={onChangeCreateEntryDialog}
          onSubmit={onSubmitCreateEntryDialog}
        />
      ) : null}

      {renameDialog ? (
        <RenameEntryDialog
          dialog={renameDialog}
          isRenamePending={renamePending}
          onClose={onCloseRenameDialog}
          onDialogChange={onChangeRenameDialog}
          onSubmit={onSubmitRenameDialog}
        />
      ) : null}

      {showEmptyTrashConfirm ? (
        <EmptyTrashConfirmDialog
          itemCount={trashItemCount}
          onCancel={onCancelEmptyTrash}
          onConfirm={onConfirmEmptyTrash}
        />
      ) : null}

      {fileInfoDialog ? (
        <FileInfoDialogOverlay fileInfo={fileInfoDialog} onClose={onCloseFileInfoDialog} />
      ) : null}

      {uploadPending || uploadProgress ? (
        <UploadProgressDialog operation="upload" progress={uploadProgress} onCancel={onCancelUpload} />
      ) : unzipPending ? (
        <UploadProgressDialog operation="unzip" progress={null} />
      ) : null}

      {pasteConflict ? (
        <PasteConflictDialog
          conflictName={pasteConflict.conflictName}
          onReplace={() => onConflictResolution("replace")}
          onKeepBoth={() => onConflictResolution("keep-both")}
          onSkip={() => onConflictResolution("skip")}
          onSkipAll={() => onConflictResolution("skip-all")}
        />
      ) : null}

      <NetworkStorageDialog
        isOpen={showNetworkDialog}
        onClose={onCloseNetworkDialog}
        onNavigateToNetwork={onNavigateToNetwork}
      />

      <GoogleDriveDialog
        isOpen={showGoogleDriveDialog}
        onClose={onCloseGoogleDriveDialog}
      />

      <UsbStorageDialog
        isOpen={showUsbDialog}
        onClose={onCloseUsbDialog}
        onNavigateToUsb={(path) => { onNavigateToUsb(path); onCloseUsbDialog(); }}
      />
    </OverlayActivityContext.Provider>
  );
}
