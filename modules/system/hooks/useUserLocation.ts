"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sanitizeWeatherLocation } from "@/lib/desktop/appearance";
import { queryKeys } from "@/lib/shared/query-keys";

const USER_LOCATION_STORAGE_KEY = "weather.user-location.v1";
const USER_LOCATION_REVERSE_CACHE_STORAGE_KEY = "weather.user-location.reverse.v1";
const NOMINATIM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NOMINATIM_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const NOMINATIM_COORD_PRECISION = 3;

type ResolvedPlace = {
  city?: string;
  country?: string;
};

type ReverseCacheEntry = ResolvedPlace & {
  key: string;
  resolvedAt: number;
};

let reverseCacheEntry: ReverseCacheEntry | null = null;
let reverseCacheLoaded = false;
let nominatimRateLimitedUntilMs = 0;
const reverseLookupInFlight = new Map<string, Promise<ResolvedPlace>>();

export type UserLocation = {
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
};

export type UseUserLocationReturn = {
  location: UserLocation | null;
  loading: boolean;
  error: string | null;
  permissionStatus: PermissionState | null;
  requestLocation: () => void;
  setManualLocation: (location: UserLocation) => void;
};

type NominatimReverseResponse = {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    country_code?: string;
  };
};

function toReverseLookupKey(location: {
  latitude: number;
  longitude: number;
}) {
  return `${location.latitude.toFixed(NOMINATIM_COORD_PRECISION)},${location.longitude.toFixed(
    NOMINATIM_COORD_PRECISION,
  )}`;
}

function loadReverseCacheFromStorage() {
  if (reverseCacheLoaded || typeof localStorage === "undefined") return;
  reverseCacheLoaded = true;

  try {
    const raw = localStorage.getItem(USER_LOCATION_REVERSE_CACHE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      key?: unknown;
      city?: unknown;
      country?: unknown;
      resolvedAt?: unknown;
    };
    if (typeof parsed.key !== "string") return;
    if (typeof parsed.resolvedAt !== "number" || !Number.isFinite(parsed.resolvedAt)) {
      return;
    }

    reverseCacheEntry = {
      key: parsed.key,
      city: typeof parsed.city === "string" ? parsed.city : undefined,
      country: typeof parsed.country === "string" ? parsed.country : undefined,
      resolvedAt: parsed.resolvedAt,
    };
  } catch {
    reverseCacheEntry = null;
  }
}

function getCachedReverseLookup(key: string) {
  if (!reverseCacheEntry) return null;
  if (reverseCacheEntry.key !== key) return null;
  if (Date.now() - reverseCacheEntry.resolvedAt > NOMINATIM_CACHE_TTL_MS) {
    reverseCacheEntry = null;
    return null;
  }

  return {
    city: reverseCacheEntry.city,
    country: reverseCacheEntry.country,
  } satisfies ResolvedPlace;
}

function persistReverseLookup(key: string, place: ResolvedPlace) {
  reverseCacheEntry = {
    key,
    city: place.city,
    country: place.country,
    resolvedAt: Date.now(),
  };
  try {
    localStorage.setItem(
      USER_LOCATION_REVERSE_CACHE_STORAGE_KEY,
      JSON.stringify(reverseCacheEntry),
    );
  } catch {
    // Best effort only.
  }
}

function toLocationError(error: GeolocationPositionError) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied";
    case error.POSITION_UNAVAILABLE:
      return "Location unavailable";
    case error.TIMEOUT:
      return "Location request timed out";
    default:
      return "Failed to get location";
  }
}

function toStoredLocation(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      latitude?: unknown;
      longitude?: unknown;
    };
    const latitude =
      typeof parsed.latitude === "number" && Number.isFinite(parsed.latitude)
        ? parsed.latitude
        : null;
    const longitude =
      typeof parsed.longitude === "number" && Number.isFinite(parsed.longitude)
        ? parsed.longitude
        : null;
    if (latitude === null || longitude === null) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return null;
    }
    const city =
      typeof parsed === "object" &&
      parsed &&
      "city" in parsed &&
      typeof (parsed as { city?: unknown }).city === "string"
        ? (parsed as { city?: string }).city
        : undefined;
    const country =
      typeof parsed === "object" &&
      parsed &&
      "country" in parsed &&
      typeof (parsed as { country?: unknown }).country === "string"
        ? (parsed as { country?: string }).country
        : undefined;

    return { latitude, longitude, city, country } satisfies UserLocation;
  } catch {
    return null;
  }
}

