/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockReadAppearanceSettings } = vi.hoisted(() => ({
  mockReadAppearanceSettings: vi.fn(),
}));

vi.mock("@/components/auth/register-form", () => ({
  RegisterForm: () => <div>RegisterFormStub</div>,
}));

vi.mock("@/lib/server/modules/settings/appearance-repository", () => ({
  readAppearanceSettings: mockReadAppearanceSettings,
}));

// See the note in the /login test: this is what the signed-out client hook
// answers, and it must not be what the page draws.
vi.mock("@/modules/shell/hooks/useResolvedWallpaper", () => ({
  useResolvedWallpaper: () => ({
    wallpaper: "/images/1.jpg",
    isHydrated: true,
  }),
}));

import RegisterPage from "@/app/register/page";

function wallpaperOf() {
  return (screen.getByTestId("full-screen-wallpaper") as HTMLDivElement).style
    .backgroundImage;
}

describe("RegisterPage", () => {
  it("renders inside the shared full-screen shell", async () => {
    mockReadAppearanceSettings.mockResolvedValueOnce({
      wallpaper: "/images/14.jpg",
    });

    render(await RegisterPage());

    expect(screen.getByText("RegisterFormStub")).toBeTruthy();
    expect(screen.getByTestId("full-screen-clock")).toBeTruthy();
  });

  it("draws the stored wallpaper, not the one the signed-out client would read", async () => {
    mockReadAppearanceSettings.mockResolvedValueOnce({
      wallpaper: "/images/14.jpg",
    });

    render(await RegisterPage());

    expect(wallpaperOf()).toContain("/images/14.jpg");
    expect(wallpaperOf()).not.toContain("/images/1.jpg");
  });
});
