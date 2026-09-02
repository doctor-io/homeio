import "./styles.css";
import { normalizeAddress, probeServer } from "./connect";
import {
  loadBiometricLock,
  loadServers,
  markConnected,
  newServerId,
  removeServer,
  setBiometricLock,
  upsertServer,
  type SavedServer,
} from "./storage";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root");

// Lucide outline icons, matching the web login form's field icons.
const ICON_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON_SERVER = `<svg ${ICON_ATTRS}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;
const ICON_TAG = `<svg ${ICON_ATTRS}><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>`;
const ICON_USER = `<svg ${ICON_ATTRS}><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
const ICON_ARROW = `<svg ${ICON_ATTRS}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
const ICON_LOCK = `<svg ${ICON_ATTRS}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

let servers: SavedServer[] = [];
let busy = false;
let biometricLock = false;

async function init() {
  [servers, biometricLock] = await Promise.all([loadServers(), loadBiometricLock()]);
  render();

  // The hardware back button is handled natively in MainActivity: history
  // first, then back to this launcher, then exit. It cannot live here — this
  // page's listeners die as soon as the WebView navigates onto a server.
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
  //
  // `/m` is the phone UI. A server that predates it answers with its own 404,
  // which this page cannot detect — the probe is cross-origin, and a `no-cors`
  // response is opaque. MainActivity watches the WebView's status codes and
  // sends those servers on to the desktop shell instead.
  window.location.href = `${server.address}/m`;
}

async function handleToggleLock() {
  // Written here, enforced natively: the launcher's JavaScript is gone the
  // moment the WebView navigates onto a server, so it cannot be what stands
  // between the phone and the dashboard.
  biometricLock = !biometricLock;
  await setBiometricLock(biometricLock);
  render();
}

async function handleRemove(id: string) {
  servers = await removeServer(id);
  render();
}

function showError(message: string) {
  const el = document.getElementById("error");
  const wrap = document.getElementById("error-wrap");
  if (el && wrap) {
    el.textContent = message;
    wrap.hidden = false;
  }
}

function render() {
  const sorted = [...servers].sort(
    (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0),
  );

  root!.innerHTML = `
    <main class="screen">
      <div class="panel">
        <div class="hero">
          <div class="hero-surface">
            <img src="/icon.png" alt="Homeio" width="64" height="64" />
          </div>
          <div class="hero-pill">Home server</div>
        </div>

        <p class="title">Welcome back</p>
        <p class="subtitle">Connect to your server</p>

        <div id="error-wrap" class="error-wrap" hidden>
          <div class="error"><span id="error"></span></div>
        </div>

        ${
          sorted.length
            ? `<section class="servers" aria-label="Saved servers">
                ${sorted.map(renderServerCard).join("")}
              </section>`
            : ""
        }

        <form id="add-form" class="add-form" novalidate>
          <div class="field">
            <div class="field-icon">${ICON_SERVER}</div>
            <input
              name="address"
              inputmode="url"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              placeholder="Server address"
              required
            />
          </div>
          <div class="field">
            <div class="field-icon">${ICON_TAG}</div>
            <input name="label" placeholder="Name (optional)" autocapitalize="words" />
          </div>
          <div class="field">
            <div class="field-icon">${ICON_USER}</div>
            <input
              name="username"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              placeholder="Username (optional)"
            />
          </div>
        </form>

        <button type="submit" form="add-form" class="submit" ${busy ? "disabled" : ""}>
          <span>${busy ? "Connecting..." : "Connect"}</span>
          ${ICON_ARROW}
        </button>

        <button
          type="button"
          id="lock-toggle"
          class="lock-row"
          role="switch"
          aria-checked="${biometricLock ? "true" : "false"}"
        >
          <span class="field-icon">${ICON_LOCK}</span>
          <span class="lock-text">
            <span class="lock-label">Require unlock</span>
            <span class="lock-meta">
              ${
                biometricLock
                  ? "Face or fingerprint when you open Homeio"
                  : "Anyone with this phone can open your server"
              }
            </span>
          </span>
          <span class="switch ${biometricLock ? "on" : ""}"><span class="knob"></span></span>
        </button>

        <p class="hint">
          Use your tailnet address (<code>homeio.tailnet.ts.net:3000</code>) with the
          Tailscale app connected, or your public server URL
          (<code>https://…</code>). You'll sign in on the next screen.
        </p>
      </div>
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

  document.getElementById("lock-toggle")?.addEventListener("click", () => {
    void handleToggleLock();
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
        <span class="field-icon">${ICON_SERVER}</span>
        <span class="server-text">
          <span class="server-label">${escapeHtml(server.label)}</span>
          <span class="server-meta">${escapeHtml(meta)}</span>
        </span>
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
