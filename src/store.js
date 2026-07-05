// store.js — thin wrapper over iina.preferences for persistent plugin state.
//
// Preference keys:
//   clientId, redirectUri, enabled, threshold  (also declared in Info.json defaults)
//   accessToken, refreshToken, tokenExpiry      (OAuth tokens; tokenExpiry = ms epoch)
//   pkceVerifier, oauthState                    (transient, during the auth handshake)
//   matches                                     (JSON string: seriesKey -> match object)

const { preferences } = iina;

function get(key, dflt) {
  const v = preferences.get(key);
  return v === undefined || v === null ? dflt : v;
}

function set(key, value) {
  preferences.set(key, value);
  preferences.sync();
}

// --- config -----------------------------------------------------------------

function getClientId()    { return String(get("clientId", "") || "").trim(); }
function setClientId(v)   { set("clientId", String(v || "").trim()); }

function getRedirectUri() { return String(get("redirectUri", "") || "").trim(); }
function setRedirectUri(v){ set("redirectUri", String(v || "").trim()); }

function getEnabled()     { return get("enabled", true) !== false; }
function setEnabled(v)    { set("enabled", !!v); }

function getThreshold() {
  const t = parseFloat(get("threshold", 0.8));
  if (isNaN(t) || t <= 0 || t > 1) return 0.8;
  return t;
}

// --- tokens -----------------------------------------------------------------

function getTokens() {
  return {
    accessToken:  get("accessToken", ""),
    refreshToken: get("refreshToken", ""),
    expiry:       parseInt(get("tokenExpiry", 0), 10) || 0
  };
}

function setTokens(accessToken, refreshToken, expiresInSeconds) {
  const expiry = Date.now() + (parseInt(expiresInSeconds, 10) || 0) * 1000;
  preferences.set("accessToken", accessToken || "");
  preferences.set("refreshToken", refreshToken || "");
  preferences.set("tokenExpiry", expiry);
  preferences.sync();
}

function clearTokens() {
  preferences.set("accessToken", "");
  preferences.set("refreshToken", "");
  preferences.set("tokenExpiry", 0);
  preferences.sync();
}

function isLoggedIn() { return !!getTokens().accessToken; }

// --- transient PKCE handshake state ----------------------------------------

function setPkce(verifier, state) {
  preferences.set("pkceVerifier", verifier || "");
  preferences.set("oauthState", state || "");
  preferences.sync();
}
function getPkce() {
  return { verifier: get("pkceVerifier", ""), state: get("oauthState", "") };
}

// --- match cache (seriesKey -> { malId, title, numEpisodes }) ---------------

function readMatches() {
  try { return JSON.parse(get("matches", "{}")) || {}; }
  catch (e) { return {}; }
}

function getMatch(key) {
  const m = readMatches();
  return m[key] || null;
}

function setMatch(key, match) {
  const m = readMatches();
  m[key] = match;
  set("matches", JSON.stringify(m));
}

function clearMatch(key) {
  const m = readMatches();
  delete m[key];
  set("matches", JSON.stringify(m));
}

// --- preferences-based command channel (Settings page <-> plugin) -----------
// The standalone-window postMessage bridge proved unreliable, so login is
// driven through preferences: the Settings page bumps a request id and the
// plugin polls for it. Preference writes from the Settings page are known to
// propagate to the plugin (the "enabled" toggle works the same way).

function getNum(key) { const n = parseInt(get(key, 0), 10); return isNaN(n) ? 0 : n; }

function getLoginReqId() { return getNum("loginReqId"); }
function getCodeReqId()  { return getNum("codeReqId"); }
function getAuthUrl()    { return String(get("authUrl", "") || ""); }
function getAuthCode()   { return String(get("authCode", "") || ""); }
function setAuthStatus(s){ set("authStatus", String(s || "")); }
function setLoggedInFlag(b){ set("loggedInFlag", !!b); }

module.exports = {
  getClientId, setClientId,
  getRedirectUri, setRedirectUri,
  getEnabled, setEnabled,
  getThreshold,
  getTokens, setTokens, clearTokens, isLoggedIn,
  setPkce, getPkce,
  getMatch, setMatch, clearMatch,
  getLoginReqId, getCodeReqId, getAuthUrl, getAuthCode, setAuthStatus, setLoggedInFlag
};
