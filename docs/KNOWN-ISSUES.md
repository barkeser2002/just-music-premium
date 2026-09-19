# Just Music Premium — Known Issues & Gotchas

A defect + gotcha log so future work doesn't re-discover the same traps.
Line numbers are approximate — grep the symbol, don't trust the number after edits.

Files that matter most: `justmusic/web/app.js`, `justmusic/web/app.css`, `justmusic/bridge.py`, `justmusic/config.py`.

---

## Part 1 — Fixed in v1.0.4

- [x] **1. Top-bar Back/Forward arrows were dead** (never wired). ✅ FIXED — real view-history stack: `recordHistory` / `navBack` / `navFwd` (app.js ~223–246), wired in `wireEvents` (`$('#navBack').onclick=navBack; $('#navFwd').onclick=navFwd;`, ~app.js:755). `recordHistory` skips clip mode and de-dupes the current location; `navLock` guards replays.

- [x] **2. Karaoke menu from the Ctrl+K command palette flash-closed.** Root cause: the global `document.addEventListener('click', … remove .ctx-menu)` (app.js ~39) removes any left-click-opened menu on the *same* click's bubble. ✅ FIXED — the palette item `onclick` now calls `e.stopPropagation()` before running the command (app.js ~1240). The direct `#pKaraoke` button already had this guard (app.js ~780).

- [x] **3. Drag-to-reorder from Search / Smart-list views corrupted the real playlist** (filtered index applied to the real array, then persisted). ✅ FIXED — `trackRow(s, i, pl, reorderable)` (app.js ~340) makes rows `draggable` only when `reorderable` is true. Only the real full-list `renderPlaylist` passes `true` (~app.js:336); Search (~410) and Smart (~1219) pass nothing → drag off. Drop also requires `playlistSort==='default'` (~app.js:367).

- [x] **4. Download pill, separation pill and mini-clip player all pinned bottom-right and overlapped.** ✅ FIXED — pills moved to bottom-**LEFT**; `#sepPill` stacks *above* `#dlPill` (`.dl-pill{left:20px; bottom:calc(var(--player-h)+18px)}`, `#sepPill{bottom:calc(var(--player-h)+78px)}`, app.css ~396–398). Mini-clip stays bottom-right (`.clip-mini{right:20px}`, app.css ~480). Also the separation pill never appeared because `updateSepPill` didn't add `.show` — ✅ FIXED (app.js ~1058).

- [x] **5. `trackChanged` handler had no try/catch around `JSON.parse`** (every other signal did). ✅ FIXED — `bridge.trackChanged.connect(j=>{try{track=JSON.parse(j);}catch(e){return;}onTrackChanged();})` (app.js ~712).

- [x] **6. `repeat_mode` was missing from the `trackChanged` payload**, so the 3-state repeat glyph could drift. ✅ FIXED — added to `_track_json()` (bridge.py ~369) and read in `onTrackChanged` (`if(track.repeat_mode!=null)active.repeat_mode=track.repeat_mode;`, app.js ~644).

- [x] **7. Stale YouTube results lingered when the search box was narrowed/cleared.** ✅ FIXED — `searchRows=[]` on every `#topSearch` input change (app.js ~758).

---

## Part 2 — Known / open (not yet fixed)

- [ ] **`showView('playlist')` with a null `viewPlaylist` leaves `view` lying.** `view=v` is set at the top of `showView` (app.js ~208) *before* the `v==='playlist' && viewPlaylist` guard fails and falls through to `renderHome()` (~217). Result: global `view` says `'playlist'` while Home is on screen. app.js ~207–217.

- [ ] **Heart "burst" like-animation never triggers.** `.icon-btn.fav.burst` + `@keyframes burst` exist in CSS (app.css ~428–429) but no JS ever adds `.burst` — `updatePlayer` only toggles `.on` on `#pFav` (app.js ~619). The animation is dead until something adds/removes the class on like.

- [ ] **Visualizer hot path forces a style recalc every frame.** `vizLoop` (app.js ~657) runs `drawPlayerViz` + `drawWaveforms` + `updateAmbient` on *every* `requestAnimationFrame` with no early-out when paused, and each of `vizLoop` / `drawPlayerViz` / `drawWaveforms` calls `getComputedStyle(document.documentElement)` per frame (app.js ~663, ~674, ~940, ~994) to read `--accent-rgb`. That's a forced synchronous style/layout read in the hot path. Suggested: cache the accent color, refresh only on accent/cover change; and bail early when `!active.playing`.

- [ ] **Dead code.** `confirmBox` (app.js ~66) is an unused wrapper around `modalConfirm`. The seek handler computes an unused `dur` local (`const dur=parseFloat($('#pDur')…)`, app.js ~793) and then uses `lastDur` instead — remove it.

- [ ] **yt-dlp goes stale every few weeks** (YouTube changes its player). Symptom: downloads start returning **HTTP 403** while *search still works*. Fix: bump the pinned `yt-dlp` and rebuild (see the v1.0.3 commit). Future idea: a runtime yt-dlp self-updater would avoid shipping a full ~490 MB app update each time.

---

## Traps / invariants

Read these before touching menus, drag-reorder, the clip player, or playlist names.

- **(a) ctx-menu + global click-closer.** Any `.ctx-menu` opened by a **left-click** MUST call `e.stopPropagation()` in that click's handler, or the global `document`-level click listener (app.js ~39) removes it on the same bubble. Right-click (`contextmenu`) opens are safe. See `#pKaraoke` (~780) and the palette item (~1240) for the pattern.

- **(b) `trackRow` drag index is only valid in the default full-list view.** The `idx` stored on dragstart indexes the *displayed* array. It is only equal to the real playlist index in `renderPlaylist` with `playlistSort==='default'`. Never enable reorder drag from filtered/sorted/smart/search views — pass `reorderable=false` (the default) and the drop guard also checks `playlistSort==='default'`.

- **(c) The clip `<video>` MUST be removed from the DOM on stop.** Pausing alone keeps network traffic alive AND a live `<video>` left in the DOM **crashes QtWebEngine on app close**. `stopClip` (app.js ~1120) does `v.pause(); v.removeAttribute('src'); v.load();` then `host.remove()`. Keep all three steps. The audio engine is separate — don't touch it here.

- **(d) Protected playlist names are stored dict keys, not display labels.** `"Kütüphanem"`, `"Beğenilen Şarkılar"`, `"İndirilenler"` are `config.PROTECTED_PLAYLISTS` (config.py ~88–91) and used as literal keys in the library/state dicts and download routing (bridge.py ~1343). Do **not** rename, translate, or "prettify" them — renaming a key silently orphans its songs. The UI already hides rename/delete for `S.protected` (app.js ~198).
