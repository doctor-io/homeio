/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopTour } from "@/modules/shell/components/desktop-tour";

function anchors(labels: string[]) {
  document.body.innerHTML = labels
    .map((label) =>
      label === "apps"
        ? `<div data-tour="apps">grid</div>`
        : `<button aria-label="${label}">${label}</button>`,
    )
    .join("");
}

describe("DesktopTour", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("walks the interface itself, one anchor at a time", () => {
    anchors(["apps", "App Store", "Files", "Settings"]);
    render(<DesktopTour open onClose={vi.fn()} />);

    expect(screen.getByText("Everything running, in one place")).toBeTruthy();

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Install from the store")).toBeTruthy();
  });

  it("skips a stop whose anchor is not on screen", () => {
    // A server with the file manager hidden should not get a bubble pointing
    // at nothing.
    anchors(["apps", "Settings"]);
    render(<DesktopTour open onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("The rest lives in Settings")).toBeTruthy();
  });

  it("remembers it was seen, so it does not greet the same person twice", () => {
    anchors(["apps"]);
    const onClose = vi.fn();
    render(<DesktopTour open onClose={onClose} />);

    // A single stop makes the first button the last one.
    fireEvent.click(screen.getByText("Done"));

    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem("homeio.desktop-tour.seen")).toBe("1");
  });

  it("lets someone leave without finishing", () => {
    anchors(["apps", "App Store"]);
    const onClose = vi.fn();
    render(<DesktopTour open onClose={onClose} />);

    fireEvent.click(screen.getByText("Skip"));

    expect(onClose).toHaveBeenCalled();
    // Skipping counts as seen: offering it again on every load is the thing
    // that makes tours annoying.
    expect(localStorage.getItem("homeio.desktop-tour.seen")).toBe("1");
  });

  it("renders nothing when no anchor exists at all", () => {
    render(<DesktopTour open onClose={vi.fn()} />);
    expect(screen.queryByTestId("desktop-tour")).toBeNull();
  });
});
