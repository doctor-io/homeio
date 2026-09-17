/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockReadAppearanceSettings } = vi.hoisted(() => ({
  mockReadAppearanceSettings: vi.fn(),
}));

vi.mock("@/components/auth/login-form", () => ({
  LoginForm: () => <div>LoginFormStub</div>,
}));

vi.mock("@/lib/server/modules/settings/appearance-repository", () => ({
  readAppearanceSettings: mockReadAppearanceSettings,
}));

// Deliberately a different wallpaper from the stored one. The client hook is
// what the page used to rely on, and on /login it always answers with the
// default because its fetch has no session to authenticate with. If this value
// ever reaches the shell again, the bug is back.
vi.mock("@/modules/shell/hooks/useResolvedWallpaper", () => ({
  useResolvedWallpaper: () => ({
    wallpaper: "/images/1.jpg",
    isHydrated: true,
  }),
}));

import LoginPage from "@/app/login/page";

function wallpaperOf() {
  return (screen.getByTestId("full-screen-wallpaper") as HTMLDivElement).style
    .backgroundImage;
}

describe("LoginPage", () => {
  it("renders inside the shared full-screen shell", async () => {
    mockReadAppearanceSettings.mockResolvedValueOnce({
      wallpaper: "/images/12.jpg",
    });

    render(await LoginPage());

    expect(screen.getByText("LoginFormStub")).toBeTruthy();
    expect(screen.getByTestId("full-screen-clock")).toBeTruthy();
  });

  it("draws the stored wallpaper, not the one the signed-out client would read", async () => {
    mockReadAppearanceSettings.mockResolvedValueOnce({
      wallpaper: "/images/12.jpg",
    });

    render(await LoginPage());

    expect(wallpaperOf()).toContain("/images/12.jpg");
    expect(wallpaperOf()).not.toContain("/images/1.jpg");
  });
});
