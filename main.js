// main.js — MyAnimeList Sync (per-player entry).
//
// Flow:
//   1. On a new file, parse the filename -> { title, episode, season }.
//   2. Resolve the series to a MAL anime id (cached, or via MAL search).
//   3. While playing, once watched progress passes the threshold (default 80%),
//      update my_list_status.num_watched_episodes on MyAnimeList.
//
// Login and match correction happen through a small standalone window
// (ui/panel.html), driven over postMessage.

const { core, event, menu, standaloneWindow, utils, console } = iina;
const parse = require("./src/parse.js");
const store = require("./src/store.js");
const mal   = require("./src/mal.js");

const CHECK_INTERVAL_MS = 5000;

// --- per-file state ---------------------------------------------------------

let parsed = null;        // { title, episode, season }
let key = null;           // series cache key
let match = null;         // { malId, title, numEpisodes }
let syncedThisFile = false;
let candidates = [];      // last MAL search results (for the panel's match mode)
let panelMode = "auth";   // "auth" | "match"

function log(msg)  { try { console.log("[mal-sync] " + msg); } catch (e) {} }
function osd(msg)  { try { core.osd("MAL: " + msg); } catch (e) {} }

function resetFileState() {
  parsed = null; key = null; match = null; syncedThisFile = false; candidates = [];
}

// --- token lifecycle --------------------------------------------------------

// Returns a valid access token, refreshing if needed, or null if not logged in.
async function getAccessToken() {
  const t = store.getTokens();
  if (!t.accessToken) return null;
  if (Date.now() < t.expiry - 60000) return t.accessToken; // still valid (>1 min left)

  const clientId = store.getClientId();
  if (!clientId || !t.refreshToken) return t.accessToken; // best effort with what we have
  try {
    const r = await mal.refreshToken(clientId, t.refreshToken);
    store.setTokens(r.access_token, r.refresh_token, r.expires_in);
    log("access token refreshed");
    return r.access_token;
  } catch (e) {
    log("refresh failed: " + e.message);
    return null;
  }
}

// --- matching ---------------------------------------------------------------

async function resolveMatch() {
  if (!parsed || parsed.episode == null) return;

  const cached = store.getMatch(key);
  if (cached) {
    match = cached;
    osd(cached.title + " — ep " + parsed.episode);
    return;
  }

  const token = await getAccessToken();
  if (!token) { osd('log in via the Plugin menu to enable sync'); return; }

  let results;
  try { results = await mal.searchAnime(token, parsed.title, 10); }
  catch (e) { log("search error: " + e.message); osd("search failed"); return; }

  candidates = results;
  if (!results.length) { osd('no match for "' + parsed.title + '"'); return; }

  const top = results[0];
  match = { malId: top.id, title: top.title, numEpisodes: top.num_episodes || 0 };
  store.setMatch(key, match);
  osd("matched " + top.title + " — ep " + parsed.episode + " (menu → Fix Match to change)");
}

async function handleNewFile(url) {
  resetFileState();
  if (core.status.isNetworkResource) { log("network resource, skipping"); return; }

  parsed = parse.parseFilename(url);
  key = parse.seriesKey(parsed);
  log("parsed: " + JSON.stringify(parsed));

  if (parsed.episode == null) { log("no episode number detected"); return; }
  await resolveMatch();
}

// --- syncing ----------------------------------------------------------------

async function doSync(force) {
  if (!store.getEnabled()) return;
  if (!match || !parsed || parsed.episode == null) {
    if (force) osd("nothing matched for this file");
    return;
  }
  const token = await getAccessToken();
  if (!token) { if (force) osd("not logged in"); return; }

  const ep = parsed.episode;
  try {
    const info = await mal.getAnime(token, match.malId, "num_episodes,my_list_status");
    const total = info.num_episodes || match.numEpisodes || 0;
    const cur = info.my_list_status ? (info.my_list_status.num_watched_episodes || 0) : 0;

    if (!force && ep <= cur) { log("ep " + ep + " already counted (cur " + cur + ")"); return; }

    const fields = { num_watched_episodes: ep };
    fields.status = (total && ep >= total) ? "completed" : "watching";
    await mal.updateListStatus(token, match.malId, fields);

    syncedThisFile = true;
    osd(match.title + " → " + ep + "/" + (total || "?"));
    log("updated " + match.title + " to episode " + ep);
  } catch (e) {
    log("sync error: " + e.message);
    if (force) osd("sync failed: " + e.message);
  }
}

