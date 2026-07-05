// parse.js — turn a video filename into { title, episode, season }.
//
// Handles the common release / fansub naming conventions, e.g.:
//   [SubsPlease] Frieren - 12 (1080p) [A1B2C3D4].mkv   -> "Frieren", ep 12
//   [Group] Show Name - S02E05 [1080p].mkv             -> "Show Name", s2 ep 5
//   Show.Name.S01E05.1080p.WEB-DL.mkv                  -> "Show Name", s1 ep 5
//   Show Name - 05.mkv                                 -> "Show Name", ep 5
//   Show_Name_Ep05.mkv                                 -> "Show Name", ep 5

// Quality / source tokens that are never part of a title.
const JUNK = /\b(1080p|720p|480p|2160p|4k|8bit|10bit|hevc|x264|x265|h\.?264|h\.?265|aac|flac|web-?dl|webrip|bluray|bdrip|hdtv|dual[\s._-]?audio|multi[\s._-]?subs?|uncensored|repack|remux)\b/gi;

function clean(s) {
  return String(s || "")
    .replace(/[._]+/g, " ")
    .replace(JUNK, " ")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove [ ... ] and ( ... ) groups (release group tags, hashes, resolutions).
function stripTags(name) {
  return name.replace(/[\[(][^\])]*[\])]/g, " ");
}

function basename(pathOrUrl) {
  let base = String(pathOrUrl || "");
  // Strip a possible file:// scheme and query/fragment.
  base = base.replace(/^file:\/\//i, "").split(/[?#]/)[0];
  base = base.split(/[\\/]/).pop() || base;
  try { base = decodeURIComponent(base); } catch (e) { /* leave as-is */ }
  return base;
}

function finalize(title, episode, season, fallback) {
  let t = clean(title);
  if (!t) t = clean(stripTags(fallback));
  return {
    title: t,
    episode: episode == null ? null : episode,
    season: season || 1
  };
}

function parseFilename(pathOrUrl) {
  let base = basename(pathOrUrl).replace(/\.[a-z0-9]{1,5}$/i, ""); // drop extension
  base = base.replace(/_+/g, " "); // underscores are word chars; \b boundaries need spaces

  let season = 1;

  // Pick up an explicit season word even when the episode marker is a plain " - NN".
  const sw = base.match(/\bS(?:eason)?[\s._]*?(\d{1,2})\b/i);
  if (sw) season = parseInt(sw[1], 10) || 1;

  // 1) SxxExx (with optional version suffix, e.g. S01E05v2)
  let m = base.match(/[\s._-]S(\d{1,2})[\s._-]?E(\d{1,3})(?:v\d+)?\b/i);
  if (m) {
    return finalize(stripTags(base.slice(0, m.index)),
      parseInt(m[2], 10), parseInt(m[1], 10) || 1, base);
  }

  // 2) Classic " - NN" fansub numbering. Use the LAST occurrence so a number
  //    inside the title (e.g. "86 - 05") does not win over the episode number.
  const dashRe = /[\s._]-[\s._]*(\d{1,4})(?:v\d+)?(?![\dp])/gi;
  let dm, lastDash = null;
  while ((dm = dashRe.exec(base)) !== null) lastDash = dm;
  if (lastDash) {
    return finalize(stripTags(base.slice(0, lastDash.index)),
      parseInt(lastDash[1], 10), season, base);
  }

  // 3) "E12" / "Ep 12" / "Episode 12"
  m = base.match(/\b(?:E|Ep|Episode)[\s._]*(\d{1,4})\b/i);
  if (m) {
    return finalize(stripTags(base.slice(0, m.index)),
      parseInt(m[1], 10), season, base);
  }

  // 4) Fallback: last standalone number in the tag-stripped name.
  const stripped = stripTags(base);
  const numRe = /\b(\d{1,4})\b/g;
  let nm, lastNum = null;
  while ((nm = numRe.exec(stripped)) !== null) lastNum = nm;
  if (lastNum && season > 1 && lastNum.index <= stripped.toLowerCase().indexOf("s" + season)) {
    lastNum = null; // that number was the season marker, not an episode
  }
  if (lastNum) {
    return finalize(stripped.slice(0, lastNum.index), parseInt(lastNum[1], 10), season, base);
  }

  // No episode number: likely a movie or a single OVA.
  return finalize(stripTags(base), null, season, base);
}

// A stable cache key for a series (independent of episode number).
function seriesKey(parsed) {
  return (parsed.title || "").toLowerCase().replace(/\s+/g, " ").trim() + "#s" + (parsed.season || 1);
}

module.exports = { parseFilename, seriesKey };
