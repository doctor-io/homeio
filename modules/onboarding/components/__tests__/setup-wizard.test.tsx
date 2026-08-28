/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "@/modules/onboarding/components/setup-wizard";
import type { OnboardingState } from "@/lib/shared/contracts/onboarding";

function state(step: number): OnboardingState {
  return {
    status: "pending",
    step: step as OnboardingState["step"],
    timezone: null,
    defaultStorageRoot: null,
    completedAt: null,
  };
}

function mockFetch(ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500 });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function savedSteps(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/v1/setup/step")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).step);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("SetupWizard", () => {
  it("resumes at the stored step", () => {
    mockFetch();
    render(<SetupWizard initialState={state(3)} onFinished={vi.fn()} />);

    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
    expect(screen.getByText("Reach it from anywhere")).toBeTruthy();
  });

  it("marks the rail as done, current, and upcoming around the active step", () => {
    mockFetch();
    render(<SetupWizard initialState={state(3)} onFinished={vi.fn()} />);

    expect(screen.getByTestId("setup-rail-2").dataset.state).toBe("done");
    expect(screen.getByTestId("setup-rail-3").dataset.state).toBe("current");
    expect(screen.getByTestId("setup-rail-4").dataset.state).toBe("upcoming");
  });

  it("advances and records the new step", async () => {
    const fetchMock = mockFetch();
    render(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([2]);
  });

  it("skipping a step advances without a different code path", async () => {
    const fetchMock = mockFetch();
    render(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Skip this step"));

    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([2]);
  });

  it("goes back and records the earlier step so a resume matches", async () => {
    const fetchMock = mockFetch();
    render(<SetupWizard initialState={state(3)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Back"));

    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([2]);
  });

  it("offers no way back from the first step", () => {
    mockFetch();
    render(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    expect(screen.queryByText("Back")).toBeNull();
  });

  it("finishes from the last step instead of walking past it", async () => {
    const fetchMock = mockFetch();
    const onFinished = vi.fn();
    render(<SetupWizard initialState={state(5)} onFinished={onFinished} />);

    fireEvent.click(screen.getByText("Finish setup"));

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/setup/complete");
    expect(savedSteps(fetchMock)).toEqual([]);
  });

  it("stays on the step when the server refuses to record it", async () => {
    // Advancing past a step the server did not record would lose the answer on
    // the next resume.
    mockFetch(false);
    render(<SetupWizard initialState={state(2)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();
  });

  it("does not hand the user off when completion fails", async () => {
    mockFetch(false);
    const onFinished = vi.fn();
    render(<SetupWizard initialState={state(5)} onFinished={onFinished} />);

    fireEvent.click(screen.getByText("Finish setup"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("continues on Enter and skips on Escape", async () => {
    const fetchMock = mockFetch();
    render(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByText("Step 3 of 5")).toBeTruthy());

    expect(savedSteps(fetchMock)).toEqual([2, 3]);
  });

  it("goes back on ArrowLeft", async () => {
    mockFetch();
    render(<SetupWizard initialState={state(2)} onFinished={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeTruthy());
  });

  it("leaves keys alone while the user is typing in a step's own field", async () => {
    const fetchMock = mockFetch();
    render(
      <>
        <SetupWizard initialState={state(1)} onFinished={vi.fn()} />
        <input data-testid="field" />
      </>,
    );

    fireEvent.keyDown(screen.getByTestId("field"), { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([]);
  });
});
