"use client";

import { useCallback, useEffect, useState } from "react";
import type { TailscaleStatusPublic } from "@/lib/shared/contracts/tailscale";
import type { CloudflareTunnelStatus } from "@/lib/shared/contracts/cloudflare-tunnel";

type ServiceKey = "tailscale" | "cloudflare";

type ServicesStepProps = {
  /** Lifted so the summary can say what ended up connected. */
  onConnectedChange: (connected: ServiceKey[]) => void;
};

type CardState = {
  key: ServiceKey;
  name: string;
  blurb: string;
  connected: boolean;
};

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return ((await response.json()) as { data: T }).data;
  } catch {
    // A service being unreachable is not a wizard failure — the card just
    // shows as not connected and setup carries on.
    return null;
  }
}

export function ServicesStep({ onConnectedChange }: ServicesStepProps) {
  const [open, setOpen] = useState<ServiceKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tailscale, setTailscale] = useState<TailscaleStatusPublic | null>(null);
  const [tunnel, setTunnel] = useState<CloudflareTunnelStatus | null>(null);

  const [authKey, setAuthKey] = useState("");
  const [connectorToken, setConnectorToken] = useState("");
  const [domain, setDomain] = useState("");

  const refresh = useCallback(async () => {
    const [ts, cf] = await Promise.all([
      readJson<TailscaleStatusPublic>("/api/v1/system/tailscale/status"),
      readJson<CloudflareTunnelStatus>("/api/v1/system/cloudflare-tunnel"),
    ]);
    setTailscale(ts);
    setTunnel(cf);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cards: CardState[] = [
    {
      key: "tailscale",
      name: "Tailscale",
      blurb: "A private address for this server on every device you own.",
      connected: Boolean(tailscale?.connected),
    },
    {
      key: "cloudflare",
      name: "Cloudflare Tunnel",
      blurb: "Publish apps on your own domain, without opening a port.",
      connected: Boolean(tunnel?.running),
    },
  ];

  useEffect(() => {
    onConnectedChange(cards.filter((card) => card.connected).map((card) => card.key));
    // Only the connection flags matter here, not the card copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailscale?.connected, tunnel?.running]);

  async function connectTailscale() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/system/tailscale/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authKey: authKey.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not install Tailscale");
      }
      setAuthKey("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install Tailscale");
    } finally {
      setBusy(false);
    }
  }

  async function connectCloudflare() {
    setBusy(true);
    setError(null);
    try {
      const saved = await fetch("/api/v1/settings/cloudflare-tunnel", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          domain: domain.trim(),
          token: connectorToken.trim(),
        }),
      });
      if (!saved.ok) {
        const body = (await saved.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save the tunnel settings");
      }

      const started = await fetch("/api/v1/system/cloudflare-tunnel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!started.ok) {
        const body = (await started.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not start the tunnel");
      }

      setConnectorToken("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the tunnel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="system-soft-surface p-2.5 text-left" data-testid="services-step">
      {cards.map((card) => {
        const isOpen = open === card.key;

        return (
          <div key={card.key} className="rounded-[var(--system-radius-control)] px-2.5 py-2">
            <button
              type="button"
              data-testid={`service-${card.key}`}
              onClick={() => setOpen(isOpen ? null : card.key)}
              className="flex w-full cursor-pointer items-center gap-2 text-left"
            >
              <span className="flex-grow">
                <span className="block text-sm font-medium text-foreground">{card.name}</span>
                <span className="block text-2xs text-muted-foreground/70">{card.blurb}</span>
              </span>
              <span
                data-testid={`service-${card.key}-state`}
                className={`shrink-0 text-2xs ${
                  card.connected ? "text-status-green" : "text-muted-foreground/55"
                }`}
              >
                {card.connected ? "Connected" : "Not set up"}
              </span>
            </button>

            <div
              className="grid transition-all duration-300 ease-out"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <div className="pt-2">
                  {card.connected ? (
                    <p className="text-2xs text-muted-foreground/70">
                      Already connected. You can change this later in Settings.
                    </p>
                  ) : card.key === "tailscale" ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        aria-label="Tailscale auth key"
                        value={authKey}
                        onChange={(event) => setAuthKey(event.target.value)}
                        placeholder="tskey-auth-…"
                        className="h-8 flex-1 rounded-[var(--system-radius-control)] border border-glass-border bg-background/55 px-2.5 text-xs text-foreground"
                      />
                      <button
                        type="button"
                        disabled={busy || authKey.trim().length === 0}
                        onClick={() => void connectTailscale()}
                        className="h-8 shrink-0 cursor-pointer rounded-[var(--system-radius-control)] border border-glass-border bg-background/55 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? "Connecting…" : "Connect"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <input
                        aria-label="Tunnel domain"
                        value={domain}
                        onChange={(event) => setDomain(event.target.value)}
                        placeholder="example.com"
                        className="h-8 rounded-[var(--system-radius-control)] border border-glass-border bg-background/55 px-2.5 text-xs text-foreground"
                      />
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label="Connector token"
                          type="password"
                          value={connectorToken}
                          onChange={(event) => setConnectorToken(event.target.value)}
                          placeholder="Paste the install command, or just the token"
                          className="h-8 flex-1 rounded-[var(--system-radius-control)] border border-glass-border bg-background/55 px-2.5 text-xs text-foreground"
                        />
                        <button
                          type="button"
                          disabled={busy || connectorToken.trim().length === 0}
                          onClick={() => void connectCloudflare()}
                          className="h-8 shrink-0 cursor-pointer rounded-[var(--system-radius-control)] border border-glass-border bg-background/55 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy ? "Starting…" : "Connect"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {error && (
        <p className="system-error-capsule mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
