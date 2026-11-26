"use client";

import { AppGridContent } from "@/modules/apps/components/app-grid-content";
import { useAppGridController } from "@/modules/apps/components/app-grid-controller";
import { AppGridContextMenu } from "@/modules/apps/components/app-grid-menu";
import type { AppActionTarget } from "@/modules/apps/components/app-grid-presenters";
import { UninstallAppDialog } from "@/modules/apps/components/uninstall-app-dialog";
import { X } from "@/components/icons/platform-icons";
import { cn } from "@/lib/utils";
export type { AppActionTarget } from "@/modules/apps/components/app-grid-presenters";

type AppGridProps = {
  className?: string;
  mobile?: boolean;
  onBrowseStore?: () => void;
  iconSize?: "small" | "medium" | "large";
  animationsEnabled?: boolean;
  onOpenDashboard?: (target: AppActionTarget) => void;
  onViewLogs?: (target: AppActionTarget) => void;
  onOpenTerminal?: (target: AppActionTarget) => void;
  onOpenSettings?: (target: AppActionTarget) => void;
  onCopyUrl?: (target: AppActionTarget) => void;
};

export function AppGrid({
  className,
  mobile = false,
  onBrowseStore,
  iconSize = "medium",
  animationsEnabled = true,
  onOpenDashboard,
  onViewLogs,
  onOpenTerminal,
  onOpenSettings,
  onCopyUrl,
}: AppGridProps) {
  const controller = useAppGridController({
    onCopyUrl,
    onOpenDashboard,
    onOpenSettings,
    onOpenTerminal,
    onViewLogs,
  });

  return (
    <section
      className={cn("min-h-0 flex-1", mobile ? "flex flex-col overflow-hidden px-[var(--mobile-gutter)]" : "overflow-y-auto px-6 pt-4 pb-6", className)}
      onClick={controller.closeContextMenu}
    >
      {controller.actionError ? (
        <div className="mt-4 flex items-start justify-between gap-2 rounded-lg border border-status-red/30 bg-status-red/10 px-3 py-2 text-xs text-status-red">
          <span>{controller.actionError}</span>
          <button
            onClick={controller.dismissActionError}
            className="mt-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : null}
      <AppGridContent
        mobile={mobile}
        onBrowseStore={onBrowseStore}
        activeAppId={controller.activeAppId}
        activeOperationsCount={controller.activeOperationsCount}
        animationsEnabled={animationsEnabled}
        apps={controller.apps}
        iconSize={iconSize}
        isAppsError={controller.isAppsError}
        isAppsLoading={controller.isAppsLoading}
        onAppContextMenu={controller.openContextMenu}
        onOpenApp={(app) => {
          void controller.openDashboardForApp(app);
        }}
        primaryOperation={controller.primaryOperation}
      />

      {controller.contextMenu && !mobile ? (
        <div
          className="fixed inset-0 z-[219]"
          onClick={controller.closeContextMenu}
        />
      ) : null}

      {controller.contextMenu && controller.menuApp ? (
        <AppGridContextMenu
          app={controller.menuApp}
          hasDashboardUrl={controller.menuHasDashboardUrl}
          isBusy={controller.isMenuAppBusy}
          anchor={controller.contextMenu.anchor}
          opener={controller.contextMenu.opener}
          x={controller.contextMenu.x}
          y={controller.contextMenu.y}
          onClose={mobile ? controller.closeContextMenu : undefined}
          onAction={(action) => {
            void controller.handleMenuAction(action);
          }}
        />
      ) : null}

      <UninstallAppDialog
        open={controller.uninstallDialogOpen}
        appName={controller.uninstallDialogAppName}
        isSubmitting={controller.uninstallDialogSubmitting}
        error={controller.uninstallDialogError}
        onOpenChange={controller.handleUninstallDialogOpenChange}
        onConfirm={controller.confirmUninstall}
      />
    </section>
  );
}