// Periodic progress check.
setInterval(function () {
  if (syncedThisFile || !store.getEnabled() || !match) return;
  const st = core.status;
  if (st.idle || st.paused) return;
  const pos = st.position, dur = st.duration;
  if (!pos || !dur || dur <= 0) return;
  if (pos / dur < store.getThreshold()) return;

  syncedThisFile = true;      // guard against double-fire during the await
  doSync(false).catch(function (e) { syncedThisFile = false; log("sync threw: " + e.message); });
}, CHECK_INTERVAL_MS);

// --- login command channel (driven by the Settings page via preferences) ----
// The Settings page bumps loginReqId / codeReqId; we act on the change here.
// Initialise to the current values so stale requests from a prior session are
// not replayed on load.
let lastLoginReqId = store.getLoginReqId();
let lastCodeReqId = store.getCodeReqId();
store.setLoggedInFlag(store.isLoggedIn());

async function processAuthCode() {
  const clientId = store.getClientId();
  const pkce = store.getPkce();
  let code = store.getAuthCode().trim();
  const m = code.match(/[?&]code=([^&]+)/); // accept a full pasted redirect URL
  if (m) code = decodeURIComponent(m[1]);
  if (!clientId) { store.setAuthStatus("Missing Client ID."); return; }
  if (!code) { store.setAuthStatus("No authorization code found in what you pasted."); return; }

  store.setAuthStatus("Exchanging authorization code…");
  try {
    const r = await mal.exchangeCode(clientId, code, pkce.verifier, store.getRedirectUri());
    store.setTokens(r.access_token, r.refresh_token, r.expires_in);
    store.setPkce("", "");
    store.setLoggedInFlag(true);
    store.setAuthStatus("Logged in successfully. You can close Settings.");
    osd("logged in to MyAnimeList");
    log("login succeeded");
  } catch (e) {
    store.setAuthStatus("Login failed: " + e.message);
    log("exchange failed: " + e.message);
  }
}

setInterval(function () {
  const lid = store.getLoginReqId();
  if (lid !== lastLoginReqId) {
    lastLoginReqId = lid;
    const url = store.getAuthUrl();
    if (url) {
      let opened = false;
      try { opened = utils.open(url); } catch (e) { log("utils.open threw: " + e.message); }
      log("login open opened=" + opened);
      store.setAuthStatus(opened
        ? "Browser opened. Approve access, then paste the redirect URL below and click Finish login."
        : "Could not auto-open a browser. Copy the login link shown below into your browser.");
    }
  }
  const cid = store.getCodeReqId();
  if (cid !== lastCodeReqId) {
    lastCodeReqId = cid;
    processAuthCode();
  }
}, 1500);

// --- panel (login + match correction) --------------------------------------

function openPanel(mode) {
  panelMode = mode;
  standaloneWindow.loadFile("ui/panel.html");
  standaloneWindow.open();
}

function sendPanelState() {
  standaloneWindow.postMessage("state", {
    mode: panelMode,
    loggedIn: store.isLoggedIn(),
    clientId: store.getClientId(),
    redirectUri: store.getRedirectUri(),
    currentTitle: parsed ? parsed.title : "",
    currentMatch: match,
    candidates: candidates
  });
}

standaloneWindow.onMessage("panel-ready", function () { sendPanelState(); });

standaloneWindow.onMessage("save-config", function (data) {
  if (data && typeof data.clientId === "string") store.setClientId(data.clientId);
  if (data && typeof data.redirectUri === "string") store.setRedirectUri(data.redirectUri);
  standaloneWindow.postMessage("info", { message: "Saved." });
});

