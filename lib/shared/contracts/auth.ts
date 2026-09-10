/**
 * Shared contracts for the auth domain. Lives in `lib/shared/` so it can be
 * imported from both server routes and client UI without crossing the
 * `server-only` boundary.
 */

export type TwoFactorErrorCode =
  | "already_enabled"
  | "not_enabled"
  | "not_enrolled"
  | "no_pending_enrollment"
  | "invalid_totp"
  | "invalid_backup_code"
  | "partial_auth_expired"
  | "partial_auth_consumed"
  | "too_many_attempts";

/**
 * Response from `POST /api/v1/auth/2fa/setup`. The server has persisted an
 * unconfirmed `totp_secret` on the user row; calling `verify` with a valid
 * code is what flips `totp_enabled = true`.
 *
 * `qrCodeSvg` is a complete `<svg ...>...</svg>` element ready to drop into
 * the DOM. `secret` is the base32 string for users whose authenticator app
 * cannot scan the QR.
 */
export type TwoFactorSetupResponse = {
  secret: string;
  otpAuthUrl: string;
  qrCodeSvg: string;
};

export type TwoFactorVerifyRequest = {
  code: string;
};

export type TwoFactorVerifyResponse = {
  enabled: true;
  enrolledAt: string;
  backupCodes: string[];
};

export type TwoFactorDisableRequest = {
  code: string;
};

export type TwoFactorDisableResponse = {
  enabled: false;
};

export type TwoFactorStatus = {
  enabled: boolean;
  enrolledAt: string | null;
};

/**
 * Response shape for `POST /api/auth/login`.
 *
 * Non-TOTP users see the original `{ id, username }` payload bit-for-bit;
 * existing clients keep working without any code change. Users with TOTP
 * enabled get the second branch instead — no session cookie is issued and
 * the caller must finish the flow at `/api/v1/auth/login/totp` (A8) using
 * the short-lived `partialAuthToken`. Clients discriminate by the presence
 * of `requiresTotp`.
 */
export type LoginSuccessData = {
  id: string;
  username: string;
};

export type LoginRequiresTotpData = {
  requiresTotp: true;
  partialAuthToken: string;
};

export type LoginResponseData = LoginSuccessData | LoginRequiresTotpData;

/**
 * Payload returned by `GET /api/auth/me`. Embeds the 2FA status so the
 * settings UI can render the enrolment badge without an extra round-trip.
 */
export type CurrentUserData = {
  id: string;
  username: string;
  isDemoMode?: boolean;
  twoFactor: TwoFactorStatus;
  /** False until this account has been shown the desktop tour. */
  hasSeenTour: boolean;
};
