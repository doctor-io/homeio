"use client";

import { Cloud, HardDrive, Plus } from "@/components/icons/platform-icons";
import { OsIcon } from "@/components/icons/OsIcon";
import { DEVICE_ICONS, FILE_SIDEBAR_ICONS } from "@/components/icons/icon-assets";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { normalizePathForBackend } from "@/modules/files/components/file-manager-presenters";
import { FILES_MENU_SHELL, FILES_PANEL_SHELL } from "@/modules/files/components/file-manager-surface";
import { Users, Trash2, EjectIcon } from "@/components/icons/platform-icons";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { FEATURE_FLAGS } from "@/lib/shared/feature-flags";

export type FileManagerSidebarItem = {
  name: string;
  icon: ReactNode;
  path: string[];
};

export type RemovableSidebarItem = FileManagerSidebarItem & {
  driveId: string;
  isMounted: boolean;
};

export type FileManagerSidebarSection = {
  title: string;
  items: FileManagerSidebarItem[];
};

export type CloudSidebarItem = FileManagerSidebarItem & { accountEmail: string };

type SidebarProps = {
  /** Whether the user opened the places list while the panel is narrow. */
  sidebarOpen?: boolean;
  currentPath: string[];
  isSharedView: boolean;
  isTrashView: boolean;
  locationItems: FileManagerSidebarItem[];
  cloudItems: CloudSidebarItem[];
  removableItems: RemovableSidebarItem[];
  sidebarSections: FileManagerSidebarSection[];
  storageUsagePercent: number;
  storageUsageText: string;
  onNavigateToPath: (path: string[]) => void;
  onOpenNetworkDialog: () => void;
  onOpenGoogleDriveDialog: () => void;
  onOpenUsbDialog: () => void;
  onMountDrive: (driveId: string) => void;
  onEjectDrive: (driveId: string) => void;
};

function isPathActive(itemPath: string[], currentPath: string[]): boolean {
  return JSON.stringify(normalizePathForBackend(itemPath)) === JSON.stringify(currentPath);
}

