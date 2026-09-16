"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/shared/query-keys";
import { throwIfElevationRequired } from "@/modules/auth/elevation/elevation-error";
import { useElevation } from "@/modules/auth/elevation/elevation-provider";
import type {
  DiskListResponse,
  DiskFormatRequest,
  DiskMountRequest,
  DiskUnmountRequest,
  DiskCreatePartitionRequest,
  DiskDeletePartitionRequest,
  DiskWipeRequest,
} from "@/lib/shared/contracts/disks";

async function fetchDisks(): Promise<DiskListResponse> {
  const res = await fetch("/api/v1/system/disks");
  if (!res.ok) throw new Error("Failed to fetch disks");
  const json = (await res.json()) as { data: DiskListResponse };
  return json.data;
}

async function postDiskAction(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Throws ElevationRequiredError when that is what the refusal is, so the
    // caller can offer the password instead of only reporting a failure.
    const json = await throwIfElevationRequired(res);
    throw new Error(json.error ?? "Action failed");
  }
}

export function useDisks() {
  return useQuery({
    queryKey: queryKeys.disks,
    queryFn: fetchDisks,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useDiskFormat() {
  const { runElevated } = useElevation();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DiskFormatRequest) =>
      // Irreversible: the server refuses without a fresh password, and
      // this turns that refusal into a prompt rather than an error.
      runElevated(() => postDiskAction("/api/v1/system/disks/format", req)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.disks }),
  });
}

export function useDiskMount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DiskMountRequest) =>
      postDiskAction("/api/v1/system/disks/mount", req),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.disks }),
  });
}

export function useDiskUnmount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DiskUnmountRequest) =>
      postDiskAction("/api/v1/system/disks/unmount", req),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.disks }),
  });
}

export function useDiskCreatePartition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DiskCreatePartitionRequest) =>
      postDiskAction("/api/v1/system/disks/create-partition", req),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.disks }),
  });
}

export function useDiskDeletePartition() {
  const { runElevated } = useElevation();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DiskDeletePartitionRequest) =>
      // Irreversible: the server refuses without a fresh password, and
      // this turns that refusal into a prompt rather than an error.
      runElevated(() => postDiskAction("/api/v1/system/disks/delete-partition", req)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.disks }),
  });
}

export function useDiskWipe() {
  const { runElevated } = useElevation();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DiskWipeRequest) =>
      // Irreversible: the server refuses without a fresh password, and
      // this turns that refusal into a prompt rather than an error.
      runElevated(() => postDiskAction("/api/v1/system/disks/wipe", req)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.disks }),
  });
}
