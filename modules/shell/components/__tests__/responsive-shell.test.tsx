/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopShell } from "@/modules/shell/components/desktop-shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ data: { username: "test" }, isLoading: false, isError: false }), CurrentUserError: class extends Error {} }));
vi.mock("@/modules/shell/hooks/useDesktopAppearance", () => ({ useDesktopAppearance: () => ({ appearance: { animationsEnabled: false, wallpaper: "", dockPosition: "bottom" }, isAppearanceLoaded: true, updateAppearance: vi.fn(), wallpapers: [], accentColors: [], appIconSize: "medium" }) }));
vi.mock("@/modules/shell/hooks/useRebootRecovery", () => ({ useRebootRecovery: () => ({ isHydrated: true, isActive: false }) }));
vi.mock("@/modules/shell/hooks/useServerConnection", () => ({ useServerConnection: () => ({ phase: "online" }) }));
vi.mock("@/modules/apps/hooks/StoreActionsContext", () => ({ StoreActionsProvider: ({ children }: { children: React.ReactNode }) => children, useSharedStoreActions: () => ({}) }));
vi.mock("@/modules/apps/components/app-grid", () => ({ AppGrid: () => <div>Installed apps</div> }));
vi.mock("@/modules/settings/components/settings", () => ({ SettingsPanel: ({ onOpenDiskManager }: { onOpenDiskManager: () => void }) => <><input aria-label="Settings draft" /><button onClick={onOpenDiskManager}>Open disks</button></> }));
vi.mock("@/modules/files/components/file-manager", () => ({ FileManager: () => <input aria-label="File draft" /> }));
vi.mock("@/modules/apps/components/app-store", () => ({ AppStore: () => <div>Store content</div> }));
vi.mock("@/modules/system/components/monitor", () => ({ Monitor: () => null }));
vi.mock("@/modules/system/components/disk-manager", () => ({ DiskManager: () => <div>Disk content</div> }));
vi.mock("@/modules/system/components/status-bar", () => ({ StatusBar: () => <div>Desktop status</div> }));
vi.mock("@/modules/system/components/system-widgets", () => ({ SystemWidgets: () => <div>Desktop widgets</div> }));
vi.mock("@/modules/system/components/update-reminder", () => ({ UpdateReminder: () => null }));
vi.mock("@/modules/apps/components/app-logs-dialog", () => ({ AppLogsDialog: () => null }));
vi.mock("@/modules/shell/components/dock", () => ({ Dock: ({ onItemClick }: { onItemClick: (id: string) => void }) => <button onClick={() => onItemClick("settings")}>Desktop settings</button> }));

let mobile = true;
let notifyMediaChange = () => {};
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: mobile, addEventListener: (_event: string, listener: () => void) => { notifyMediaChange = listener; }, removeEventListener: vi.fn() })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("responsive shell", () => {
  it("shows one mobile screen and returns through nested screens to the launcher", () => {
    mobile = true;
    render(<DesktopShell />);
    expect(screen.getByText("Installed apps")).toBeTruthy();
    expect(screen.queryByText("Desktop widgets")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByText("Installed apps")).toBeNull();
    const draft = screen.getByRole("textbox", { name: "Settings draft" }) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Open disks" }));
    expect(screen.getByText("Disk content")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open disks" })).toBeNull();
    expect(draft.closest('[aria-label="Settings"]')?.getAttribute("inert")).not.toBeNull();
    expect(draft.closest('[aria-label="Settings"]')?.getAttribute("style")).toContain("display: none");
    act(() => { mobile = false; notifyMediaChange(); });
    expect(screen.getByRole("textbox", { name: "Settings draft" })).toBe(draft);
    act(() => { mobile = true; notifyMediaChange(); });
    expect(screen.queryByRole("button", { name: "Open disks" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("button", { name: "Open disks" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Settings draft" })).toBe(draft);
    expect(draft.value).toBe("unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByText("Installed apps")).toBeTruthy();
  });

  it("switches primary tabs without losing state or adding unrelated back steps", () => {
    mobile = true;
    render(<DesktopShell />);
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    const draft = screen.getByRole("textbox", { name: "File draft" }) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Store" }));
    expect(screen.getByText("Store content")).toBeTruthy();
    expect(draft.closest('[aria-label="Files"]')?.getAttribute("inert")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByRole("textbox", { name: "File draft" })).toBe(draft);
    expect(draft.value).toBe("kept");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByText("Installed apps")).toBeTruthy();
    expect(screen.queryByText("Store content")).toBeTruthy(); // mounted, hidden
  });

  it("preserves desktop launcher, dock and window controls", () => {
    mobile = false;
    render(<DesktopShell />);
    expect(screen.getByText("Desktop widgets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desktop settings" }));
    expect(screen.getByText("Installed apps")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });
});
