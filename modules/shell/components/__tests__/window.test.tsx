/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMobileWindowPage } from "@/components/ui/mobile-window-page";
import { Window } from "@/modules/shell/components/window";

describe("Window", () => {
  it("returns from a child page without closing the mobile window", () => {
    const onClose = vi.fn();
    function Store() {
      const [detail, setDetail] = useState(true);
      const back = useCallback(() => setDetail(false), []);
      useMobileWindowPage(detail ? "App details" : null, back);
      return <div>{detail ? "Details" : "Catalog"}</div>;
    }

    render(<Window mobile title="Store" onClose={onClose}><Store /></Window>);
    expect(screen.getByRole("heading", { name: "App details" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("heading", { name: "Store" })).toBeTruthy();
    expect(screen.getByText("Catalog")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides a portaled dialog with its window and restores the draft", () => {
    function SourceForm() {
      const [draft, setDraft] = useState("");
      return <Dialog open>
        <DialogContent mobileSheet>
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>Source details</DialogDescription>
          <input aria-label="Source name" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </DialogContent>
      </Dialog>;
    }
    const window = (inactive: boolean) => <Window mobile inactive={inactive} title="Store" onClose={() => {}}><SourceForm /></Window>;
    const { rerender } = render(window(false));
    fireEvent.change(screen.getByRole("textbox", { name: "Source name" }), { target: { value: "Example" } });

    rerender(window(true));
    expect(screen.queryByRole("dialog", { name: "Add source" })).toBeNull();
    rerender(window(false));
    expect((screen.getByRole("textbox", { name: "Source name" }) as HTMLInputElement).value).toBe("Example");
  });

  it("removes inactive confirmations and releases their modal focus", () => {
    const view = (inactive: boolean) => (
      <>
        <Window mobile inactive={inactive} title="Settings" onClose={() => {}}>
          <AlertDialog open>
            <AlertDialogContent>
              <AlertDialogTitle>Restart Homeio</AlertDialogTitle>
              <AlertDialogDescription>Confirm restart</AlertDialogDescription>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogContent>
          </AlertDialog>
        </Window>
        <button type="button">Other tool</button>
      </>
    );
    const { rerender } = render(view(false));
    expect(screen.getByRole("alertdialog", { name: "Restart Homeio" })).toBeTruthy();
    rerender(view(true));
    expect(screen.queryByRole("alertdialog", { name: "Restart Homeio" })).toBeNull();
    const otherTool = screen.getByRole("button", { name: "Other tool" });
    otherTool.focus();
    expect(document.activeElement).toBe(otherTool);
  });

  it("only navigates back for a deliberate swipe on the mobile header", () => {
    const onClose = vi.fn();
    render(<Window mobile title="Files" onClose={onClose}><div>file list</div></Window>);

    const title = screen.getByRole("heading", { name: "Files" });
    const swipe = (target: Element, start: [number, number], end: [number, number]) => {
      fireEvent.touchStart(target, { touches: [{ clientX: start[0], clientY: start[1] }] });
      fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: end[0], clientY: end[1] }] });
    };

    swipe(title, [10, 30], [120, 30]); // Native edge gesture.
    swipe(title, [50, 30], [130, 100]); // Mostly vertical.
    swipe(screen.getByText("file list"), [50, 30], [150, 30]);
    swipe(screen.getByRole("button", { name: "Go back" }), [50, 30], [150, 30]);
    expect(onClose).not.toHaveBeenCalled();

    swipe(title, [50, 30], [150, 35]);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("maximizes into the desktop area above a bottom dock", () => {
    render(
      <Window
        title="App Store"
        onClose={() => {}}
        dockPosition="bottom"
        animationsEnabled={false}
      >
        <div>content</div>
      </Window>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));

    const container = screen.getByText("content").closest("div.absolute");
    expect(container).toBeTruthy();
    expect(container?.getAttribute("style")).toContain("top: 0px");
    expect(container?.getAttribute("style")).toContain("right: 0px");
    expect(container?.getAttribute("style")).toContain("bottom: 88px");
    expect(container?.getAttribute("style")).toContain("left: 0px");
  });

  it("maximizes around a side dock", () => {
    render(
      <Window
        title="Monitor"
        onClose={() => {}}
        dockPosition="left"
        animationsEnabled={false}
      >
        <div>monitor</div>
      </Window>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));

    const container = screen.getByText("monitor").closest("div.absolute");
    expect(container).toBeTruthy();
    expect(container?.getAttribute("style")).toContain("top: 0px");
    expect(container?.getAttribute("style")).toContain("right: 0px");
    expect(container?.getAttribute("style")).toContain("bottom: 0px");
    expect(container?.getAttribute("style")).toContain("left: 80px");
  });
});
