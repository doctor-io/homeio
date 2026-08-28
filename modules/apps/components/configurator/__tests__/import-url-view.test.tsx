/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportUrlView } from "@/modules/apps/components/configurator/import-url-view";

describe("ImportUrlView", () => {
  it("reports each field independently", () => {
    const onChange = vi.fn();
    render(<ImportUrlView url="" ref="" name="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Compose file URL"), {
      target: { value: "https://example.com/compose.yml" },
    });
    expect(onChange).toHaveBeenCalledWith({ url: "https://example.com/compose.yml" });

    fireEvent.change(screen.getByLabelText("App name"), { target: { value: "My Stack" } });
    expect(onChange).toHaveBeenCalledWith({ name: "My Stack" });
  });

  it("says where private networks stand, since that refusal is otherwise puzzling", () => {
    render(<ImportUrlView url="" ref="" name="" onChange={vi.fn()} />);

    expect(screen.getByText(/Private networks are refused/)).toBeTruthy();
  });

  it("shows the stored values", () => {
    render(
      <ImportUrlView
        url="https://example.com/c.yml"
        ref="9f2c1ab"
        name="Stack"
        onChange={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Compose file URL") as HTMLInputElement).value).toBe(
      "https://example.com/c.yml",
    );
    expect(
      (screen.getByLabelText(/Pin to a commit or tag/) as HTMLInputElement).value,
    ).toBe("9f2c1ab");
  });
});
