import { describe, expect, it } from "vitest";
import {
  getAppVisualState,
  type AppItem,
} from "@/modules/apps/components/app-grid-presenters";

function appWith(status: AppItem["status"]): AppItem {
  return {
    id: "demo",
    name: "Demo",
    icon: () => null,
    logoUrl: null,
    color: "text-white",
    bgColor: "bg-black",
    status,
    category: "Other",
    webUiPort: null,
    webUiUrl: null,
    containerName: null,
    updateAvailable: false,
  };
}

describe("getAppVisualState", () => {
  // Nothing here may stamp a glyph over the artwork: the icon set renders as
  // coloured <img> SVGs, so a badge cannot take a state's colour, and at badge
  // size the detail is unreadable. Status lives in dimming and a CSS dot.
  it("never returns a badge for any state", () => {
    for (const status of [
      "running",
      "updating",
      "partial",
      "paused",
      "stopped",
      "unknown",
    ] as const) {
      expect(getAppVisualState(appWith(status))).not.toHaveProperty("badgeIcon");
    }
  });

  it("shows a stopped app as dimmed, with no alarm and no motion", () => {
    const state = getAppVisualState(appWith("stopped"));

    const classes = [
      state.containerClass,
      state.ringClass,
      state.dotClass,
      state.dotInnerClass,
      state.imageClass,
    ].join(" ");

    expect(classes).not.toMatch(/status-red/);
    expect(classes).not.toMatch(/animate-/);
    expect(state.imageClass).toMatch(/grayscale/);
    expect(state.title).toBe("Stopped");
  });

  it("marks an unknown status with a muted dot rather than an alarm", () => {
    const state = getAppVisualState(appWith("unknown"));

    expect(state.dotClass).toMatch(/muted-foreground/);
    expect(
      [state.containerClass, state.ringClass, state.dotInnerClass].join(" "),
    ).not.toMatch(/status-red|status-amber|animate-/);
  });

  it("keeps paused calm — deliberate, so no alert colour and no motion", () => {
    const state = getAppVisualState(appWith("paused"));

    const classes = [
      state.containerClass,
      state.ringClass,
      state.dotClass,
      state.dotInnerClass,
    ].join(" ");

    expect(classes).not.toMatch(/status-red|status-amber/);
    expect(classes).not.toMatch(/animate-/);
    expect(state.title).toBe("Paused");
  });

  it("keeps degraded amber but stops it pulsing", () => {
    const state = getAppVisualState(appWith("partial"));

    // Degraded is the one state that warrants attention, so the colour stays.
    expect(state.dotClass).toMatch(/status-amber/);
    expect([state.containerClass, state.dotInnerClass].join(" ")).not.toMatch(
      /animate-/,
    );
  });

  it("carries the dot colour separately from its animation", () => {
    // The colour is the status marker; the animation is decoration. Turning
    // animations off must not remove the marker.
    for (const status of ["updating", "partial", "paused", "unknown"] as const) {
      const state = getAppVisualState(appWith(status));
      expect(state.dotClass).not.toBe("");
      expect(state.dotClass).not.toMatch(/animate-/);
    }
  });

  it("leaves a running app unmarked", () => {
    const state = getAppVisualState(appWith("running"));

    expect(state.imageClass).toBe("");
    expect(state.dotClass).toBe("");
    expect(state.title).toBe("Running");
  });
});
