// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Container } from "@/components/icons/platform-icons";
import { AppGridContent } from "@/modules/apps/components/app-grid-content";
import type { AppItem } from "@/modules/apps/components/app-grid-presenters";

const app: AppItem = {
  id: "example", name: "Example", icon: Container, logoUrl: null,
  color: "", bgColor: "", status: "running", category: "Apps",
  webUiPort: null, webUiUrl: null, containerName: "example", updateAvailable: false,
};

describe("AppGridContent", () => {
  beforeEach(() => localStorage.clear());
  it("shows mobile rows with full names, status and separate actions", () => {
    const onOpenApp = vi.fn();
    const onAppContextMenu = vi.fn();
    const longNameApp = { ...app, name: "Example app with a very long name" };
    render(<AppGridContent mobile activeAppId={null} activeOperationsCount={0} animationsEnabled={false}
      apps={[longNameApp]} iconSize="medium" isAppsError={false} isAppsLoading={false}
      onAppContextMenu={onAppContextMenu} onOpenApp={onOpenApp} primaryOperation={null} />);
    expect(screen.getByText(longNameApp.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(within(screen.getByRole("button", { name: `Open ${longNameApp.name} (Running)` })).getByText("Running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${longNameApp.name}` }));
    expect(onAppContextMenu).toHaveBeenCalledOnce();
    expect(onOpenApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Open ${longNameApp.name} (Running)` }));
    expect(onOpenApp).toHaveBeenCalledWith(longNameApp);
  });

  it("uses optimistic managed status for the running count and indicator", () => {
    const running = { condition: "running" as const, exitCode: null };
    const apps: AppItem[] = [
      app,
      { ...app, id: "stopped", name: "Stopped app", status: "stopped", condition: running },
      { ...app, id: "restarting", name: "Restarting app", status: "updating", condition: running },
      { ...app, id: "external", name: "External app", status: "unmanaged", condition: running },
      { ...app, id: "unknown", name: "Unknown app", status: "unmanaged" },
    ];
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 358, height: 562 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    });
    try {
      render(<AppGridContent mobile activeAppId={null} activeOperationsCount={0} animationsEnabled={false}
        apps={apps} iconSize="medium" isAppsError={false} isAppsLoading={false}
        onAppContextMenu={vi.fn()} onOpenApp={vi.fn()} primaryOperation={null} />);
      const activity = screen.getByRole("region", { name: "App activity" });
      expect(within(activity).getByText("of 5")).toBeTruthy();
      expect(within(activity).getByText("2")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Open Stopped app/ }).querySelector("[data-running-indicator]")).toBeNull();
      expect(screen.getByRole("button", { name: /Open Restarting app/ }).querySelector("[data-running-indicator]")).toBeNull();
      expect(screen.getByRole("button", { name: /Open External app/ }).querySelector("[data-running-indicator]")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });


  it("paginates the mobile grid and persists the optional list", () => {
    const apps = Array.from({ length: 14 }, (_, index) => ({ ...app, id: `${index}`, name: `App ${index}` }));
    const props = { mobile: true, activeAppId: null, activeOperationsCount: 0, animationsEnabled: false, apps, iconSize: "medium" as const, isAppsError: false, isAppsLoading: false, onAppContextMenu: vi.fn(), onOpenApp: vi.fn(), primaryOperation: null };
    const { unmount } = render(<AppGridContent {...props} />);
    expect(screen.getByRole("button", { name: "App page 1" }).getAttribute("aria-current")).toBe("page");
    const OriginalPointerEvent = window.PointerEvent;
    class TestPointerEvent extends MouseEvent { pointerType: string; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ""; } }
    window.PointerEvent = TestPointerEvent as typeof PointerEvent;
    const gridButton = screen.getByRole("button", { name: "Open App 0 (Running)" });
    fireEvent.pointerDown(gridButton, { pointerType: "touch", clientX: 200, clientY: 20 });
    fireEvent.pointerMove(gridButton, { pointerType: "touch", clientX: 100, clientY: 20 });
    fireEvent.pointerUp(gridButton, { pointerType: "touch", clientX: 100, clientY: 20 });
    window.PointerEvent = OriginalPointerEvent;
    expect(screen.getByText("App 12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "App page 1" }));
    expect(screen.getByText("App 0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("App 0")).toBeTruthy();
    unmount();
    render(<AppGridContent {...props} />);
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens actions on hold without opening the app, and cancels a moving touch", () => {
    vi.useFakeTimers();
    const OriginalPointerEvent = window.PointerEvent;
    class TestPointerEvent extends MouseEvent { pointerType: string; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ""; } }
    window.PointerEvent = TestPointerEvent as typeof PointerEvent;
    const onOpenApp = vi.fn();
    const onAppContextMenu = vi.fn();
    const { unmount } = render(<AppGridContent mobile activeAppId={null} activeOperationsCount={0} animationsEnabled={false}
      apps={[app]} iconSize="medium" isAppsError={false} isAppsLoading={false}
      onAppContextMenu={onAppContextMenu} onOpenApp={onOpenApp} primaryOperation={null} />);
    const button = screen.getByRole("button", { name: "Open Example (Running)" });
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.contextMenu(button);
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(onAppContextMenu).toHaveBeenCalledOnce();
    expect(onOpenApp).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 50, clientY: 20 });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(onAppContextMenu).toHaveBeenCalledOnce();
    expect(onOpenApp).not.toHaveBeenCalled();
    unmount();
    window.PointerEvent = OriginalPointerEvent;
    vi.useRealTimers();
  });

  it("offers the store for an empty mobile list", () => {
    const onBrowseStore = vi.fn();
    render(<AppGridContent mobile onBrowseStore={onBrowseStore} activeAppId={null} activeOperationsCount={0}
      animationsEnabled={false} apps={[]} iconSize="medium" isAppsError={false} isAppsLoading={false}
      onAppContextMenu={vi.fn()} onOpenApp={vi.fn()} primaryOperation={null} />);
    expect(screen.getByText("No apps installed yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Browse Store" }));
    expect(onBrowseStore).toHaveBeenCalledOnce();
  });

  it("opens the app independently from its touch action button and right-click menu", () => {
    const onOpenApp = vi.fn();
    const onAppContextMenu = vi.fn();
    render(<AppGridContent activeAppId={null} activeOperationsCount={0} animationsEnabled={false}
      apps={[app]} iconSize="medium" isAppsError={false} isAppsLoading={false}
      onAppContextMenu={onAppContextMenu} onOpenApp={onOpenApp} primaryOperation={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Example", hidden: true }));
    expect(onAppContextMenu).toHaveBeenCalledOnce();
    expect(onOpenApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open Example" }));
    expect(onOpenApp).toHaveBeenCalledWith(app);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Open Example" }));
    expect(onAppContextMenu).toHaveBeenCalledTimes(2);
  });
});
