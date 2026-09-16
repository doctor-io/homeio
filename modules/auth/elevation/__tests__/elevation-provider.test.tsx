/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ElevationRequiredError } from "@/modules/auth/elevation/elevation-error";
import {
  ElevationCancelledError,
  ElevationProvider,
  useElevation,
} from "@/modules/auth/elevation/elevation-provider";

/**
 * The prompt-and-replay cycle, driven the way a person drives it.
 *
 * The server half was checked against a running image: refuse, elevate, retry.
 * What that could not check is the part the user actually meets — that a
 * refusal becomes a dialog rather than a red toast, that a typo is corrected in
 * the dialog instead of surfacing later as a failed wipe, and that cancelling
 * leaves the action undone. Those are the cases here.
 */

type Harness = {
  calls: number;
  result: string | null;
  error: string | null;
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildFetch(onElevate: (password: string) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url !== "/api/v1/auth/elevate") throw new Error(`unexpected fetch: ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}")) as { password?: string };
    return onElevate(body.password ?? "");
  });
}

function passwordField() {
  return screen.getByLabelText("Password") as HTMLInputElement;
}

function typePassword(value: string) {
  fireEvent.change(passwordField(), { target: { value } });
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/**
 * Renders a button whose action is refused for want of a password the first
 * `failures` times, and hands back the record of what happened.
 *
 * The component is built here rather than taking the record as a prop: props
 * are not ours to write to, and the lint rule that says so is right.
 */
function renderHarness(failures: number, inProvider = true) {
  const state: Harness = { calls: 0, result: null, error: null };

  function DangerButton() {
    const { runElevated } = useElevation();
    const [, force] = useState(0);
    const attempts = useRef(0);

    async function run() {
      try {
        const value = await runElevated(async () => {
          attempts.current += 1;
          state.calls = attempts.current;
          if (attempts.current <= failures) throw new ElevationRequiredError();
          return "wiped";
        });
        state.result = value;
      } catch (caught) {
        state.error = caught instanceof Error ? caught.name : String(caught);
      }
      force((n) => n + 1);
    }

    return (
      <button type="button" onClick={run}>
        Wipe disk
      </button>
    );
  }

  const button = <DangerButton />;
  render(inProvider ? <ElevationProvider>{button}</ElevationProvider> : button);
  return state;
}

describe("ElevationProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", buildFetch(() => jsonResponse(200, { data: { expiresAt: 1 } })));
  });

  it("does not promise the user more than the store can keep", async () => {
    renderHarness(1);

    click("Wipe disk");
    await screen.findByLabelText("Password");

    // The grant lives in the server's memory and a restart drops it, which is
    // a deliberate choice (see elevation.ts). A dialog that says "you will not
    // be asked again" without that caveat is telling the user something the
    // mechanism cannot deliver — and it came back twice during a deploy.
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("unless the server restarts");
  });

  it("stays out of the way when the server does not ask", async () => {
    const state = renderHarness(0);

    click("Wipe disk");

    await waitFor(() => expect(state.result).toBe("wiped"));
    expect(state.calls).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for the password, then does what the user asked for", async () => {
    const state = renderHarness(1);

    click("Wipe disk");
    await screen.findByLabelText("Password");

    typePassword("MotDePasseFort123");
    click("Confirm");

    await waitFor(() => expect(state.result).toBe("wiped"));
    // Once refused, once replayed. A third call would mean the retry loops.
    expect(state.calls).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("corrects a typo in the dialog rather than in the disk", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch((password) =>
        password === "right"
          ? jsonResponse(200, { data: { expiresAt: 1 } })
          : jsonResponse(401, { error: "Incorrect password" }),
      ),
    );
    const state = renderHarness(1);

    click("Wipe disk");
    await screen.findByLabelText("Password");
    typePassword("wrong");
    click("Confirm");

    expect((await screen.findByRole("alert")).textContent).toBe("Incorrect password");
    // The action has not run a second time: the dialog is still the only thing
    // that happened, which is the whole point of verifying before replaying.
    expect(state.calls).toBe(1);
    expect(state.result).toBeNull();

    typePassword("right");
    click("Confirm");

    await waitFor(() => expect(state.result).toBe("wiped"));
  });

  it("leaves the action undone when the user backs out", async () => {
    const state = renderHarness(1);

    click("Wipe disk");
    await screen.findByLabelText("Password");
    click("Cancel");

    await waitFor(() => expect(state.error).toBe(ElevationCancelledError.name));
    expect(state.calls).toBe(1);
    expect(state.result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not keep the password in state once the dialog closes", async () => {
    // Refused every time, so the second click reaches the dialog again.
    renderHarness(Number.POSITIVE_INFINITY);

    click("Wipe disk");
    await screen.findByLabelText("Password");
    typePassword("MotDePasseFort123");
    click("Cancel");

    click("Wipe disk");
    await screen.findByLabelText("Password");
    expect(passwordField().value).toBe("");
  });

  it("gives up rather than looping when the second refusal is not about a password", async () => {
    // Refused twice: the password was accepted, so the second refusal means
    // something else is wrong and asking again would be asking for nothing.
    const state = renderHarness(2);

    click("Wipe disk");
    await screen.findByLabelText("Password");
    typePassword("MotDePasseFort123");
    click("Confirm");

    await waitFor(() => expect(state.error).toBe(ElevationRequiredError.name));
    expect(state.calls).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes other failures straight through", async () => {
    const state: Harness = { calls: 0, result: null, error: null };

    function Failing() {
      const { runElevated } = useElevation();
      return (
        <button
          type="button"
          onClick={() => {
            void runElevated(async () => {
              throw new Error("Disk is busy");
            }).catch((caught: Error) => {
              state.error = caught.message;
            });
          }}
        >
          Wipe disk
        </button>
      );
    }

    render(
      <ElevationProvider>
        <Failing />
      </ElevationProvider>,
    );
    click("Wipe disk");

    await waitFor(() => expect(state.error).toBe("Disk is busy"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("useElevation outside a provider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", buildFetch(() => jsonResponse(200, { data: { expiresAt: 1 } })));
  });

  it("runs the action unchanged instead of breaking the page", async () => {
    const state = renderHarness(0, false);

    click("Wipe disk");

    await waitFor(() => expect(state.result).toBe("wiped"));
  });

  it("still lets the server's refusal reach the caller", async () => {
    const state = renderHarness(1, false);

    click("Wipe disk");

    // No prompt is possible here, so the refusal has to stay a failure rather
    // than disappearing into a promise nobody settles.
    await waitFor(() => expect(state.error).toBe(ElevationRequiredError.name));
    await act(async () => {});
  });
});
