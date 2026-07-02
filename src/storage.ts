import { Preferences } from "@capacitor/preferences";

/**
 * A Homeio server the user has added. We persist the reachable address and an
 * optional username for convenience. We deliberately do NOT persist passwords:
 * the user authenticates on the server's own first-party `/login` page (where
 * the device password manager can offer to save it). Silent auto-login is a
 * documented Phase 2 enhancement (see doc/modules/mobile-app.md).
 */
export type SavedServer = {
  id: string;
  label: string;
  /** Normalized origin, e.g. "http://homeio.tailnet-name.ts.net:3000". */
  address: string;
  username?: string;
  lastConnectedAt?: number;
};

const SERVERS_KEY = "homeio.servers";

export async function loadServers(): Promise<SavedServer[]> {
  const { value } = await Preferences.get({ key: SERVERS_KEY });
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedServer);
  } catch {
    return [];
  }
}

async function saveServers(servers: SavedServer[]): Promise<void> {
  await Preferences.set({ key: SERVERS_KEY, value: JSON.stringify(servers) });
}

export async function upsertServer(server: SavedServer): Promise<SavedServer[]> {
  const servers = await loadServers();
  const existingIndex = servers.findIndex(
    (s) => s.id === server.id || s.address === server.address,
  );
  if (existingIndex >= 0) {
    servers[existingIndex] = { ...servers[existingIndex], ...server };
  } else {
    servers.push(server);
  }
  await saveServers(servers);
  return servers;
}

export async function removeServer(id: string): Promise<SavedServer[]> {
  const servers = (await loadServers()).filter((s) => s.id !== id);
  await saveServers(servers);
  return servers;
}

export async function markConnected(id: string): Promise<void> {
  const servers = await loadServers();
  const server = servers.find((s) => s.id === id);
  if (!server) return;
  server.lastConnectedAt = Date.now();
  await saveServers(servers);
}

export function newServerId(): string {
  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isSavedServer(value: unknown): value is SavedServer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SavedServer).id === "string" &&
    typeof (value as SavedServer).address === "string"
  );
}
