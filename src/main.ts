import "./styles.css";
import { normalizeAddress, probeServer } from "./connect";
import {
  clearLastConnected,
  loadAutoReconnect,
  loadBiometricLock,
  lastConnected,
  loadServers,
  markConnected,
  moveServer,
  newServerId,
  removeServer,
  setAutoReconnect,
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
const ICON_GRIP = `<svg ${ICON_ATTRS}><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>`;
const ICON_GEAR = `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_TRASH = `<svg ${ICON_ATTRS}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

/** What the dot on a card is saying right now. */
type Reachability = "checking" | "online" | "offline";

let servers: SavedServer[] = [];
let busy = false;
let biometricLock = false;
let autoReconnect = true;
let settingsOpen = false;
/** Set while the app is on its way back to the last server, with a way out. */
let reconnecting: SavedServer | null = null;
const reachability = new Map<string, Reachability>();

async function init() {
  // Arriving from Disconnect: forget where we were before anything can send us
  // back there, and strip the flag so a reload does not re-run it.
  const disconnected = new URLSearchParams(window.location.search).has("disconnect");
  if (disconnected) {
    await clearLastConnected();
    window.history.replaceState(null, "", window.location.pathname);
  }

  [servers, biometricLock, autoReconnect] = await Promise.all([
    loadServers(),
    loadBiometricLock(),
    loadAutoReconnect(),
  ]);

  const resume = disconnected ? null : autoReconnect ? lastConnected(servers) : null;
  if (resume) {
    reconnecting = resume;
    render();
    void connect(resume);
    return;
  }
  // Paint the saved list first and probe afterwards: the addresses are already
  // on the device, so there is no reason to stare at nothing while the network
  // decides. Dots fill in as answers arrive.
  render();
  void refreshReachability();

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

  // Cancelled while the probe was out: the user asked for the list, so give
  // them the list rather than navigating out from under them.
  if (reconnecting === null && busy === false) return;

  if (!probe.ok) {
    reconnecting = null;
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

function cancelReconnect() {
  reconnecting = null;
  busy = false;
  render();
  void refreshReachability();
}

async function handleToggleAutoReconnect() {
  autoReconnect = !autoReconnect;
  await setAutoReconnect(autoReconnect);
  render();
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
  reachability.delete(id);
  render();
}

/**
 * Probe every saved server at once and paint each dot as its answer lands.
 *
 * A shorter timeout than a connect attempt: this is a dot, not a decision, and
 * a dead address should stop claiming to be "checking" long before the six
 * seconds it takes to give up on a real connection.
 */
async function refreshReachability() {
  const pending = servers.map(async (server) => {
    reachability.set(server.id, "checking");
    const probe = await probeServer(server.address, 3500);
    reachability.set(server.id, probe.ok ? "online" : "offline");
    paintDot(server.id);
  });

  await Promise.allSettled(pending);
}

/**
 * Touch only the dot. A full re-render here would tear down a card the user is
 * mid-swipe or mid-drag on, and probes land at arbitrary moments.
 */
function paintDot(id: string) {
  const dot = root!.querySelector<HTMLElement>(`[data-dot="${id}"]`);
  if (!dot) return;
  dot.className = `server-dot ${reachability.get(id) ?? "checking"}`;
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
  if (reconnecting) {
    renderReconnecting(reconnecting);
    return;
  }

  // Stored order, not last-connected order: the list is draggable now, and a
  // list that rearranges itself behind the user is not a list they arranged.
  const sorted = servers;

  root!.innerHTML = `
    <main class="screen">
      <div class="panel">
        <div class="hero">
          <div class="hero-surface">
            <img src="/icon.png" alt="Homeio" width="64" height="64" />
          </div>
          <div class="hero-pill">Home server</div>
        </div>

        <button type="button" id="open-settings" class="gear" aria-label="App settings">
          ${ICON_GEAR}
        </button>

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

        <p class="hint">
          Use your tailnet address (<code>homeio.tailnet.ts.net:3000</code>) with the
          Tailscale app connected, or your public server URL
          (<code>https://…</code>). You'll sign in on the next screen.
        </p>
      </div>
      ${renderSettingsSheet()}
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

  document.getElementById("open-settings")?.addEventListener("click", () => {
    settingsOpen = true;
    render();
  });

  document.getElementById("settings-backdrop")?.addEventListener("click", () => {
    settingsOpen = false;
    render();
  });

  document.getElementById("lock-toggle")?.addEventListener("click", () => {
    void handleToggleLock();
  });

  document.getElementById("auto-toggle")?.addEventListener("click", () => {
    void handleToggleAutoReconnect();
  });

  root!.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.remove;
      if (id) void handleRemove(id);
    });
  });

  root!.querySelectorAll<HTMLElement>("[data-card]").forEach(attachSwipe);
  root!.querySelectorAll<HTMLElement>("[data-grip]").forEach(attachDrag);
}

/** How far a card must travel before the delete action is considered open. */
const SWIPE_OPEN_PX = 72;

let openCardId: string | null = null;

function closeOpenCard() {
  if (!openCardId) return;
  const open = root!.querySelector<HTMLElement>(`[data-card="${openCardId}"]`);
  if (open) {
    open.style.transition = "";
    open.style.transform = "";
  }
  openCardId = null;
}

/**
 * Swipe a card left to uncover its delete button.
 *
 * Reveal rather than delete-on-swipe: a list of servers is small and rarely
 * edited, so an accidental flick must not remove one. The second tap is the
 * confirmation, and it is the same button the card was hiding.
 */
function attachSwipe(card: HTMLElement) {
  const id = card.dataset.card;
  if (!id) return;

  let startX = 0;
  let startY = 0;
  let offset = 0;
  let horizontal: boolean | null = null;

  card.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("[data-grip]")) return;
    startX = event.clientX;
    startY = event.clientY;
    horizontal = null;
    card.style.transition = "";
  });

  card.addEventListener("pointermove", (event) => {
    if (event.buttons === 0) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    // Decide once which gesture this is. Without the lock, a diagonal scroll
    // drags the card sideways a little on every swipe down the page.
    if (horizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      horizontal = Math.abs(dx) > Math.abs(dy);
      // Capture is an optimisation, not a requirement: a pointer that has
      // already been released throws here, and the gesture still works without
      // it, so a failure must not take the swipe down with it.
      if (horizontal) try { card.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    if (!horizontal) return;

    const base = openCardId === id ? -SWIPE_OPEN_PX : 0;
    offset = Math.min(0, Math.max(-SWIPE_OPEN_PX - 16, base + dx));
    card.style.transform = `translateX(${offset}px)`;
  });

  function settle() {
    if (horizontal === null) return;
    card.style.transition = "transform 180ms ease";

    if (offset < -SWIPE_OPEN_PX / 2) {
      if (openCardId && openCardId !== id) closeOpenCard();
      openCardId = id!;
      card.style.transform = `translateX(${-SWIPE_OPEN_PX}px)`;
    } else {
      if (openCardId === id) openCardId = null;
      card.style.transform = "";
    }
    horizontal = null;
  }

  card.addEventListener("pointerup", settle);
  card.addEventListener("pointercancel", settle);
}

/**
 * Drag a card by its grip to reorder the list.
 *
 * The grip exists so the two gestures never fight: anywhere else on the card is
 * a horizontal swipe, and a press that starts on the grip is a vertical move.
 */
function attachDrag(grip: HTMLElement) {
  const id = grip.dataset.grip;
  if (!id) return;

  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    closeOpenCard();

    const rows = Array.from(root!.querySelectorAll<HTMLElement>("[data-row]"));
    const fromIndex = rows.findIndex((row) => row.dataset.row === id);
    const row = rows[fromIndex];
    if (!row) return;

    const height = row.getBoundingClientRect().height + 8;
    const startY = event.clientY;
    let targetIndex = fromIndex;

    try { grip.setPointerCapture(event.pointerId); } catch { /* see attachSwipe */ }
    row.classList.add("dragging");

    const onMove = (move: PointerEvent) => {
      const dy = move.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;

      // One card per height travelled, clamped to the list — the same rule the
      // reorder helper enforces, so a wild drag cannot invent an index.
      const shift = Math.round(dy / height);
      targetIndex = Math.min(rows.length - 1, Math.max(0, fromIndex + shift));

      rows.forEach((other, index) => {
        if (index === fromIndex) return;
        const movedUp = index > fromIndex && index <= targetIndex;
        const movedDown = index < fromIndex && index >= targetIndex;
        other.style.transform = movedUp
          ? `translateY(${-height}px)`
          : movedDown
            ? `translateY(${height}px)`
            : "";
      });
    };

    const onUp = async () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      row.classList.remove("dragging");

      if (targetIndex !== fromIndex) {
        servers = await moveServer(id, targetIndex);
      }
      // Re-render either way: the transforms above are throwaway presentation,
      // and the list is the truth.
      render();
    };

    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", () => void onUp());
    grip.addEventListener("pointercancel", () => void onUp());
  });
}

/**
 * The screen between opening the app and being back on the server. It always
 * offers a way out: an address that has gone away must not be able to trap the
 * user in a spinner with no route to the list.
 */
function renderReconnecting(server: SavedServer) {
  root!.innerHTML = `
    <main class="screen">
      <div class="panel">
        <div class="hero">
          <div class="hero-surface">
            <img src="/icon.png" alt="Homeio" width="64" height="64" />
          </div>
          <div class="hero-pill">Home server</div>
        </div>

        <p class="title">${escapeHtml(server.label)}</p>
        <p class="subtitle">Reconnecting…</p>

        <button type="button" id="cancel-reconnect" class="ghost-button">
          Choose another server
        </button>
      </div>
    </main>
  `;

  document.getElementById("cancel-reconnect")?.addEventListener("click", cancelReconnect);
}

/** Device settings, which is why they live here and not in Homeio's own UI. */
function renderSettingsSheet(): string {
  if (!settingsOpen) return "";

  return `
    <div class="sheet-backdrop" id="settings-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="App settings">
      <span class="sheet-grabber"></span>

      <button type="button" id="lock-toggle" class="lock-row" role="switch" aria-checked="${biometricLock}">
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

      <button type="button" id="auto-toggle" class="lock-row" role="switch" aria-checked="${autoReconnect}">
        <span class="field-icon">${ICON_SERVER}</span>
        <span class="lock-text">
          <span class="lock-label">Reconnect on open</span>
          <span class="lock-meta">
            ${
              autoReconnect
                ? "Go straight to the server you used last"
                : "Always start on the server list"
            }
          </span>
        </span>
        <span class="switch ${autoReconnect ? "on" : ""}"><span class="knob"></span></span>
      </button>
    </section>
  `;
}

function renderServerCard(server: SavedServer): string {
  const meta = server.username ? `${server.username} · ${server.address}` : server.address;
  const status = reachability.get(server.id) ?? "checking";

  return `
    <article class="server-row" data-row="${server.id}">
      <button
        class="server-delete"
        data-remove="${server.id}"
        aria-label="Remove ${escapeHtml(server.label)}"
      >${ICON_TRASH}</button>

      <div class="server-card" data-card="${server.id}">
        <span
          class="server-grip"
          data-grip="${server.id}"
          role="button"
          aria-label="Reorder ${escapeHtml(server.label)}"
        >${ICON_GRIP}</span>
        <button class="server-main" data-connect="${server.id}" ${busy ? "disabled" : ""}>
          <span class="server-text">
            <span class="server-label">${escapeHtml(server.label)}</span>
            <span class="server-meta">${escapeHtml(meta)}</span>
          </span>
        </button>
        <span class="server-dot ${status}" data-dot="${server.id}" aria-hidden="true"></span>
      </div>
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
