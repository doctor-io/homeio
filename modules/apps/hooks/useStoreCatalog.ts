"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  StoreAppSummary,
  StoreCatalogCategory,
  StoreCatalogSource,
} from "@/lib/shared/contracts/apps";
import { queryKeys } from "@/lib/shared/query-keys";

type StoreCatalogResponse = {
  data: StoreAppSummary[];
  meta: {
    count: number;
    categories: StoreCatalogCategory[];
    featuredAppIds: string[];
    recommendedAppIds: string[];
    sourcePath: string;
    sources: StoreCatalogSource[];
  };
};

export type StoreCatalogResult = {
  apps: StoreAppSummary[];
  categories: StoreCatalogCategory[];
  featuredAppIds: string[];
  recommendedAppIds: string[];
  sourcePath: string;
  sources: StoreCatalogSource[];
};

type UseStoreCatalogOptions = {
  category?: string;
  search?: string;
  installedOnly?: boolean;
  updatesOnly?: boolean;
};

function buildCatalogUrl(options?: UseStoreCatalogOptions) {
  const params = new URLSearchParams();

  if (options?.category) params.set("category", options.category);
  if (options?.search) params.set("search", options.search);
  if (options?.installedOnly) params.set("installedOnly", "true");
  if (options?.updatesOnly) params.set("updatesOnly", "true");

  const query = params.toString();
  return query.length > 0 ? `/api/v1/store/apps?${query}` : "/api/v1/store/apps";
}

async function fetchStoreCatalog(options?: UseStoreCatalogOptions): Promise<StoreCatalogResult> {
  const endpoint = buildCatalogUrl(options);

  const response = await fetch(endpoint, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch store catalog (${response.status})`);
  }

  const json = (await response.json()) as StoreCatalogResponse;
  return {
    apps: json.data,
    categories: json.meta.categories,
    featuredAppIds: json.meta.featuredAppIds,
    recommendedAppIds: json.meta.recommendedAppIds,
    sourcePath: json.meta.sourcePath,
    sources: json.meta.sources,
  };
}

export function useStoreCatalog(options?: UseStoreCatalogOptions) {
  return useQuery({
    queryKey: [...queryKeys.storeCatalog, options ?? {}] as const,
    queryFn: () => fetchStoreCatalog(options),
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}
