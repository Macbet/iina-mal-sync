# IINA → MyAnimeList Sync

An [IINA](https://iina.io) plugin that automatically updates your
**MyAnimeList** watched-episode progress from whatever you play in IINA.

When you watch an episode past a threshold (default **80%**), the plugin figures
out the anime + episode number from the filename, matches it to a MAL entry, and
bumps `num_watched_episodes` on your list (marking the series *completed* on the
final episode).

## How it works

1. **Parse** — the filename is parsed into `{ title, episode, season }`
   (handles `[Group] Title - 12 (1080p).mkv`, `Title S02E05`, `Title Ep05`, etc.).
2. **Match** — the title is searched on MAL; the best hit is cached per series so
   it only searches once. You can correct a match from the menu.
3. **Sync** — once you cross the watch threshold, progress is pushed to MAL. The
   plugin reads your current progress first and never lowers your count.

## Setup

### 1. Create a MyAnimeList API app (one time)

1. Go to <https://myanimelist.net/apiconfig> and click **Create ID**.
2. Fill in the form. **App Type: `other`**. For **App Redirect URL** enter any
   https URL you control or a placeholder such as `https://localhost/` (you'll
   copy the code out of the browser's address bar after approving).
3. Save, then open the app and copy its **Client ID**.

> Note: MyAnimeList uses PKCE with the *plain* challenge method, so **no client
> secret is needed** for this flow.

### 2. Install the plugin

The plugin lives in the `mal-sync.iinaplugin/` folder.

- **From IINA:** Settings → **Plugins** → **＋** → *Install from file/folder…* and
  choose `mal-sync.iinaplugin`. (Or drag the folder onto the Plugins list.)
- **Manually (dev):** symlink or copy the folder into
  `~/Library/Application Support/com.colliderli.iina/plugins/` and restart IINA.

Grant the requested permissions (network access + OSD) when prompted.

### 3. Log in

1. Open any video in IINA.
2. Menu bar → **Plugin** → **MyAnimeList Account…**
3. Paste your **Client ID**, click **Save**, then **Log in to MyAnimeList**.
4. Approve access in the browser that opens. You'll be redirected to your
   redirect URL — copy the **full address** (it contains `?code=...`) and paste
   it into the **Paste redirect URL** field, then click **Finish login**.

That's it. Play an anime and watch the OSD confirm the match and, later, the
progress update.

## Menu items (Plugin menu, with a video open)

| Item | Action |
| --- | --- |
| **MyAnimeList Account…** | Log in / out, enter Client ID |
| **Fix Match for Current Anime…** | Search MAL and pick the correct entry for the current series |
| **Sync This Episode Now** | Force an immediate update (ignores threshold) |
| **Sync Enabled** | Toggle automatic syncing |

## Preferences

Settings → Plugins → MyAnimeList Sync:

- **Enable automatic sync**
- **Mark watched at** — watch threshold (50–95%, default 80%)

## Notes & limitations

- Only **local files** are synced (network streams are ignored).
- Matching relies on filename quality. Weird names may match the wrong entry —
  use **Fix Match** once and it's cached for that series.
- Season detection is best-effort. On MAL, seasons are usually **separate
  entries**, so a `S2` folder should be matched to that season's MAL page via
  Fix Match (its episodes usually number from 1).
- Access tokens are refreshed automatically; you only log in once.

## Project layout

```
mal-sync.iinaplugin/
├── Info.json          # manifest: entry, permissions, allowed domains, prefs
├── main.js            # per-player entry: watch loop, matching, menu, panel wiring
├── src/
│   ├── parse.js       # filename → { title, episode, season }
│   ├── store.js       # iina.preferences wrapper (config, tokens, match cache)
│   └── mal.js         # MyAnimeList API v2 client (OAuth PKCE, search, update)
└── ui/
    ├── panel.html     # login + match-correction window
    └── prefs.html     # settings page
```
