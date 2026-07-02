import "./styles.css";
import { App } from "@capacitor/app";
import { normalizeAddress, probeServer } from "./connect";
import {
  loadServers,
  markConnected,
  newServerId,
  removeServer,
  upsertServer,
  type SavedServer,
} from "./storage";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root");

let servers: SavedServer[] = [];
let busy = false;

async function init() {
  servers = await loadServers();
  render();

  // Android hardware back button: while on the launcher there's nothing to go
  // back to, so exit the app. (Once navigated onto a server origin, the WebView
  // handles its own history.)
  App.addListener("backButton", () => {
    void App.exitApp();
  });
}

function setBusy(value: boolean) {
  busy = value;
  render();
}

async function handleAdd(form: HTMLFormElement) {
  const data = new FormData(form);
  const addressRaw = String(data.get("address") ?? "");
  const username = String(data.get("username") ?? "").trim();
  const labelRaw = String(data.get("label") ?? "").trim();

  const normalized = normalizeAddress(addressRaw);
  if (!normalized.ok) {
    showError(normalized.error);
    return;
  }

  setBusy(true);
  const probe = await probeServer(normalized.origin);
  if (!probe.ok) {
    setBusy(false);
    showError(probe.error);
    return;
  }

  const server: SavedServer = {
    id: newServerId(),
    label: labelRaw || normalized.host,
    address: normalized.origin,
    username: username || undefined,
  };
  servers = await upsertServer(server);
  setBusy(false);
  await connect(server);
}

async function connect(server: SavedServer) {
  setBusy(true);
  const probe = await probeServer(server.address);
  if (!probe.ok) {
    setBusy(false);
    showError(probe.error);
    return;
  }
  await markConnected(server.id);
  // Navigate the WebView onto the server's own origin. From here the existing
  // Homeio web app runs first-party: its `/login` page handles username +
  // password (and TOTP), and the session cookie is stored for this origin.
  window.location.href = server.address;
}

async function handleRemove(id: string) {
  servers = await removeServer(id);
  render();
}

function showError(message: string) {
  const el = document.getElementById("error");
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function render() {
  const sorted = [...servers].sort(
    (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0),
  );

  root!.innerHTML = `
    <main class="screen">
      <header class="brand">
        <h1>Homeio</h1>
        <p class="subtitle">Connect to your home server over Tailscale</p>
      </header>

      <p id="error" class="error" hidden></p>

      ${
        sorted.length
          ? `<section class="servers" aria-label="Saved servers">
              ${sorted.map(renderServerCard).join("")}
            </section>`
          : `<p class="empty">No servers yet. Add your Homeio server below.</p>`
      }

      <form id="add-form" class="add-form" novalidate>
        <h2>Add a server</h2>
        <label>
          <span>Server address</span>
          <input
            name="address"
            inputmode="url"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            placeholder="homeio.tailnet-name.ts.net:3000"
            required
          />
        </label>
        <label>
          <span>Name <em>(optional)</em></span>
          <input name="label" placeholder="Home server" autocapitalize="words" />
        </label>
        <label>
          <span>Username <em>(optional)</em></span>
          <input
            name="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            placeholder="admin"
          />
        </label>
        <button type="submit" ${busy ? "disabled" : ""}>
          ${busy ? "Connecting…" : "Add &amp; Connect"}
        </button>
        <p class="hint">
          You'll sign in with your password on the next screen. Make sure the
          Tailscale app is connected first.
        </p>
      </form>
    </main>
  `;

  const form = document.getElementById("add-form") as HTMLFormElement | null;
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!busy) void handleAdd(form);
  });

  root!.querySelectorAll<HTMLButtonElement>("[data-connect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const server = servers.find((s) => s.id === btn.dataset.connect);
      if (server && !busy) void connect(server);
    });
  });

  root!.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.remove;
      if (id) void handleRemove(id);
    });
  });
}

function renderServerCard(server: SavedServer): string {
  const meta = server.username ? `${server.username} · ${server.address}` : server.address;
  return `
    <article class="server-card">
      <button class="server-main" data-connect="${server.id}" ${busy ? "disabled" : ""}>
        <span class="server-label">${escapeHtml(server.label)}</span>
        <span class="server-meta">${escapeHtml(meta)}</span>
      </button>
      <button
        class="server-remove"
        data-remove="${server.id}"
        aria-label="Remove ${escapeHtml(server.label)}"
      >✕</button>
    </article>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

void init();
