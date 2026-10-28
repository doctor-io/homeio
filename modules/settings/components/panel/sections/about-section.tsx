"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionDivider } from "@/modules/settings/components/panel/controls";
import { SETTINGS_PANEL_INSET } from "@/modules/settings/components/panel/surface";
import { ExternalLink } from "@/components/icons/platform-icons";
import { queryKeys } from "@/lib/shared/query-keys";
import { TELEMETRY_STATS_PAGE_URL } from "@/lib/shared/contracts/telemetry";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/doctor-io/homeio";
const DISCORD_URL = "https://discord.gg/KFzTbRbex3";
const SPONSOR_URL = "https://github.com/sponsors/doctor-io";
const COFFEE_URL = "https://buymeacoffee.com/doctor.io";
// Fetched by the browser only when this page is open. GitHub allows 60
// unauthenticated calls an hour per IP, so the answer is kept for hours.
const STALE_MS = 6 * 60 * 60 * 1000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return (await res.json()) as T;
}

function formatCount(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

type AboutSectionProps = {
  version: string;
};

export function AboutSection({ version }: AboutSectionProps) {
  const stars = useQuery({
    queryKey: queryKeys.githubStars,
    queryFn: () =>
      fetchJson<{ stargazers_count: number }>("https://api.github.com/repos/doctor-io/homeio"),
    staleTime: STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const stats = useQuery({
    queryKey: queryKeys.publicStats,
    queryFn: () => fetchJson<{ activeNow?: number; totalReported: number }>("https://homeio.app/api/stats"),
    staleTime: STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rows = [
    { label: "GitHub", value: `${formatCount(stars.data?.stargazers_count)} stars`, href: REPO_URL },
    { label: "Discord", value: "Join the community", href: DISCORD_URL },
    { label: "Active servers", value: formatCount(stats.data?.activeNow), href: TELEMETRY_STATS_PAGE_URL },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className={cn(SETTINGS_PANEL_INSET, "flex items-center gap-3 px-4 py-4")}>
        <img src="/icon.png" alt="" className="size-12 rounded-xl" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">Homeio</span>
          <a
            href={`${REPO_URL}/releases/tag/v${version}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-primary hover:underline"
          >
            v{version} · release notes
          </a>
        </div>
      </div>

      <SectionDivider title="Community" />
      <div className={cn(SETTINGS_PANEL_INSET, "divide-y divide-glass-border/50 px-4")}>
        {rows.map((row) => (
          <a
            key={row.label}
            href={row.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between py-2.5"
          >
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground group-hover:text-primary">
              {row.value}
              <ExternalLink className="size-3" />
            </span>
          </a>
        ))}
      </div>

      <SectionDivider title="Support Homeio" />
      <div className="flex flex-wrap gap-2">
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/25"
        >
          Sponsor on GitHub
        </a>
        <a
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-glass-border bg-background/55 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Buy me a coffee
        </a>
      </div>
    </div>
  );
}
