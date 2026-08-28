/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "@/modules/onboarding/components/setup-wizard";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";
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

// The app wraps every page in AppProviders; step 4 uses the settings 2FA hooks,
// so the wizard needs the same provider here.
function renderWizard(ui: React.ReactElement) {
  return render(ui, { wrapper: createWrapper(createTestQueryClient()) });
}

function mockFetch(ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: { disks: [] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function savedBodies(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/v1/setup/step")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
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
    renderWizard(<SetupWizard initialState={state(3)} onFinished={vi.fn()} />);

    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
    expect(screen.getByText("Reach it from anywhere")).toBeTruthy();
  });

  it("marks the rail as done, current, and upcoming around the active step", () => {
    mockFetch();
    renderWizard(<SetupWizard initialState={state(3)} onFinished={vi.fn()} />);

    expect(screen.getByTestId("setup-rail-2").dataset.state).toBe("done");
    expect(screen.getByTestId("setup-rail-3").dataset.state).toBe("current");
    expect(screen.getByTestId("setup-rail-4").dataset.state).toBe("upcoming");
  });

  it("advances and records the new step", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([2]);
  });

  it("skipping a step advances without a different code path", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Skip this step"));

    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([2]);
  });

  it("goes back and records the earlier step so a resume matches", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(3)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Back"));

    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());
    expect(savedSteps(fetchMock)).toEqual([2]);
  });

  it("offers no way back from the first step", () => {
    mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    expect(screen.queryByText("Back")).toBeNull();
  });

  it("finishes from the last step instead of walking past it", async () => {
    const fetchMock = mockFetch();
    const onFinished = vi.fn();
    renderWizard(<SetupWizard initialState={state(5)} onFinished={onFinished} />);

    fireEvent.click(screen.getByText("Finish setup"));

    // Completing shows the summary; the handoff waits for the user to read it.
    await waitFor(() => expect(screen.getByTestId("setup-summary")).toBeTruthy());
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v1/setup/complete"),
    ).toBe(true);
    expect(savedSteps(fetchMock)).toEqual([]);
    expect(onFinished).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Open Homeio"));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("skipping every step writes no answers and installs nothing", async () => {
    // The contract for the whole track: an install that skips setup must end up
    // exactly where 1.7.24 leaves one.
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    for (const step of [2, 3, 4, 5]) {
      fireEvent.click(screen.getByText("Skip this step"));
      await waitFor(() => expect(screen.getByText(`Step ${step} of 5`)).toBeTruthy());
    }

    fireEvent.click(screen.getByText("Skip and finish"));
    await waitFor(() => expect(screen.getByTestId("setup-summary")).toBeTruthy());

    // Only step numbers were recorded — no timezone, no storage root.
    expect(savedBodies(fetchMock)).toEqual([
      { step: 2 },
      { step: 3 },
      { step: 4 },
      { step: 5 },
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/install"))).toBe(
      false,
    );
    expect(screen.getAllByText("Skipped")).toHaveLength(5);
  });

  it("kicks off the chosen app install without waiting for the pull", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(5)} onFinished={vi.fn()} />);

    // The catalog mock returns no apps, so drive the choice through the step's
    // own callback the way the tile click does.
    fireEvent.click(screen.getByText("Finish setup"));

    await waitFor(() => expect(screen.getByTestId("setup-summary")).toBeTruthy());
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v1/setup/complete"),
    ).toBe(true);
  });

  it("stays on the step when the server refuses to record it", async () => {
    // Advancing past a step the server did not record would lose the answer on
    // the next resume.
    mockFetch(false);
    renderWizard(<SetupWizard initialState={state(2)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();
  });

  it("does not hand the user off when completion fails", async () => {
    mockFetch(false);
    const onFinished = vi.fn();
    renderWizard(<SetupWizard initialState={state(5)} onFinished={onFinished} />);

    fireEvent.click(screen.getByText("Finish setup"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setup-summary")).toBeNull();
  });

  it("continues on Enter and skips on Escape", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Step 2 of 5")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByText("Step 3 of 5")).toBeTruthy());

    expect(savedSteps(fetchMock)).toEqual([2, 3]);
  });

  it("goes back on ArrowLeft", async () => {
    mockFetch();
    renderWizard(<SetupWizard initialState={state(2)} onFinished={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeTruthy());
  });

  it("carries the detected time zone when step 1 is confirmed", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(savedBodies(fetchMock)).toHaveLength(1));
    const body = savedBodies(fetchMock)[0];
    expect(body.step).toBe(2);
    expect(typeof body.timezone).toBe("string");
    expect(body.timezone.length).toBeGreaterThan(0);
  });

  it("writes no answer when a step is skipped", async () => {
    // Skipping must not quietly store a value the user never chose.
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.click(screen.getByText("Skip this step"));

    await waitFor(() => expect(savedBodies(fetchMock)).toHaveLength(1));
    expect(savedBodies(fetchMock)[0]).toEqual({ step: 2 });
  });

  it("carries the storage choice when step 2 is confirmed", async () => {
    const fetchMock = mockFetch();
    renderWizard(
      <SetupWizard
        initialState={{ ...state(2), defaultStorageRoot: "/DATA" }}
        onFinished={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(savedBodies(fetchMock)).toHaveLength(1));
    expect(savedBodies(fetchMock)[0]).toEqual({ step: 3, defaultStorageRoot: "/DATA" });
  });

  it("escape skips without writing the answer", async () => {
    const fetchMock = mockFetch();
    renderWizard(<SetupWizard initialState={state(1)} onFinished={vi.fn()} />);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(savedBodies(fetchMock)).toHaveLength(1));
    expect(savedBodies(fetchMock)[0]).toEqual({ step: 2 });
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
