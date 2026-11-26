/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE_SETTINGS } from "@/lib/desktop/appearance";
import { useDesktopAppearance } from "@/modules/shell/hooks/useDesktopAppearance";

vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));
vi.mock("@/lib/desktop/wallpaper-color", () => ({ extractWallpaperColor: () => Promise.resolve(null) }));

beforeEach(() => {
  document.documentElement.className = "";
});

it("uses the system theme on mobile when no theme is saved and follows OS changes", async () => {
  let isDark = false;
  let onChange: (() => void) | undefined;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query.includes("prefers-color-scheme") ? isDark : true; },
    addEventListener: (_: string, listener: () => void) => { onChange = listener; },
    removeEventListener: () => {},
  }));
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: DEFAULT_APPEARANCE_SETTINGS, hasSavedTheme: false })));
  const client = new QueryClient();
  const { result, unmount } = renderHook(() => useDesktopAppearance(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.isAppearanceLoaded).toBe(true));
  expect(result.current.appearance.theme).toBe("system");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  isDark = true;
  act(() => onChange?.());
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  unmount();
  vi.unstubAllGlobals();
});

it("keeps an explicitly saved dark theme on mobile", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: DEFAULT_APPEARANCE_SETTINGS, hasSavedTheme: true })));
  const client = new QueryClient();
  const { result, unmount } = renderHook(() => useDesktopAppearance(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.isAppearanceLoaded).toBe(true));
  expect(result.current.appearance.theme).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  unmount();
  vi.unstubAllGlobals();
});
