/** What the UI is allowed to know about the tunnel configuration. */
export type CloudflareTunnelConfigPublic = {
  enabled: boolean;
  domain: string;
  hasToken: boolean;
  /** An API token lets Homeio create the public hostname routes itself. */
  hasApiToken: boolean;
};

export type CloudflareTunnelConfigSaveRequest = {
  enabled: boolean;
  domain: string;
  /** Omit to keep the stored token, empty string to clear it. */
  token?: string;
  /** Same rules as token. Without it, routes must be created by hand. */
  apiToken?: string;
};

/** Whether the cloudflared connector is actually up. */
export type CloudflareTunnelStatus = {
  installed: boolean;
  running: boolean;
  state: string | null;
  error: string | null;
};

/** One installed app as offered in the "expose through the tunnel" list. */
export type CloudflareTunnelAppExposure = {
  appId: string;
  name: string;
  /** Port the app's web UI listens on, null when it has none. */
  port: number | null;
  /** Subdomain in use, or the suggestion to prefill when not exposed yet. */
  subdomain: string;
  exposed: boolean;
  /** The public address this app resolves to, null until it is exposed. */
  publicUrl: string | null;
};

export type CloudflareTunnelExposureSaveRequest = {
  appId: string;
  exposed: boolean;
  subdomain?: string;
};