standaloneWindow.onMessage("start-login", function (data) {
  // Persist config carried in this message so we never depend on the ordering
  // of a separate "save-config" message (that race left clientId empty before).
  if (data && typeof data.clientId === "string") store.setClientId(data.clientId);
  if (data && typeof data.redirectUri === "string") store.setRedirectUri(data.redirectUri);

  const clientId = store.getClientId();
  if (!clientId) { standaloneWindow.postMessage("error", { message: "Enter your Client ID first, then click Log in." }); return; }

  const verifier = mal.generateVerifier(64);
  const state = mal.generateState();
  store.setPkce(verifier, state);
  const url = mal.buildAuthUrl(clientId, verifier, state, store.getRedirectUri());

  let opened = false;
  try { opened = utils.open(url); } catch (e) { log("utils.open threw: " + e.message); }
  log("start-login opened=" + opened);

  // Always hand the URL back so the panel can offer a copy/click fallback,
  // even if the browser did not auto-open.
  standaloneWindow.postMessage("auth-url", { url: url, opened: opened });
});

standaloneWindow.onMessage("submit-code", async function (data) {
  const clientId = store.getClientId();
  const pkce = store.getPkce();
  let code = (data && data.code ? String(data.code) : "").trim();
  const m = code.match(/[?&]code=([^&]+)/); // accept a full pasted redirect URL
  if (m) code = decodeURIComponent(m[1]);
  if (!code) { standaloneWindow.postMessage("error", { message: "No code provided." }); return; }

  try {
    const r = await mal.exchangeCode(clientId, code, pkce.verifier, store.getRedirectUri());
    store.setTokens(r.access_token, r.refresh_token, r.expires_in);
    store.setPkce("", "");
    standaloneWindow.postMessage("auth-result", { ok: true });
    sendPanelState();
    osd("logged in");
  } catch (e) {
    standaloneWindow.postMessage("auth-result", { ok: false, message: e.message });
  }
});

standaloneWindow.onMessage("logout", function () {
  store.clearTokens();
  standaloneWindow.postMessage("info", { message: "Logged out." });
  sendPanelState();
});

standaloneWindow.onMessage("search", async function (data) {
  const token = await getAccessToken();
  if (!token) { standaloneWindow.postMessage("error", { message: "Log in first." }); return; }
  try {
    candidates = await mal.searchAnime(token, (data && data.query) || "", 10);
    standaloneWindow.postMessage("candidates", { candidates: candidates });
  } catch (e) {
    standaloneWindow.postMessage("error", { message: e.message });
  }
});

standaloneWindow.onMessage("choose-match", function (data) {
  if (!key) { standaloneWindow.postMessage("error", { message: "No file is playing." }); return; }
  const chosen = candidates.filter(function (c) { return c.id === (data && data.malId); })[0];
  if (!chosen) return;
  match = { malId: chosen.id, title: chosen.title, numEpisodes: chosen.num_episodes || 0 };
  store.setMatch(key, match);
  syncedThisFile = false; // allow a re-sync against the corrected match
  standaloneWindow.postMessage("info", { message: "Matched to " + chosen.title + "." });
  osd("match set: " + chosen.title);
});

// --- menu -------------------------------------------------------------------

// NOTE: never call menu.forceUpdate() during initial plugin evaluation. Plugins
// load inside IINA's one-time PlayerCore initialization (dispatch_once), and
// forceUpdate() re-enters that same once token, causing a recursive-lock crash
// on launch. addItem() is enough to populate the menu; forceUpdate() is only
// safe from user-triggered callbacks that run long after init.
function buildMenu() {
  menu.removeAllItems();
  menu.addItem(menu.item("MyAnimeList Account…", function () { openPanel("auth"); }));
  menu.addItem(menu.item("Fix Match for Current Anime…", async function () {
    if (parsed && parsed.title && !candidates.length) {
      const token = await getAccessToken();
      if (token) { try { candidates = await mal.searchAnime(token, parsed.title, 10); } catch (e) {} }
    }
    openPanel("match");
  }));
  menu.addItem(menu.item("Sync This Episode Now", function () { doSync(true); }));
  menu.addItem(menu.separator());
  menu.addItem(menu.item("Sync Enabled", function () {
    store.setEnabled(!store.getEnabled());
    osd(store.getEnabled() ? "sync enabled" : "sync disabled");
    buildMenu();
    menu.forceUpdate(); // safe: user-triggered, well after plugin init
  }, { selected: store.getEnabled() }));
}

// --- wiring -----------------------------------------------------------------

event.on("iina.file-loaded", function (url) {
  handleNewFile(url).catch(function (e) { log("file-loaded error: " + e.message); });
});

buildMenu();
log("plugin loaded");
