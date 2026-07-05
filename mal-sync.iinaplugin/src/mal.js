// mal.js — MyAnimeList API v2 client built on iina.http.
//
// Auth: OAuth2 with PKCE. MyAnimeList only supports the "plain" challenge
// method, so code_challenge == code_verifier and no hashing is needed.
//
// iina.http uses the Just library: `data` is sent as an
// application/x-www-form-urlencoded body, `params` as the URL query string.

const { http, console } = iina;

const AUTHORIZE_URL = "https://myanimelist.net/v1/oauth2/authorize";
const TOKEN_URL     = "https://myanimelist.net/v1/oauth2/token";
const API_BASE      = "https://api.myanimelist.net/v2";

const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

// PKCE "plain" verifier: 43-128 chars from the unreserved set.
function generateVerifier(len) {
  len = len || 64;
  let s = "";
  for (let i = 0; i < len; i++) {
    s += VERIFIER_CHARS[Math.floor(Math.random() * VERIFIER_CHARS.length)];
  }
  return s;
}

function generateState() {
  return generateVerifier(16);
}

function buildAuthUrl(clientId, verifier, state, redirectUri) {
  let url = AUTHORIZE_URL +
    "?response_type=code" +
    "&client_id=" + encodeURIComponent(clientId) +
    "&code_challenge=" + encodeURIComponent(verifier) +   // plain: challenge == verifier
    "&code_challenge_method=plain" +
    "&state=" + encodeURIComponent(state);
  if (redirectUri) url += "&redirect_uri=" + encodeURIComponent(redirectUri);
  return url;
}

// Parse a response body into an object regardless of how IINA surfaced it.
function body(res) {
  if (res && res.data && typeof res.data === "object") return res.data;
  if (res && typeof res.text === "string" && res.text.length) {
    try { return JSON.parse(res.text); } catch (e) { /* fall through */ }
  }
  return {};
}

function ensureOk(res, what) {
  const code = res ? res.statusCode : 0;
  if (code < 200 || code >= 300) {
    const b = body(res);
    const detail = b.message || b.error || (res && res.text) || "unknown error";
    throw new Error(what + " failed (" + code + "): " + detail);
  }
  return res;
}

// --- OAuth ------------------------------------------------------------------

async function exchangeCode(clientId, code, verifier, redirectUri) {
  const data = {
    client_id: clientId,
    grant_type: "authorization_code",
    code: code,
    code_verifier: verifier
  };
  if (redirectUri) data.redirect_uri = redirectUri;
  const res = await http.post(TOKEN_URL, { data: data });
  ensureOk(res, "Token exchange");
  return body(res); // { access_token, refresh_token, expires_in, ... }
}

async function refreshToken(clientId, refreshTok) {
  const res = await http.post(TOKEN_URL, {
    data: {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshTok
    }
  });
  ensureOk(res, "Token refresh");
  return body(res);
}

// --- API --------------------------------------------------------------------

async function searchAnime(accessToken, query, limit) {
  const res = await http.get(API_BASE + "/anime", {
    params: {
      q: query,
      limit: String(limit || 10),
      fields: "id,title,alternative_titles,num_episodes,media_type,my_list_status"
    },
    headers: { Authorization: "Bearer " + accessToken }
  });
  ensureOk(res, "Search");
  const b = body(res);
  return (b.data || []).map(function (x) { return x.node; }).filter(Boolean);
}

async function getAnime(accessToken, animeId, fields) {
  const res = await http.get(API_BASE + "/anime/" + animeId, {
    params: { fields: fields || "id,title,num_episodes,my_list_status" },
    headers: { Authorization: "Bearer " + accessToken }
  });
  ensureOk(res, "Get anime");
  return body(res);
}

// fields: { num_watched_episodes, status, score, ... } (all values become strings)
async function updateListStatus(accessToken, animeId, fields) {
  const data = {};
  Object.keys(fields).forEach(function (k) { data[k] = String(fields[k]); });
  const res = await http.patch(API_BASE + "/anime/" + animeId + "/my_list_status", {
    data: data,
    headers: { Authorization: "Bearer " + accessToken }
  });
  ensureOk(res, "Update list status");
  return body(res);
}

module.exports = {
  generateVerifier,
  generateState,
  buildAuthUrl,
  exchangeCode,
  refreshToken,
  searchAnime,
  getAnime,
  updateListStatus
};
