"use client";

import { useQuery } from "@tanstack/react-query";
import type { UnmanagedContainer } from "@/lib/shared/contracts/docker";

async function fetchUnmanagedContainers() {
  const response = await fetch("/api/v1/docker/containers", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch containers (${response.status})`);
  }

  const json = (await response.json()) as { data: UnmanagedContainer[] };
  return json.data;
}

export function useUnmanagedContainers() {
  return useQuery({
    queryKey: ["docker", "unmanaged-containers"] as const,
    queryFn: fetchUnmanagedContainers,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}
