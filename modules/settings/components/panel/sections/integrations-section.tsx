"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionDivider, InfoBanner } from "@/modules/settings/components/panel/controls";
import { SETTINGS_PANEL_INSET } from "@/modules/settings/components/panel/surface";
import { queryKeys } from "@/lib/shared/query-keys";
import type { GoogleOAuthConfigPublic } from "@/lib/shared/contracts/google-drive";
import type {
  TailscaleConfigPublic,
  TailscaleInstallResult,
  TailscaleStatusPublic,
} from "@/lib/shared/contracts/tailscale";
import type {
  CloudflareTunnelAppExposure,
  CloudflareTunnelConfigPublic,
  CloudflareTunnelStatus,
} from "@/lib/shared/contracts/cloudflare-tunnel";
import { cn } from "@/lib/utils";
import { Check, Eye, EyeOff, ExternalLink } from "@/components/icons/platform-icons";

async function fetchGoogleOAuthConfig(): Promise<GoogleOAuthConfigPublic> {
  const res = await fetch("/api/v1/settings/google-oauth", { cache: "no-store" });
  const json = (await res.json()) as { data?: GoogleOAuthConfigPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch");
  return json.data!;
}

async function saveGoogleOAuthConfig(payload: { clientId: string; clientSecret: string; redirectUri: string }): Promise<GoogleOAuthConfigPublic> {
  const res = await fetch("/api/v1/settings/google-oauth", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: GoogleOAuthConfigPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to save");
  return json.data!;
}

async function clearGoogleOAuthConfig(): Promise<void> {
  const res = await fetch("/api/v1/settings/google-oauth", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear");
}

async function fetchTailscaleConfig(): Promise<TailscaleConfigPublic> {
  const res = await fetch("/api/v1/settings/tailscale", { cache: "no-store" });
  const json = (await res.json()) as { data?: TailscaleConfigPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch");
  return json.data!;
}

async function saveTailscaleConfig(payload: { tailnet: string; apiKey: string }): Promise<TailscaleConfigPublic> {
  const res = await fetch("/api/v1/settings/tailscale", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: TailscaleConfigPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to save");
  return json.data!;
}

async function clearTailscaleConfig(): Promise<void> {
  const res = await fetch("/api/v1/settings/tailscale", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear");
}

async function fetchTailscaleStatus(): Promise<TailscaleStatusPublic> {
  const res = await fetch("/api/v1/system/tailscale/status", { cache: "no-store" });
  const json = (await res.json()) as { data?: TailscaleStatusPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch");
  return json.data!;
}

async function installTailscaleService(authKey?: string): Promise<TailscaleInstallResult> {
  const res = await fetch("/api/v1/system/tailscale/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authKey: authKey ?? "" }),
  });
  const json = (await res.json()) as { data?: TailscaleInstallResult; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to install Tailscale");
  return json.data!;
}

function InputRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className={cn(SETTINGS_PANEL_INSET, "flex items-start justify-between gap-4 px-4 py-3")}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-2xs text-muted-foreground/70">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const inputCls = "h-8 w-64 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "muted"; label: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-3xs font-medium",
        tone === "ok" && "border-status-green/25 bg-status-green/10 text-status-green",
        tone === "warn" && "border-status-amber/25 bg-status-amber/10 text-status-amber",
        tone === "muted" && "border-glass-border bg-background/55 text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function GoogleDriveConfig() {
  const queryClient = useQueryClient();
  const { data: saved, isLoading } = useQuery({
    queryKey: queryKeys.googleOAuthConfig,
    queryFn: fetchGoogleOAuthConfig,
  });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const originDefault = typeof window !== "undefined"
    ? `${window.location.origin}/api/v1/files/google-drive/callback`
    : "http://localhost:3000/api/v1/files/google-drive/callback";
  const effectiveRedirectUri = redirectUri || saved?.redirectUri || originDefault;

  const saveMutation = useMutation({
    mutationFn: saveGoogleOAuthConfig,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.googleOAuthConfig });
      void queryClient.invalidateQueries({ queryKey: queryKeys.googleDriveConnections });
      setClientSecret("");
      setClientId("");
      setRedirectUri("");
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
      void data;
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearGoogleOAuthConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.googleOAuthConfig });
      void queryClient.invalidateQueries({ queryKey: queryKeys.googleDriveConnections });
    },
  });

  const isConfigured = Boolean(saved?.clientId && saved?.hasSecret);
  const isBusy = saveMutation.isPending || clearMutation.isPending || isLoading;

  function handleSave() {
    const id = clientId.trim() || saved?.clientId || "";
    const secret = clientSecret.trim();
    const uri = redirectUri.trim() || effectiveRedirectUri;
    if (!id || !secret || !uri) return;
    saveMutation.mutate({ clientId: id, clientSecret: secret, redirectUri: uri });
  }

  const hasChanges = clientId.trim().length > 0 || clientSecret.trim().length > 0 || (redirectUri.trim().length > 0 && redirectUri.trim() !== saved?.redirectUri);
  const canSave = hasChanges && (clientSecret.trim().length > 0);

  return (
    <div className="flex flex-col gap-1">
      {/* Status banner */}
      {isConfigured && !saveMutation.error && (
        <InfoBanner
          text={savedOk ? "Credentials saved successfully." : `OAuth app configured · Client ID: ${saved?.clientId?.slice(0, 20)}...`}
          variant="info"
        />
      )}
      {saveMutation.error && (
        <InfoBanner text={(saveMutation.error as Error).message} variant="warning" />
      )}
      {clearMutation.error && (
        <InfoBanner text={(clearMutation.error as Error).message} variant="warning" />
      )}

      {/* Setup guide link */}
      <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between px-4 py-2.5")}>
        <div className="text-2xs text-muted-foreground/70">
          You need a Google Cloud project with the Drive API enabled and an OAuth 2.0 Client ID.
        </div>
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 flex shrink-0 items-center gap-1 text-2xs text-primary hover:underline"
        >
          Google Cloud Console
          <ExternalLink className="size-3" />
        </a>
      </div>

      {/* Redirect URI (read-only hint) */}
      <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between gap-4 px-4 py-2.5")}>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-foreground">Redirect URI</div>
          <div className="mt-0.5 text-2xs text-muted-foreground/70">Add this exact URI to your OAuth client&apos;s Authorized redirect URIs</div>
        </div>
        <code className="rounded bg-background/55 px-2 py-1 font-mono text-3xs text-foreground">
          {effectiveRedirectUri}
        </code>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        {/* Custom redirect URI override */}
        <InputRow
          label="Custom redirect URI"
          description="Override only if you need a different URL than the one shown above"
        >
          <input
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder={saved?.redirectUri ?? originDefault}
            disabled={isBusy}
            className={inputCls}
          />
        </InputRow>

        {/* Client ID */}
        <InputRow label="Client ID" description="From Google Cloud Console → OAuth 2.0 Client IDs">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={saved?.clientId ? `${saved.clientId.slice(0, 24)}…` : "1234567890-abc...apps.googleusercontent.com"}
            disabled={isBusy}
            className={inputCls}
          />
        </InputRow>

        {/* Client Secret */}
        <InputRow label="Client secret" description="Kept encrypted in the database">
          <div className="relative">
            <input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              type={showSecret ? "text" : "password"}
              placeholder={saved?.hasSecret ? "••••••••••••••••" : "GOCSPX-..."}
              disabled={isBusy}
              className={cn(inputCls, "pr-9")}
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
              tabIndex={-1}
            >
              {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </InputRow>

        {/* Actions */}
        <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between px-4 py-2.5")}>
          {isConfigured ? (
            <button
              type="button"
              onClick={() => clearMutation.mutate()}
              disabled={isBusy}
              className="text-2xs text-status-red hover:underline disabled:opacity-50"
            >
              {clearMutation.isPending ? "Removing…" : "Remove credentials"}
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={!canSave || isBusy}
            className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savedOk && <Check className="size-3" />}
            {saveMutation.isPending ? "Saving…" : savedOk ? "Saved" : "Save credentials"}
          </button>
        </div>
      </form>
    </div>
  );
}

async function fetchCloudflareTunnelConfig(): Promise<CloudflareTunnelConfigPublic> {
  const res = await fetch("/api/v1/settings/cloudflare-tunnel", { cache: "no-store" });
  const json = (await res.json()) as { data?: CloudflareTunnelConfigPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch");
  return json.data!;
}

async function saveCloudflareTunnelConfigRequest(payload: {
  enabled: boolean;
  domain: string;
  token?: string;
  apiToken?: string;
}): Promise<CloudflareTunnelConfigPublic> {
  const res = await fetch("/api/v1/settings/cloudflare-tunnel", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: CloudflareTunnelConfigPublic; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to save");
  return json.data!;
}

async function fetchTunnelStatus(): Promise<CloudflareTunnelStatus> {
  const res = await fetch("/api/v1/system/cloudflare-tunnel", { cache: "no-store" });
  const json = (await res.json()) as { data?: CloudflareTunnelStatus; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch status");
  return json.data!;
}

async function activateTunnel(token?: string): Promise<CloudflareTunnelStatus> {
  const res = await fetch("/api/v1/system/cloudflare-tunnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(token ? { token } : {}),
  });
  const json = (await res.json()) as { data?: CloudflareTunnelStatus; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to activate the tunnel");
  return json.data!;
}

async function deactivateTunnel(): Promise<CloudflareTunnelStatus> {
  const res = await fetch("/api/v1/system/cloudflare-tunnel", { method: "DELETE" });
  const json = (await res.json()) as { data?: CloudflareTunnelStatus; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to stop the tunnel");
  return json.data!;
}

async function fetchTunnelExposures(): Promise<CloudflareTunnelAppExposure[]> {
  const res = await fetch("/api/v1/settings/cloudflare-tunnel/exposures", { cache: "no-store" });
  const json = (await res.json()) as { data?: CloudflareTunnelAppExposure[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch");
  return json.data!;
}

async function saveTunnelExposure(payload: {
  appId: string;
  exposed: boolean;
  subdomain?: string;
}): Promise<CloudflareTunnelAppExposure> {
  const res = await fetch("/api/v1/settings/cloudflare-tunnel/exposures", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: CloudflareTunnelAppExposure; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to save");
  return json.data!;
}

function TailscaleConfig() {
  const queryClient = useQueryClient();
  const { data: saved, isLoading } = useQuery({
    queryKey: queryKeys.tailscaleConfig,
    queryFn: fetchTailscaleConfig,
  });
  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: queryKeys.tailscaleStatus,
    queryFn: fetchTailscaleStatus,
    refetchInterval: 10_000,
  });

  const [tailnet, setTailnet] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const saveMutation = useMutation({
    mutationFn: saveTailscaleConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tailscaleConfig });
      setTailnet("");
      setApiKey("");
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearTailscaleConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tailscaleConfig });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      const hasNewCredentials = effectiveTailnet.length > 0 && apiKey.trim().length > 0;
      if (hasNewCredentials) {
        await saveTailscaleConfig({
          tailnet: effectiveTailnet,
          apiKey: apiKey.trim(),
        });
      }
      await installTailscaleService(apiKey.trim() || undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tailscaleConfig });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tailscaleStatus });
      setTailnet("");
      setApiKey("");
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    },
  });

  const isConfigured = Boolean(saved?.tailnet && saved?.hasApiKey);
  const isBusy = saveMutation.isPending || clearMutation.isPending || activateMutation.isPending || isLoading;
  const effectiveTailnet = tailnet.trim() || saved?.tailnet || "";
  const canSave = effectiveTailnet.length > 0 && apiKey.trim().length > 0;
  const canActivate = (isConfigured || canSave) && status?.issue !== "missing_tun";
  const serviceLabel = isStatusLoading
    ? "Checking"
    : status?.installed
      ? status.running
        ? "Running"
        : "Installed"
      : "Not installed";
  const connectionLabel = status?.connected ? "Connected" : "Disconnected";

  function handleSave() {
    if (!canSave) return;
    saveMutation.mutate({
      tailnet: effectiveTailnet,
      apiKey: apiKey.trim(),
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {isConfigured && !saveMutation.error && (
        <InfoBanner
          text={savedOk ? "Tailscale updated successfully." : `Tailscale configured · Tailnet: ${saved?.tailnet}`}
          variant="info"
        />
      )}
      {saveMutation.error && (
        <InfoBanner text={(saveMutation.error as Error).message} variant="warning" />
      )}
      {clearMutation.error && (
        <InfoBanner text={(clearMutation.error as Error).message} variant="warning" />
      )}
      {activateMutation.error && (
        <InfoBanner text={(activateMutation.error as Error).message} variant="warning" />
      )}
      {status?.issue === "missing_tun" && (
        <InfoBanner
          text="Tailscale cannot activate because /dev/net/tun is missing. In Proxmox LXC, add Device Passthrough dev/net/tun, or run: pct set CTID --dev0 /dev/net/tun && pct set CTID --features keyctl=1,nesting=1"
          variant="warning"
        />
      )}
      {status?.error && status.issue !== "missing_tun" && (
        <InfoBanner text={status.error} variant="warning" />
      )}

      <div className={cn(SETTINGS_PANEL_INSET, "flex flex-col gap-3 px-4 py-3")}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/integrations/tailscale-light.svg"
              alt=""
              className="size-9 rounded-lg bg-black/15 p-1.5"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">Tailscale</div>
              <div className="mt-0.5 text-2xs text-muted-foreground/70">
                Install the official Linux client and register this server with an auth key.
              </div>
            </div>
          </div>
          <StatusPill
            tone={status?.connected ? "ok" : status?.installed ? "warn" : "muted"}
            label={status?.connected ? "Active" : status?.installed ? "Needs login" : "Inactive"}
          />
        </div>

        <div className="grid gap-2 text-2xs text-muted-foreground sm:grid-cols-2">
          <div className="rounded-lg border border-glass-border bg-background/35 px-3 py-2">
            <div className="text-muted-foreground/60">Service</div>
            <div className="mt-1 text-xs text-foreground">{serviceLabel}</div>
          </div>
          <div className="rounded-lg border border-glass-border bg-background/35 px-3 py-2">
            <div className="text-muted-foreground/60">Connection</div>
            <div className="mt-1 text-xs text-foreground">{connectionLabel}</div>
          </div>
          <div className="rounded-lg border border-glass-border bg-background/35 px-3 py-2">
            <div className="text-muted-foreground/60">TUN device</div>
            <div className="mt-1 text-xs text-foreground">{status?.tunAvailable ? "Available" : "Missing"}</div>
          </div>
          <div className="rounded-lg border border-glass-border bg-background/35 px-3 py-2">
            <div className="text-muted-foreground/60">Machine</div>
            <div className="mt-1 truncate text-xs text-foreground">{status?.hostname ?? "--"}</div>
          </div>
          <div className="rounded-lg border border-glass-border bg-background/35 px-3 py-2">
            <div className="text-muted-foreground/60">Tailscale IP</div>
            <div className="mt-1 truncate text-xs text-foreground">{status?.tailscaleIps[0] ?? "--"}</div>
          </div>
        </div>
      </div>

      <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between px-4 py-2.5")}>
        <div className="text-2xs text-muted-foreground/70">
          Activate uses the official Linux install script, then runs tailscale up with your auth key.
        </div>
        <a
          href="https://login.tailscale.com/admin/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 flex shrink-0 items-center gap-1 text-2xs text-primary hover:underline"
        >
          Tailscale keys
          <ExternalLink className="size-3" />
        </a>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        <InputRow
          label="Tailnet"
          description="Use the tailnet name from the Tailscale admin console"
        >
          <input
            value={tailnet}
            onChange={(e) => setTailnet(e.target.value)}
            placeholder={saved?.tailnet || "example.com"}
            disabled={isBusy}
            className={inputCls}
          />
        </InputRow>

        <InputRow label="Auth key" description="Generate an auth key in Tailscale Keys; kept encrypted until activation">
          <div className="relative">
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type={showApiKey ? "text" : "password"}
              placeholder={saved?.hasApiKey ? "••••••••••••••••" : "tskey-auth-..."}
              disabled={isBusy}
              className={cn(inputCls, "pr-9")}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
              tabIndex={-1}
            >
              {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </InputRow>

        <div className={cn(SETTINGS_PANEL_INSET, "flex items-center justify-between px-4 py-2.5")}>
          {isConfigured ? (
            <button
              type="button"
              onClick={() => clearMutation.mutate()}
              disabled={isBusy}
              className="text-2xs text-status-red hover:underline disabled:opacity-50"
            >
              {clearMutation.isPending ? "Removing…" : "Remove credentials"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!canSave || isBusy}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-glass-border bg-background/55 px-3 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savedOk && !activateMutation.isPending && <Check className="size-3" />}
              {saveMutation.isPending ? "Saving…" : savedOk ? "Saved" : "Save auth key"}
            </button>
            <button
              type="button"
              onClick={() => activateMutation.mutate()}
              disabled={!canActivate || isBusy}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activateMutation.isPending ? "Activating…" : status?.installed ? "Activate" : "Install and activate"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * A secret that is already stored should not look like an empty box waiting for
 * input: it reads as unsaved and invites re-typing something that is already
 * right. Locked once saved, with Edit to deliberately replace it.
 */
function SecretField({
  id,
  label,
  hint,
  placeholder,
  stored,
  busy,
  onSave,
}: {
  id: string;
  label: string;
  hint: React.ReactNode;
  placeholder: string;
  stored: boolean;
  busy: boolean;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);

  const locked = stored && !editing;

  async function submit() {
    const next = value.trim();
    if (!next) return;
    await onSave(next);
    // Only lock once it actually saved; a rejected token stays editable.
    setValue("");
    setReveal(false);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] text-muted-foreground/70" htmlFor={id}>
        {label} {stored ? "(stored)" : ""}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          aria-label={label}
          type={reveal ? "text" : "password"}
          value={locked ? "" : value}
          disabled={locked}
          onChange={(event) => setValue(event.target.value)}
          placeholder={locked ? "••••••••" : placeholder}
          className="h-8 flex-1 rounded-lg border border-glass-border bg-background/55 px-2.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        {!locked && (
          <button
            type="button"
            aria-label={reveal ? `Hide ${label}` : `Show ${label}`}
            onClick={() => setReveal((previous) => !previous)}
            className="flex size-8 items-center justify-center rounded-lg border border-glass-border bg-background/55 text-muted-foreground"
          >
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
        {locked ? (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            disabled={busy}
            onClick={() => setEditing(true)}
            className="flex h-8 items-center rounded-lg border border-glass-border bg-background/55 px-3 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Edit
          </button>
        ) : (
          <>
            {stored && (
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  setReveal(false);
                  setEditing(false);
                }}
                className="flex h-8 items-center rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              aria-label={`Save ${label}`}
              disabled={busy || value.trim().length === 0}
              onClick={() => void submit()}
              className="flex h-8 items-center rounded-lg border border-glass-border bg-background/55 px-3 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/60">{hint}</p>
    </div>
  );
}

function TunnelExposureRow({
  exposure,
  domain,
  disabled,
  onSave,
}: {
  exposure: CloudflareTunnelAppExposure;
  domain: string;
  disabled: boolean;
  onSave: (input: { appId: string; exposed: boolean; subdomain: string }) => void;
}) {
  const [subdomain, setSubdomain] = useState(exposure.subdomain);

  return (
    <div className="flex items-center gap-2 border-t border-glass-border/60 px-1 py-2 first:border-t-0">
      <input
        type="checkbox"
        aria-label={`Expose ${exposure.name}`}
        checked={exposure.exposed}
        disabled={disabled}
        onChange={(event) =>
          onSave({
            appId: exposure.appId,
            exposed: event.target.checked,
            subdomain: subdomain.trim(),
          })
        }
        className="size-3.5 shrink-0 accent-primary disabled:opacity-40"
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{exposure.name}</div>
        <div className="text-[11px] text-muted-foreground/70">
          {exposure.port === null ? "No web UI port" : `Port ${exposure.port}`}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <input
          aria-label={`Subdomain for ${exposure.name}`}
          value={subdomain}
          onChange={(event) => setSubdomain(event.target.value)}
          onBlur={() => {
            const next = subdomain.trim();
            if (!exposure.exposed || next === exposure.subdomain) return;
            onSave({ appId: exposure.appId, exposed: true, subdomain: next });
          }}
          className="h-7 w-28 rounded-lg border border-glass-border bg-background/55 px-2 text-right text-[11px] text-foreground disabled:opacity-40"
        />
        <span className="w-32 shrink-0 truncate text-[11px] text-muted-foreground/70">
          .{domain || "your-domain.com"}
        </span>
      </div>
    </div>
  );
}

function CloudflareTunnelConfig() {
  const queryClient = useQueryClient();
  const { data: saved, isLoading } = useQuery({
    queryKey: queryKeys.cloudflareTunnelConfig,
    queryFn: fetchCloudflareTunnelConfig,
  });

  const enabled = Boolean(saved?.enabled);

  // Only poll the connector once the operator has switched the feature on.
  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: queryKeys.cloudflareTunnelStatus,
    queryFn: fetchTunnelStatus,
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });

  const isActive = Boolean(status?.running);

  // The app list only makes sense once the tunnel actually carries traffic.
  const { data: exposures } = useQuery({
    queryKey: queryKeys.cloudflareTunnelExposures,
    queryFn: fetchTunnelExposures,
    enabled: enabled && isActive,
  });

  const [domain, setDomain] = useState("");
  const [savedOk, setSavedOk] = useState(false);

  const effectiveDomain = domain.trim() || saved?.domain || "";

  function invalidateConfig() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnelConfig });
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnelStatus });
  }

  const configMutation = useMutation({
    mutationFn: saveCloudflareTunnelConfigRequest,
    onSuccess: () => {
      invalidateConfig();
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => activateTunnel(),
    onSuccess: () => {
      invalidateConfig();
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnelExposures });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateTunnel,
    onSuccess: invalidateConfig,
  });

  const exposureMutation = useMutation({
    mutationFn: saveTunnelExposure,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnelExposures });
      // The app's link changes with its exposure, so the grid has to catch up.
      void queryClient.invalidateQueries({ queryKey: queryKeys.installedApps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog });
    },
  });

  const isBusy =
    isLoading ||
    configMutation.isPending ||
    activateMutation.isPending ||
    deactivateMutation.isPending ||
    exposureMutation.isPending;

  const hasToken = Boolean(saved?.hasToken);
  const canActivate = enabled && hasToken && effectiveDomain.length > 0;
  const connectorLabel = !enabled
    ? "Disabled"
    : isStatusLoading
      ? "Checking"
      : isActive
        ? "Running"
        : status?.installed
          ? (status.state ?? "Stopped")
          : "Not activated";

  const activationError =
    (configMutation.error as Error | null)?.message ??
    (activateMutation.error as Error | null)?.message ??
    (deactivateMutation.error as Error | null)?.message ??
    null;

  return (
    <div className="flex flex-col gap-1">
      {activationError && <InfoBanner text={activationError} variant="warning" />}
      {exposureMutation.error && (
        <InfoBanner text={(exposureMutation.error as Error).message} variant="warning" />
      )}
      {enabled && !isActive && status?.error && (
        <InfoBanner text={status.error} variant="warning" />
      )}
      {savedOk && !activationError && (
        <InfoBanner text="Cloudflare Tunnel updated successfully." variant="info" />
      )}

      <div className={cn(SETTINGS_PANEL_INSET, "flex flex-col gap-3 px-4 py-3")}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Cloudflare Tunnel</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">
              Publish apps on your own domain. Homeio fills in each app&apos;s link so
              Open goes to the public address instead of this server&apos;s.
            </div>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              aria-label="Enable Cloudflare Tunnel"
              checked={enabled}
              disabled={isBusy}
              onChange={(event) =>
                configMutation.mutate({
                  enabled: event.target.checked,
                  domain: effectiveDomain,
                })
              }
              className="size-3.5 accent-primary disabled:opacity-40"
            />
            {enabled ? "Enabled" : "Disabled"}
          </label>
        </div>

        {enabled && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-muted-foreground/70" htmlFor="cf-tunnel-domain">
                Domain
              </label>
              <input
                id="cf-tunnel-domain"
                aria-label="Tunnel domain"
                value={domain || saved?.domain || ""}
                onChange={(event) => setDomain(event.target.value)}
                onBlur={() => {
                  const next = domain.trim();
                  if (!next || next === saved?.domain) return;
                  configMutation.mutate({ enabled: true, domain: next });
                }}
                placeholder="example.com"
                className="h-8 rounded-lg border border-glass-border bg-background/55 px-2.5 text-xs text-foreground"
              />
            </div>

            <SecretField
              id="cf-tunnel-token"
              label="Connector token"
              stored={Boolean(saved?.hasToken)}
              busy={isBusy}
              placeholder="Paste the whole install command, or just the token"
              hint={
                <>
                  From Cloudflare Zero Trust · Networks · Tunnels · Add a replica.
                  Paste the command it shows — Homeio takes the token out of it.
                </>
              }
              onSave={(value) =>
                configMutation.mutateAsync({
                  enabled: true,
                  domain: effectiveDomain,
                  token: value,
                })
              }
            />

            <SecretField
              id="cf-api-token"
              label="API token"
              stored={Boolean(saved?.hasApiToken)}
              busy={isBusy}
              placeholder="Zone:DNS:Edit + Account:Tunnel:Edit"
              hint={
                <>
                  With it, Homeio creates and removes each public hostname itself.
                  Without it, add the routes in your Cloudflare dashboard.
                </>
              }
              onSave={(value) =>
                configMutation.mutateAsync({
                  enabled,
                  domain: effectiveDomain,
                  apiToken: value,
                })
              }
            />

            <div className="flex items-center justify-between gap-3 border-t border-glass-border/60 pt-3">
              <div className="text-[11px] text-muted-foreground/70">
                Connector: <span className="text-foreground">{connectorLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                {isActive && (
                  <button
                    type="button"
                    onClick={() => deactivateMutation.mutate()}
                    disabled={isBusy}
                    className="text-[11px] text-status-red hover:underline disabled:opacity-50"
                  >
                    {deactivateMutation.isPending ? "Stopping…" : "Stop tunnel"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => activateMutation.mutate()}
                  disabled={!canActivate || isBusy}
                  className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {activateMutation.isPending
                    ? "Activating…"
                    : isActive
                      ? "Restart tunnel"
                      : "Activate tunnel"}
                </button>
              </div>
            </div>
          </>
        )}

        {enabled && isActive && (
          <div className="flex flex-col gap-1 border-t border-glass-border/60 pt-3">
            <div className="text-[11px] font-medium text-muted-foreground/70">
              Apps to expose
            </div>
            {exposures && exposures.length > 0 ? (
              <div className="rounded-lg border border-glass-border/60 px-2">
                {exposures.map((exposure) => (
                  <TunnelExposureRow
                    key={exposure.appId}
                    exposure={exposure}
                    domain={effectiveDomain}
                    disabled={isBusy}
                    onSave={(input) => exposureMutation.mutate(input)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-1 py-2 text-[11px] text-muted-foreground/70">
                No installed apps to expose yet.
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              {saved?.hasApiToken
                ? "Homeio creates and removes the matching public hostname and DNS record for you."
                : "Homeio records the mapping and updates each app's link. Add an API token above to have it create the public hostname routes too."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function IntegrationsSection() {
  return (
    <div className="flex flex-col gap-1">
      <SectionDivider title="Google Drive" />
      <GoogleDriveConfig />
      <SectionDivider title="Tailscale" />
      <TailscaleConfig />
      <SectionDivider title="Cloudflare Tunnel" />
      <CloudflareTunnelConfig />
    </div>
  );
}
