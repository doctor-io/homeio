"use client";

import { useState } from "react";
import { Search } from "@/components/icons/platform-icons";
import type { WeatherLocation } from "@/lib/desktop/appearance";
import { resolveCityAndCountry } from "@/modules/system/hooks/useUserLocation";
import { SETTINGS_PANEL_INSET } from "@/modules/settings/components/panel/surface";
import { cn } from "@/lib/utils";

type GeocodingResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  country_code?: string;
};

type WeatherLocationRowProps = {
  value: WeatherLocation | null;
  onChange: (value: WeatherLocation | null) => void;
};

const SMALL_BUTTON =
  "h-8 shrink-0 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground transition-all hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50";

function describe(value: WeatherLocation | null) {
  if (!value) return "Not set. Each browser asks for its own location.";
  const place = [value.city, value.country].filter(Boolean).join(", ");
  return place || `${value.latitude.toFixed(2)}, ${value.longitude.toFixed(2)}`;
}

async function searchCities(name: string): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({ name, count: "6", language: "en", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
  if (!res.ok) throw new Error("search failed");
  const json = (await res.json()) as { results?: GeocodingResult[] };
  return json.results ?? [];
}

export function WeatherLocationRow({ value, onChange }: WeatherLocationRowProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const name = query.trim();
    if (name.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const found = await searchCities(name);
      setResults(found);
      if (found.length === 0) setError("No city found with that name.");
    } catch {
      setResults(null);
      setError("Could not reach the city search. Check the internet connection.");
    } finally {
      setBusy(false);
    }
  }

  function pick(result: GeocodingResult) {
    onChange({
      latitude: result.latitude,
      longitude: result.longitude,
      city: result.name,
      country: result.country_code?.toUpperCase() ?? result.country,
    });
    setResults(null);
    setQuery("");
  }

  function useBrowserLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser can't share its location. Search for a city instead.");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const place = await resolveCityAndCountry(coords);
        onChange({ ...coords, ...place });
        setBusy(false);
      },
      () => {
        setError("The browser refused to share its location (it needs HTTPS or localhost). Search for a city instead.");
        setBusy(false);
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  return (
    <div className={cn(SETTINGS_PANEL_INSET, "flex flex-col gap-3 px-4 py-3")}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Weather location</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">{describe(value)}</div>
        </div>
        <form onSubmit={runSearch} className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city"
            aria-label="Search a city"
            className="h-8 w-44 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-primary/40 focus:outline-none"
          />
          <button type="submit" disabled={busy || query.trim().length < 2} className={SMALL_BUTTON} aria-label="Search">
            <Search className="size-3.5" />
          </button>
        </form>
      </div>

      {results && results.length > 0 ? (
        <div className="flex flex-col divide-y divide-glass-border/50 rounded-lg border border-glass-border">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => pick(result)}
              className="flex items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-primary/10"
            >
              <span className="truncate text-foreground">
                {result.name}
                {result.admin1 ? <span className="text-muted-foreground">, {result.admin1}</span> : null}
              </span>
              <span className="shrink-0 text-muted-foreground">{result.country}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="text-[11px] text-status-amber">{error}</div> : null}

      <div className="flex items-center gap-1.5">
        <button type="button" onClick={useBrowserLocation} disabled={busy} className={SMALL_BUTTON}>
          Use this browser&apos;s location
        </button>
        {value ? (
          <button type="button" onClick={() => onChange(null)} disabled={busy} className={SMALL_BUTTON}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
