/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimezoneStep } from "@/modules/onboarding/components/steps/timezone-step";

describe("TimezoneStep", () => {
  it("seeds the answer from the browser so Continue needs no interaction", async () => {
    const onChange = vi.fn();
    render(<TimezoneStep value={null} onChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(typeof onChange.mock.calls[0][0]).toBe("string");
    expect(onChange.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it("does not overwrite a zone that is already stored", async () => {
    const onChange = vi.fn();
    render(<TimezoneStep value="Europe/Paris" onChange={onChange} />);

    await waitFor(() => expect(screen.getByLabelText("Time zone")).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a change when another zone is picked", async () => {
    const onChange = vi.fn();
    render(<TimezoneStep value="Europe/Paris" onChange={onChange} />);

    const select = screen.getByLabelText("Time zone") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Asia/Tokyo" } });

    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  it("previews the clock in the selected zone", async () => {
    render(<TimezoneStep value="Europe/Paris" onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Server clock would read/)).toBeTruthy());
  });
});
