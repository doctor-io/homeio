/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useUpdateLog } from "@/modules/shell/hooks/useUpdateLog";

function Probe() {
  const { lines, isLoading } = useUpdateLog(true);
  return (
    <div data-testid="probe">{isLoading ? "loading" : `lines:${lines.join("|")}`}</div>
  );
}

function respondWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUpdateLog", () => {
  it("collects the lines the endpoint returns", async () => {
    respondWith({
      data: {
        lines: ["one", "two"],
        nextOffset: 8,
        running: true,
        available: true,
        unavailableReason: null,
      },
    });

    render(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("lines:one|two"),
    );
  });

  it("skips a 200 whose body is not ours, rather than crashing the screen", async () => {
    // Mid-update this is a proxy's own page, or a Homeio of another version
    // answering before the new one is up. The recovery screen has to survive
    // it — it is the one screen that cannot afford to fall over.
    respondWith({ notOurShape: true });

    render(<Probe />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("probe").textContent).toBe("loading");
  });

  it("skips a body whose lines are not an array", async () => {
    respondWith({ data: { lines: "nope", nextOffset: 4 } });

    render(<Probe />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("probe").textContent).toBe("loading");
  });
});
