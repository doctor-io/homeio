// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";

describe("useDesktopPreferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("brings other callers up to date when one of them changes a preference", async () => {
    const settings = renderHook(() => useDesktopPreferences());
    const statusBar = renderHook(() => useDesktopPreferences());
    await waitFor(() => expect(statusBar.result.current.isHydrated).toBe(true));

    act(() => settings.result.current.setTimeFormat("24h"));

    await waitFor(() => expect(statusBar.result.current.preferences.timeFormat).toBe("24h"));
  });
});
