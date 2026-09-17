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

/**
 * Read natively as well: `MainActivity` gates the app on this value, and
 * Capacitor Preferences stores it in the `CapacitorStorage` SharedPreferences
 * file under this exact key. Keep the string values "true"/"false" — the native
 * side compares text, not JSON.
 */
const BIOMETRIC_LOCK_KEY = "homeio.biometricLock";
const AUTO_RECONNECT_KEY = "homeio.autoReconnect";

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

/**
 * Move one item to a new index, pure and total: an unknown id or an index off
 * either end returns the list unchanged rather than dropping an entry.
 */
export function reorder<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= list.length) return list;
  if (toIndex < 0 || toIndex >= list.length) return list;
  if (fromIndex === toIndex) return list;

  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Stored order is the order shown. Nothing re-sorts by last-connected any more:
 * a list the user arranged by hand must not rearrange itself the next time they
 * connect to something.
 */
export async function moveServer(id: string, toIndex: number): Promise<SavedServer[]> {
  const servers = await loadServers();
  const fromIndex = servers.findIndex((server) => server.id === id);
  const next = reorder(servers, fromIndex, toIndex);
  if (next !== servers) await saveServers(next);
  return next;
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

export async function loadBiometricLock(): Promise<boolean> {
  const { value } = await Preferences.get({ key: BIOMETRIC_LOCK_KEY });
  return value === "true";
}

export async function setBiometricLock(enabled: boolean): Promise<void> {
  await Preferences.set({ key: BIOMETRIC_LOCK_KEY, value: enabled ? "true" : "false" });
}

/**
 * Opening the app should put you back where you were. Defaults to on: the list
 * exists for the rare second server, not for the daily case of one.
 */
export async function loadAutoReconnect(): Promise<boolean> {
  const { value } = await Preferences.get({ key: AUTO_RECONNECT_KEY });
  return value !== "false";
}

export async function setAutoReconnect(enabled: boolean): Promise<void> {
  await Preferences.set({ key: AUTO_RECONNECT_KEY, value: enabled ? "true" : "false" });
}

/** The server to go straight back to, or null when none has been used yet. */
export function lastConnected(servers: SavedServer[]): SavedServer | null {
  return (
    servers
      .filter((server) => typeof server.lastConnectedAt === "number")
      .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))[0] ?? null
  );
}

/**
 * Forget where we were, without forgetting the server itself. Disconnect has to
 * do this or auto-reconnect would carry the user straight back in.
 */
export async function clearLastConnected(): Promise<SavedServer[]> {
  const servers = await loadServers();
  const next = servers.map(({ lastConnectedAt: _dropped, ...server }) => server);
  await saveServers(next);
  return next;
}