export async function resolveCityAndCountry(location: {
  latitude: number;
  longitude: number;
}) {
  loadReverseCacheFromStorage();
  const key = toReverseLookupKey(location);
  const cached = getCachedReverseLookup(key);
  if (cached) return cached;

  if (Date.now() < nominatimRateLimitedUntilMs) {
    return { city: undefined, country: undefined };
  }

  const existingRequest = reverseLookupInFlight.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${location.latitude}&lon=${location.longitude}&format=json`,
        { headers: { "User-Agent": "Homeio Dashboard" } },
      );
      if (response.status === 429) {
        nominatimRateLimitedUntilMs = Date.now() + NOMINATIM_RATE_LIMIT_COOLDOWN_MS;
        return { city: undefined, country: undefined };
      }
      if (!response.ok) {
        return { city: undefined, country: undefined };
      }

      const json = (await response.json()) as NominatimReverseResponse;
      const city =
        json.address?.city ?? json.address?.town ?? json.address?.village;
      const country = json.address?.country_code?.toUpperCase();
      const resolved = {
        city,
        country,
      } satisfies ResolvedPlace;
      persistReverseLookup(key, resolved);
      return resolved;
    } catch {
      return { city: undefined, country: undefined };
    } finally {
      reverseLookupInFlight.delete(key);
    }
  })();

  reverseLookupInFlight.set(key, request);
  return request;
}

export function resetUserLocationReverseGeocodeStateForTests() {
  reverseCacheEntry = null;
  reverseCacheLoaded = false;
  nominatimRateLimitedUntilMs = 0;
  reverseLookupInFlight.clear();
}

async function fetchServerWeatherLocation(): Promise<UserLocation | null> {
  const res = await fetch("/api/v1/settings/appearance", { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { weatherLocation?: unknown } };
  return sanitizeWeatherLocation(json.data?.weatherLocation);
}

export function useUserLocation(): UseUserLocationReturn {
  // The location set in Settings wins: it needs no browser permission or HTTPS.
  const serverLocationQuery = useQuery({
    queryKey: queryKeys.weatherLocation,
    queryFn: fetchServerWeatherLocation,
    staleTime: Infinity,
  });
  const serverLocation = serverLocationQuery.data ?? null;
  const serverLocationPending = serverLocationQuery.isPending;

  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionState | null>(null);

  const persistLocation = useCallback((nextLocation: UserLocation) => {
    try {
      localStorage.setItem(USER_LOCATION_STORAGE_KEY, JSON.stringify(nextLocation));
    } catch {
      // Location persistence is best-effort only.
    }
  }, []);

  const requestLocationFromBrowser = useCallback((background = false) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (!background) {
        setError("Geolocation not supported");
      }
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError(null);
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const baseLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const { city, country } = await resolveCityAndCountry(baseLocation);
        const nextLocation = {
          ...baseLocation,
          city,
          country,
        } satisfies UserLocation;
        setLocation(nextLocation);
        persistLocation(nextLocation);
        setError(null);
        setLoading(false);
      },
      (positionError) => {
        if (!background) {
          setError(toLocationError(positionError));
        }
        setLoading(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 600_000,
      },
    );
  }, [persistLocation]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;

    let permission: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((result) => {
        permission = result;
        setPermissionStatus(result.state);
        result.onchange = () => {
          setPermissionStatus(result.state);
        };
      })
      .catch(() => {
        // Permissions API support is optional.
      });

    return () => {
      if (permission) permission.onchange = null;
    };
  }, []);

  useEffect(() => {
    if (serverLocationPending || serverLocation) return;

    let savedLocation: UserLocation | null = null;
    try {
      savedLocation = toStoredLocation(
        localStorage.getItem(USER_LOCATION_STORAGE_KEY),
      );
    } catch {
      savedLocation = null;
    }

    if (savedLocation) {
      setLocation(savedLocation);
      setLoading(false);
      requestLocationFromBrowser(true);
      return;
    }

    requestLocationFromBrowser();
  }, [requestLocationFromBrowser, serverLocationPending, serverLocation]);

  const setManualLocation = useCallback(
    (nextLocation: UserLocation) => {
      setLocation(nextLocation);
      persistLocation(nextLocation);
      setError(null);
      setLoading(false);
    },
    [persistLocation],
  );

  return {
    location: serverLocation ?? location,
    loading: serverLocationPending || (!serverLocation && loading),
    error: serverLocation ? null : error,
    permissionStatus,
    requestLocation: () => requestLocationFromBrowser(),
    setManualLocation,
  };
}