export function FileManagerSidebar({
  sidebarOpen = false,
  currentPath,
  isSharedView,
  isTrashView,
  locationItems,
  cloudItems,
  removableItems,
  sidebarSections,
  storageUsagePercent,
  storageUsageText,
  onNavigateToPath,
  onOpenNetworkDialog,
  onOpenGoogleDriveDialog,
  onOpenUsbDialog,
  onMountDrive,
  onEjectDrive,
}: SidebarProps) {
  const currentUserQuery = useCurrentUser();
  const isDemoMode = currentUserQuery.data?.isDemoMode ?? false;
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [addMenuOpen]);

  return (
    <aside
      className={cn(
        "m-2 flex-col",
        // Narrow: only here when asked for, and then it takes the panel.
        sidebarOpen ? "flex w-full" : "hidden",
        // Wide: always a fixed column beside the files.
        "@2xl/files:flex @2xl/files:w-60 @2xl/files:shrink-0",
        FILES_PANEL_SHELL,
      )}
    >
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        {sidebarSections.map((section) => {
          const isCloud = section.title === "Cloud";
          const items =
            section.title === "Locations" ? locationItems : isCloud ? cloudItems : section.items;
          if (isCloud && cloudItems.length === 0) return null;
          return (
            <div key={section.title} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between px-3">
                <span className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
                  {section.title}
                </span>
                {section.title === "Locations" && !isDemoMode && (
                  <div ref={addMenuRef} className="relative">
                    <button
                      onClick={() => setAddMenuOpen((v) => !v)}
                      title="Add location"
                      aria-label="Add location"
                      className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-background/60 hover:text-foreground"
                    >
                      <Plus className="size-3" />
                    </button>
                    {addMenuOpen && (
                      <div className={cn("absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden py-1", FILES_MENU_SHELL)}>
                        <button
                          onClick={() => { setAddMenuOpen(false); onOpenNetworkDialog(); }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                        >
                          <OsIcon
                            src={FILE_SIDEBAR_ICONS.networkStorage}
                            className="size-4 shrink-0 object-contain"
                            fallback={<HardDrive className="size-3.5 shrink-0 text-muted-foreground/60" />}
                          />
                          Network Storage
                        </button>
                        <button
                          onClick={() => { setAddMenuOpen(false); onOpenUsbDialog(); }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                        >
                          <OsIcon
                            src={DEVICE_ICONS.usb}
                            className="size-4 shrink-0 object-contain"
                            fallback={<HardDrive className="size-3.5 shrink-0 text-amber-400/70" />}
                          />
                          USB Drives
                        </button>
                        {FEATURE_FLAGS.GOOGLE_DRIVE && (
                          <button
                            onClick={() => { setAddMenuOpen(false); onOpenGoogleDriveDialog(); }}
                            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                          >
                            <OsIcon
                              src={FILE_SIDEBAR_ICONS.googleDrive}
                              className="size-4 shrink-0 object-contain"
                              fallback={<Cloud className="size-3.5 shrink-0 text-sky-400/70" />}
                            />
                            Google Drive
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const isActive = isPathActive(item.path, currentPath);
                  return (
                    <button
                      key={item.name}
                      onClick={() => onNavigateToPath(item.path)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                        isActive
                          ? "bg-primary/15 text-foreground"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                      )}
                    >
                      <span className={cn("size-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/70")}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate text-left text-sm font-medium leading-5">{item.name}</span>
                    </button>
                  );
                })}

                {section.title === "Locations" && removableItems.length > 0 && (
                  <>
                    <div className="mb-1 mt-2.5 px-3 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/55">
                      Removable
                    </div>
                    {removableItems.map((item) => {
                      const isActive = item.isMounted && isPathActive(item.path, currentPath);
                      return (
                        <div key={item.driveId} className="flex items-center gap-0.5">
                          <button
                            onClick={() => item.isMounted ? onNavigateToPath(item.path) : onMountDrive(item.driveId)}
                            className={cn(
                              "flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                              isActive
                                ? "bg-primary/15 text-foreground"
                                : item.isMounted
                                  ? "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                                  : "text-muted-foreground/40 hover:text-muted-foreground",
                            )}
                          >
                            <span className={cn("size-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/55")}>
                              {item.icon}
                            </span>
                            <span className="flex-1 truncate text-left text-sm font-medium leading-5">{item.name}</span>
                            {!item.isMounted && (
                              <span className="ml-auto shrink-0 text-3xs text-muted-foreground/40">mount</span>
                            )}
                          </button>
                          {item.isMounted && (
                            <button
                              onClick={() => onEjectDrive(item.driveId)}
                              title="Eject"
                              className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-background/50 hover:text-foreground"
                            >
                              <EjectIcon className="size-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-glass-border/60 px-4 py-3.5">
        <div className="mb-3 flex flex-col gap-0.5">
          <button
            onClick={() => onNavigateToPath(["Shared"])}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              isSharedView
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <OsIcon
              src={FILE_SIDEBAR_ICONS.shared}
              className="size-5 shrink-0 object-contain"
              fallback={<Users className={cn("size-4 shrink-0", isSharedView ? "text-primary" : "text-sky-400/70")} />}
            />
            <span className="text-sm font-medium leading-5">Shared</span>
          </button>
          <button
            onClick={() => onNavigateToPath(["Trash"])}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              isTrashView
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <OsIcon
              src={FILE_SIDEBAR_ICONS.trash}
              className="size-5 shrink-0 object-contain"
              fallback={<Trash2 className={cn("size-4 shrink-0", isTrashView ? "text-primary" : "text-status-red/60")} />}
            />
            <span className="text-sm font-medium leading-5">Trash</span>
          </button>
        </div>

        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground/75">Storage</span>
          <span className="text-xs text-muted-foreground/60">{storageUsageText}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-background/65">
          <div
            className="h-full rounded-full bg-primary/70 transition-all duration-300"
            style={{ width: `${storageUsagePercent}%` }}
          />
        </div>
      </div>
    </aside>
  );
}
