/**
 * The server's "prove it is you again" answer, as something the client can act
 * on rather than a sentence it can only display.
 *
 * Both request paths in this app turn a failed response into `new Error(text)`.
 * That is fine for a message but useless for a decision: the only way to tell a
 * refusal that a password would fix from one it would not is to match on the
 * wording — and the wording is the first thing to change. The server sends a
 * code for this reason; this is the client half of that contract.
 */
export class ElevationRequiredError extends Error {
  constructor(message = "This action needs your password again") {
    super(message);
    this.name = "ElevationRequiredError";
  }
}

export const ELEVATION_REQUIRED_CODE = "elevation_required";

/**
 * Reads a failed response and throws the typed error when that is what it is.
 *
 * Returns the parsed payload otherwise, so callers keep their existing error
 * text without parsing the body twice — a response body can only be read once,
 * which is exactly the kind of detail that makes people skip the check.
 */
export async function throwIfElevationRequired(
  response: Response,
): Promise<{ error?: string; code?: string }> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };

  if (response.status === 403 && payload.code === ELEVATION_REQUIRED_CODE) {
    throw new ElevationRequiredError(payload.error);
  }

  return payload;
}

export function isElevationRequired(error: unknown): error is ElevationRequiredError {
  return error instanceof ElevationRequiredError;
}
