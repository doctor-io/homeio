"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Save, X } from "@/components/icons/platform-icons";
import type { FileReadResponse } from "@/lib/shared/contracts/files";
import { PreviewBody } from "@/modules/files/components/content/file-manager-open-file-preview";
import {
  FILES_BADGE_SURFACE,
  FILES_PANEL_INSET,
} from "@/modules/files/components/file-manager-surface";
import { getFileIcon, type FileEntry } from "@/modules/files/components/file-manager-presenters";
import React, { useState } from "react";
import type { SetStateAction } from "react";

type OpenFileDialogProps = {
  active: boolean;
  canSaveOpenFile: boolean;
  editorNotice: string | null;
  fileContentErrorMessage: string;
  fileContentIsError: boolean;
  fileContentIsLoading: boolean;
  hasUnsavedChanges: boolean;
  onChangeOpenFileDraft: (value: SetStateAction<string>) => void;
  onClose: () => void;
  onSave: () => void;
  openFile: { entry: FileEntry };
  openFileAssetUrl: string;
  openFileBadgeLabel: string;
  openFileContent: string;
  openFileKey: string | null;
  openFileLanguage: string;
  openFileViewer: FileReadResponse | null;
  showSaveOpenFile: boolean;
};

export function OpenFileDialog({
  active,
  canSaveOpenFile,
  editorNotice,
  fileContentErrorMessage,
  fileContentIsError,
  fileContentIsLoading,
  hasUnsavedChanges,
  onChangeOpenFileDraft,
  onClose,
  onSave,
  openFile,
  openFileAssetUrl,
  openFileBadgeLabel,
  openFileContent,
  openFileKey,
  openFileLanguage,
  openFileViewer,
  showSaveOpenFile,
}: OpenFileDialogProps) {
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const headerEntry =
    openFileViewer && openFile.entry.type === "file"
      ? { ...openFile.entry, ext: openFileViewer.ext ?? openFile.entry.ext }
      : openFile.entry;

  function handleCloseRequest() {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }

  return (
    <>
      <Dialog open={active} onOpenChange={(open) => { if (!open) handleCloseRequest(); }}>
        <DialogContent
          showCloseButton={false}
          aria-label={`Open file ${openFile.entry.name}`}
          className={`h-[min(88vh,920px)] w-[min(96vw,76rem)] max-w-[min(96vw,76rem)] gap-0 overflow-hidden rounded-[calc(var(--radius)+0.5rem)] border-glass-border/70 bg-popover/90 p-0 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:max-w-[min(96vw,76rem)] lg:w-[min(92vw,84rem)] lg:max-w-[min(92vw,84rem)] handheld:top-[calc(env(safe-area-inset-top)+0.5rem)] handheld:flex handheld:h-[min(88dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem))] handheld:w-[calc(100%-var(--mobile-overlay-gutter)*2)] handheld:max-w-3xl handheld:translate-y-0 handheld:flex-col handheld:rounded-2xl handheld:bg-[var(--mobile-panel)] ${FILES_PANEL_INSET}`}
        >
          {/* Accessible title/description (visually hidden) */}
          <DialogTitle className="sr-only">{openFile.entry.name}</DialogTitle>
          <DialogDescription className="sr-only">
            File editor — {openFileBadgeLabel}
          </DialogDescription>

          {/* Window chrome title bar */}
          <div className="flex h-11 shrink-0 select-none items-center gap-0 border-b border-glass-border/50 bg-popover/70 backdrop-blur-2xl handheld:min-h-14 handheld:gap-2 handheld:px-2">
            {/* Traffic lights */}
            <div className="flex items-center gap-1.5 px-4 handheld:px-0">
              <button
                onClick={handleCloseRequest}
                className="group flex size-3 cursor-pointer items-center justify-center rounded-full bg-[#ff5f57] transition-all hover:brightness-110 handheld:size-11 handheld:rounded-xl handheld:bg-[var(--mobile-canvas)] handheld:text-foreground handheld:active:bg-primary/15"
                aria-label="Close"
              >
                <X className="size-[7px] text-[#6a0002] opacity-0 transition-opacity group-hover:opacity-100 handheld:size-5 handheld:text-foreground handheld:opacity-100" />
              </button>
              <span className="size-3 rounded-full bg-white/10 handheld:hidden" />
              <span className="size-3 rounded-full bg-white/10 handheld:hidden" />
            </div>

            {/* Centered file tab */}
            <div className="flex min-w-0 flex-1 items-center justify-center handheld:justify-start">
              <div className="flex min-w-0 items-center gap-2 rounded-[var(--system-radius-control)] border border-glass-border/50 bg-background/35 px-3 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] handheld:border-0 handheld:bg-transparent handheld:px-0 handheld:shadow-none">
                <span className="flex size-4 shrink-0 items-center justify-center text-primary/80">
                  {getFileIcon(headerEntry)}
                </span>
                <span className="min-w-0 max-w-[32ch] truncate text-xs font-medium text-foreground/90">
                  {openFile.entry.name}
                </span>
                {hasUnsavedChanges ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-status-amber"
                    title="Unsaved changes"
                  />
                ) : null}
                <span className={`${FILES_BADGE_SURFACE} px-1.5 py-px text-[10px] uppercase tracking-wider text-primary/70`}>
                  {openFileBadgeLabel}
                </span>
              </div>
            </div>

            {/* Right gutter — balances traffic lights */}
            <div className="hidden w-[76px] items-center justify-end px-4 sm:flex">
              {hasUnsavedChanges ? (
                <span className="text-[11px] tabular-nums text-muted-foreground/40">⌘S</span>
              ) : null}
            </div>
          </div>

          {/* Editor body */}
          <div className="relative min-h-0 flex-1">
            <PreviewBody
              fileContentErrorMessage={fileContentErrorMessage}
              fileContentIsError={fileContentIsError}
              fileContentIsLoading={fileContentIsLoading}
              onChangeOpenFileDraft={onChangeOpenFileDraft}
              onSaveOpenFile={onSave}
              openFile={openFile}
              openFileAssetUrl={openFileAssetUrl}
              openFileContent={openFileContent}
              openFileKey={openFileKey}
              openFileLanguage={openFileLanguage}
              openFileViewer={openFileViewer}
            />

            {/* Floating save button */}
            {showSaveOpenFile && !showDiscardConfirm ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-4">
                <button
                  onClick={onSave}
                  disabled={!canSaveOpenFile}
                  className="system-primary-action pointer-events-auto inline-flex h-9 items-center gap-1.5 px-4 text-sm font-medium transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-0 handheld:h-11"
                >
                  <Save className="size-3.5" />
                  Save
                </button>
              </div>
            ) : null}

            {/* Inline discard confirmation strip */}
            {showDiscardConfirm ? (
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-glass-border/50 bg-popover/90 px-5 py-3 backdrop-blur-xl">
                <p className="text-sm text-foreground/75">
                  Discard changes to{" "}
                  <span className="font-medium text-foreground">{openFile.entry.name}</span>?
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowDiscardConfirm(false)}
                    className="h-8 rounded-[var(--system-radius-control)] border border-glass-border/60 bg-white/5 px-3 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/8 hover:text-foreground handheld:h-11"
                  >
                    Keep editing
                  </button>
                  <button
                    onClick={() => { setShowDiscardConfirm(false); onClose(); }}
                    className="h-8 rounded-[var(--system-radius-control)] border border-status-red/20 bg-status-red/12 px-3 text-xs font-medium text-status-red transition-colors hover:bg-status-red/20 handheld:h-11"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Status bar */}
          {editorNotice && !showDiscardConfirm ? (
            <div className="shrink-0 border-t border-glass-border/50 bg-background/30 px-4 py-2">
              <span className="text-[11px] text-muted-foreground/60">{editorNotice}</span>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
