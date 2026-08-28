"use client";

import { useCallback, useEffect, useState } from "react";
import type { TailscaleStatusPublic } from "@/lib/shared/contracts/tailscale";

type RemoteAccessStepProps = {
  /** Lets the wizard warn on step 4 when the server just became reachable. */
  onConnectedChange?: (connected: boolean) => void;
};

type Phase = "loading" | "ready" | "installing" | "unavailable";

const ISSUE_HELP: Record<NonNullable<TailscaleStatusPublic["issue"]>, string> = {
  missing_tun:
    "This host has no /dev/net/tun device. On Proxmox LXC, enable TUN for the container, then try again.",
  service_unavailable:
    "The tailscaled service is not responding. Start it on the host, then reload this step.",
};

export function RemoteAccessStep({ onConnectedChange }: RemoteAccessStepProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<TailscaleStatusPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/system/tailscale/status");
      if (!response.ok) throw new Error(`Status failed (${response.status})`);

      const json = (await response.json()) as { data: TailscaleStatusPublic };
      setStatus(json.data);
      setPhase("ready");
      onConnectedChange?.(Boolean(json.data?.connected));
    } catch {
      // Tailscale being unreachable is not a wizard failure — the step is
      // skippable, and remote access can be set up later from Settings.
      setPhase("unavailable");
      onConnectedChange?.(false);
    }
  }, [onConnectedChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function install() {
    setPhase("installing");
    setError(null);

    try {
      const response = await fetch("/api/v1/system/tailscale/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Install failed");

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install Tailscale");
      setPhase("ready");
    }
  }

  return (
    <div className="system-soft-surface p-2.5 text-left">
      {phase === "loading" && (
        <p className="px-1 py-3 text-center text-[12px] text-muted-foreground/70">
          Checking Tailscale…
        </p>
      )}

      {phase === "installing" && (
        <p className="px-1 py-3 text-center text-[12px] text-muted-foreground/70">
          Installing and activating — this can take a minute…
        </p>
      )}

      {phase === "unavailable" && (
        <p className="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground/70">
          Tailscale status is unavailable on this host. Skip for now and set up remote
          access later from Settings → Integrations.
        </p>
      )}

      {phase === "ready" && status && (
        <>
          <div className="flex items-center gap-2.5 rounded-[var(--system-radius-control)] border border-white/6 bg-white/[0.035] px-2.5 py-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${
                status.connected
                  ? "bg-status-green"
                  : status.installed
                    ? "bg-status-amber"
                    : "bg-white/25"
              }`}
            />
            <span className="min-w-0 flex-grow">
              <span className="block text-[14px] font-medium text-foreground">Tailscale</span>
              <span className="block truncate text-[11px] text-muted-foreground/80">
                {status.connected
                  ? "Connected"
                  : status.installed
                    ? "Installed, not connected"
                    : "Not installed"}
              </span>
            </span>
          </div>

          {status.connected && status.dnsName && (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground/70">
              Reachable at{" "}
              <span className="font-mono text-foreground/85">{status.dnsName}</span>
              {status.tailscaleIps[0] ? ` · ${status.tailscaleIps[0]}` : ""}
            </p>
          )}

          {status.issue && (
            <p className="mt-2 rounded-[var(--system-radius-control)] border border-status-amber/20 bg-status-amber/10 px-2.5 py-2 text-[11px] leading-relaxed text-status-amber">
              {ISSUE_HELP[status.issue]}
            </p>
          )}

          {!status.connected && !status.issue && (
            <button
              type="button"
              onClick={install}
              className="mt-2 w-full cursor-pointer rounded-[var(--system-radius-control)] border border-white/8 bg-white/[0.06] px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.09]"
            >
              {status.installed ? "Activate Tailscale" : "Install and activate"}
            </button>
          )}

          {error && (
            <p className="mt-2 px-1 text-[11px] text-status-red" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
