import { describe, expect, it } from "vitest";

import {
  ElevationRequiredError,
  isElevationRequired,
  throwIfElevationRequired,
} from "@/modules/auth/elevation/elevation-error";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("throwIfElevationRequired", () => {
  it("throws a typed error the caller can branch on", async () => {
    const response = jsonResponse(403, {
      error: "This action needs your password again",
      code: "elevation_required",
    });

    await expect(throwIfElevationRequired(response)).rejects.toBeInstanceOf(
      ElevationRequiredError,
    );
  });

  it("carries the server's own wording", async () => {
    const response = jsonResponse(403, {
      error: "This action needs your password again",
      code: "elevation_required",
    });

    await expect(throwIfElevationRequired(response)).rejects.toThrow(
      "This action needs your password again",
    );
  });

  it("leaves other refusals alone, and hands back the payload", async () => {
    // A 403 that a password would not fix has to stay a plain failure —
    // prompting for one would be asking the user to solve the wrong problem.
    const response = jsonResponse(403, { error: "Registration is closed" });

    await expect(throwIfElevationRequired(response)).resolves.toEqual({
      error: "Registration is closed",
    });
  });

  it("does not mistake the code on another status for a refusal", async () => {
    const response = jsonResponse(500, { error: "Boom", code: "elevation_required" });

    await expect(throwIfElevationRequired(response)).resolves.toEqual({
      error: "Boom",
      code: "elevation_required",
    });
  });

  it("survives a body that is not JSON", async () => {
    const response = new Response("<html>gateway</html>", { status: 502 });

    await expect(throwIfElevationRequired(response)).resolves.toEqual({});
  });
});

describe("isElevationRequired", () => {
  it("recognises only its own error", () => {
    expect(isElevationRequired(new ElevationRequiredError())).toBe(true);
    // The message is not the signal. It used to be the only thing available,
    // which is why this distinction is worth a test.
    expect(isElevationRequired(new Error("This action needs your password again"))).toBe(false);
    expect(isElevationRequired(null)).toBe(false);
  });
});
