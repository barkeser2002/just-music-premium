# Bridge Signal / Slot Catalog (QWebChannel)

Reference for the QWebChannel contract between the Python `Bridge`
(`justmusic/bridge.py`) and the web UI (`justmusic/web/app.js`).

- **Signals** travel **Python → JS**. Each is a `pyqtSignal` class attribute on
  `Bridge`, wired to a JS handler in `wireSignals()` (`app.js:710`).
- **Slots** are called **JS → Python** as `bridge.<method>(...)`. Each is a
  `@pyqtSlot(...)` method on `Bridge`.
- JSON-carrying signals/slots pass a **string**; the schemas below come from the
  Python builder functions.

> Argument types in this doc are the declared `pyqtSignal`/`pyqtSlot` signatures.
> QWebChannel marshals Python `dict`/`list` only when serialized to a JSON
> **string** first — every "JSON" payload here is a `str` on the wire.

---

## 1. Signals (Python → JS)

| Signal | Args (declared) | Payload / meaning | JS handler in `wireSignals()` |
|---|---|---|---|
| `stateChanged` | `()` | No payload. "State is dirty, re-pull." Handler calls `bridge.getState(...)`. | `refreshState` |
| `trackChanged` | `(str)` | JSON track object (schema below), or `{"none": true}` when nothing is loaded. Fires on **every** now-playing change **and same-song metadata updates**. | `j => track = JSON.parse(j); onTrackChanged()` |
| `playingChanged` | `(bool)` | `true`/`false` play state. Only emitted when it flips (`_last_playing` guard). | `p => active.playing=p; updatePlayBtn(); if(clip) clipMirrorPlay(p)` |
| `positionChanged` | `(float, float)` | `(pos_sec, dur_sec)`. **The single clock** — drives the seek bar and, in clip mode, the muted video + LRC sync. | `(pos,dur) => updateSeek(pos,dur); if(clip){syncClipVideo(pos); clipSyncLyrics(pos)}` |
| `spectrumSignal` | `(str)` | JSON array of ~56 floats (rounded to 3 dp), the FFT bars. Emitted every poll (60 ms). | `j => spectrum = JSON.parse(j)` |
| `coverReadySignal` | `(str, str)` | `(song_id, cover_url)`. URL form: `app://app/cover/<md5(song_id)>.jpg`. | `(id,url) => updateCovers(id,url)` |
| `toastSignal` | `(str)` | Plain message string for the toast. | `showToast` |
| `downloadProgressSignal` | `(float, str, int)` | `(pct, status, queue_remaining)`. **`status` carries the batch counter "X/Y"** (see notes). `(0, "", 0)` means the queue drained. | `(pct,status,q) => updateDlPill(pct,status,q)` |
| `downloadDoneSignal` | `(str)` | JSON of the finished song = `_song_view()` shape. | `() => {}` (no-op; UI refreshes via `stateChanged`) |
| `searchResultsSignal` | `(str)` | JSON array of search rows (schema below), or `{"error": "<msg>"}`. Used by both `searchYouTube` and `importPlaylist`. | `onSearchResults` |
| `scanDoneSignal` | `(int, int)` | `(songs_added, new_playlists)` from a music-folder scan. | *(none — not connected; see note)* |
| `durationSignal` | `(str, int)` | `(song_id, duration_ms)` — late-probed track length. | `onDuration` |
| `queueChanged` | `(str)` | JSON array of up-next entries = `_song_view()` + `playlist` field; `"[]"` when cleared. | `onQueue` |
| `videoReadySignal` | `(str)` | JSON clip stream object (schema below). | `onVideoReady` |
| `analysisSignal` | `(str)` | JSON song-DNA object (schema below). | `onAnalysis` |
| `loopSignal` | `(float, float)` | `(A_sec, B_sec)` A-B loop points. `-1` in a slot = unset (e.g. `(-1,-1)` clears, `(A,-1)` = only A set). | `onLoop` |
| `updateAvailableSignal` | `(str, str)` | `(version, notes)` — a newer release exists. | `(v,notes) => updateInfo={version:v,notes:notes}` |
| `updateProgressSignal` | `(float)` | Download percent of the staged `.msi`. | `p => onUpdateProgress(p)` |
| `updateReadySignal` | `(str)` | `version` — update downloaded, installs on exit (or via `installUpdateNow`). | `v => onUpdateReady(v)` |
| `separationProgressSignal` | `(float, str)` | `(pct, status)` for htdemucs vocal separation. `(100.0, "Hazır")` = done, `(100.0, "")` = failed. | `(pct,status) => updateSepPill(pct,status)` |
| `karaokeModeSignal` | `(str)` | Current mode: `off` / `quick` / `instrumental` / `vocals`. | `m => onKaraokeMode(m)` |

> **Note on `scanDoneSignal`:** it is declared and emitted (`_on_scan_done`), but
> is **not** connected inside `wireSignals()`; scan results reach the UI mainly
> through the `toastSignal` + `stateChanged` that fire alongside it.

### JSON payload schemas

**`trackChanged` — `_track_json()`** (built from `_song_view()` + extra fields):

```jsonc
{
  "id": "...", "title": "...", "artist": "...",
  "favorite": false,
  "duration_ms": 0, "play_count": 0,
  "source": "local",            // or "youtube"
  "cover": "app://app/cover/<md5>.jpg",
  "hasCover": true,             // thumbnail file exists on disk
  "mood": "", "bpm": 0,
  "playlist": "<active playlist>",
  "lyrics": "",                 // may be LRC ([mm:ss] timestamped)
  "shuffle": false,
  "repeat": false,              // == (repeat_mode == 2)
  "repeat_mode": 1              // 0=off, 1=list, 2=one
}
// when nothing is loaded:
{ "none": true }
```

**`stateChanged` → `getState()`** (JS pulls it via the `getState` slot; full app state):

```jsonc
{
  "playlists": { "<name>": [ /* _song_view objects */ ] },
  "protected": ["<protected playlist names>"],
  "version": "<APP_VERSION>",
  "current": "<current playlist>",
  "settings": { /* library.settings: theme, accent, volume, speed,
                   eq_gains, eq_enabled, eq_preset, effects, normalize,
                   soundscape, recent, playlist_covers, playlist_desc, ... */ },
  "presets": { "<preset name>": [10 EQ gains] },
  "presetNames": ["<ordered preset names>"],
  "bandLabels": ["<10 EQ band labels>"],
  "effectDefaults": { "<effect>": <default> },
  "effectDefsOrder": ["<effect keys in order>"],
  "active": { "playlist": "...", "song_id": "...", "playing": false,
              "shuffle": false, "repeat": false, "repeat_mode": 1 },
  "stats": { "total_seconds": 0, ... },
  "recent": [ /* _song_view objects, each with an added "playlist" field */ ],
  "favoritesName": "<favorites playlist name>",
  "demucs": false,             // studio-karaoke (htdemucs) engine available?
  "karaokeMode": "off"
}
```

**`_song_view()`** (the per-song shape reused in `playlists`, `recent`,
`queueChanged`, `downloadDoneSignal`):

```jsonc
{
  "id": "...", "title": "...", "artist": "...",
  "favorite": false, "duration_ms": 0, "play_count": 0,
  "source": "local", "cover": "app://app/cover/<md5>.jpg",
  "hasCover": true, "mood": "", "bpm": 0
}
```
(`queueChanged` and `recent` entries additionally carry a `"playlist"` field.)

**`searchResultsSignal` — search rows** (`SearchThread.run`, also `importPlaylist`):

```jsonc
[
  { "id": "<videoId>", "title": "...", "uploader": "...",
    "duration_ms": 0,
    "thumbnail": "https://i.ytimg.com/vi/<id>/hqdefault.jpg",
    "url": "https://www.youtube.com/watch?v=<id>" }
]
// on failure:
{ "error": "<message>" }
```

**`videoReadySignal` — clip stream** (`VideoStreamThread` + `_on_video_ready`):

```jsonc
{
  "id": "<song_id>",
  "video": "<webm VP9 video-only stream URL>",
  "audio": "<opus audio-only stream URL>",  // may be empty
  "title": "...", "duration": 0,
  "start": 12.34,     // seconds; handoff position injected by _on_video_ready
  "muted": true       // ALWAYS true — audio comes from the DSP engine, not the video
}
```

**`analysisSignal` — song DNA** (`AnalyzeThread`):

```jsonc
{
  "id": "<song_id>",
  "waveform": [ /* 480 peak floats */ ],
  "mood": "<label>", "color": "<hex>",
  "bpm": 0, "gain": 1.0,        // gain feeds loudness normalize
  "spectrogram": [ /* rows */ ]
}
```

---

## 2. Slots (JS → Python)

Called as `bridge.<name>(args)`. Slots that **return a value** (`result=str`)
are invoked with a callback in JS: `bridge.getState(json => {...})`.

### Playback / transport
| Slot | Args | Purpose |
|---|---|---|
| `play` | `(song_id: str, playlist: str)` | Play a specific song from a playlist. |
| `toggle` | `()` | Play/pause; if nothing loaded, starts the current playlist. |
| `playPause` | `()` | Alias for `toggle`. |
| `next` | `()` | Next track (honors shuffle). |
| `prev` | `()` | Previous track (or restart if >3 s in). |
| `seek` | `(seconds: float)` | Seek the engine to an absolute position. |
| `setShuffle` | `(on: bool)` | Toggle shuffle. |
| `setRepeat` | `(on: bool)` | Toggle repeat-one (legacy boolean). |
| `setRepeatMode` | `(mode: int)` | Cycle repeat: `0`=off, `1`=list, `2`=one (`mode % 3`). |
| `setVolume` | `(v: float)` | Base volume 0–150 (persisted when >0). |
| `setSpeed` | `(r: float)` | Playback speed (0.5–2.0). |
| `setNormalize` | `(on: bool)` | Loudness normalize on/off. |
| `setLoopA` | `()` | Set A-B loop start = current position. |
| `setLoopB` | `()` | Set A-B loop end = current position. |
| `clearLoop` | `()` | Clear the A-B loop. |
| `playPlaylistShuffled` | `(playlist: str, _unused: str="")` | Turn on shuffle and start the playlist at a random track. |

### Queue (up-next)
| Slot | Args | Purpose |
|---|---|---|
| `addToQueue` | `(sid: str, playlist: str)` | Append a track to the user queue. |
| `playNext` | `(sid: str, playlist: str)` | Insert a track at the front of the queue. |
| `addAllToQueue` | `(playlist: str)` | Queue an entire playlist. |
| `startRadio` | `(sid: str, playlist: str)` | Queue ~20 mood-similar tracks after the seed. |
| `getQueue` | `() → str` | JSON of the queue (`_song_view` + `playlist`). Callback. |
| `clearQueue` | `()` | Empty the queue. |
| `removeFromQueue` | `(index: int)` | Drop the queue item at `index`. |
| `playQueueIndex` | `(index: int)` | Pop and play the queue item at `index`. |

### Playlists
| Slot | Args | Purpose |
|---|---|---|
| `selectPlaylist` | `(name: str)` | Set the current playlist (no playback change). |
| `addPlaylist` | `(name: str)` | Create a playlist. |
| `deletePlaylist` | `(name: str)` | Delete a playlist. |
| `renamePlaylist` | `(old: str, new: str)` | Rename (protected lists blocked). |
| `reorderSong` | `(playlist: str, frm: int, to: int)` | Drag-reorder within a playlist. |
| `setPlaylistCover` | `(playlist: str, url: str)` | Set a custom cover URL. |
| `setPlaylistDescription` | `(playlist: str, text: str)` | Set the playlist description. |
| `removeDuplicates` | `(playlist: str)` | Drop duplicate file paths. |
| `exportM3U` | `(playlist: str)` | Save playlist as `.m3u` (native file dialog). |

### Song actions
| Slot | Args | Purpose |
|---|---|---|
| `toggleFavorite` | `(song_id: str, playlist: str)` | Toggle favorite flag. |
| `removeSong` | `(song_id: str, playlist: str)` | Remove a song from a playlist. |
| `copyToPlaylist` | `(song_id: str, playlist: str, target: str)` | Copy a song into another playlist. |
| `editMetadata` | `(song_id: str, playlist: str, title: str, artist: str)` | Edit title/artist. |
| `openFileLocation` | `(sid: str, playlist: str)` | Reveal the file in Explorer. |
| `exportTrim` | `(sid: str, playlist: str, a: float, b: float)` | Export the A–B segment to MP3 (ffmpeg). |

### Search / download
| Slot | Args | Purpose |
|---|---|---|
| `searchYouTube` | `(query: str)` | YouTube search (20 rows) → `searchResultsSignal`. |
| `importPlaylist` | `(url: str)` | Resolve a YouTube **playlist URL** into preview-and-select rows → `searchResultsSignal`. |
| `downloadUrls` | `(urls_json: str)` | Enqueue one or many URLs (JSON array, or a single string) for download; grows the "X/Y" batch counter. |

### Effects / EQ
| Slot | Args | Purpose |
|---|---|---|
| `setEq` | `(gains_json: str)` | Set 10-band EQ gains (JSON array). |
| `setEqPreset` | `(name: str)` | Persist selected preset name. |
| `setEqEnabled` | `(on: bool)` | Enable/disable EQ. |
| `autoEq` | `() → str` | Auto-compute EQ from current audio; returns JSON gains. Callback. |
| `setEffect` | `(name: str, val: float)` | Set one effect (preamp/bass/echo/reverb/spatial/…). |
| `setSoundscape` | `(kind: str, level: float)` | Ambient soundscape (rain/white/brown/off). |

### Karaoke / vocal separation
| Slot | Args | Purpose |
|---|---|---|
| `setKaraoke` | `(mode: str)` | `off` / `quick` (instant mid-side) / `instrumental` / `vocals` (htdemucs stems). Falls back to `quick` when demucs is unavailable; drives `karaokeModeSignal` + `separationProgressSignal`. |

### Clip (music-video) mode
| Slot | Args | Purpose |
|---|---|---|
| `playVideo` | `(sid: str, playlist: str)` | Resolve a muted webm video stream synced to the DSP engine → `videoReadySignal`. |
| `resumeMusic` | `(pos: float=-1.0)` | Called when the clip closes; ensures the engine is still playing (engine never stopped). JS calls `resumeMusic(-1)`. |

### Lyrics
| Slot | Args | Purpose |
|---|---|---|
| `fetchLyrics` | `(sid: str, playlist: str)` | Fetch timestamped (LRC) lyrics from Lyrica; result lands via `trackChanged`. |
| `saveLyrics` | `(song_id: str, playlist: str, text: str)` | Save manually edited lyrics. |

### Import / scan / covers
| Slot | Args | Purpose |
|---|---|---|
| `importFiles` | `()` | Open a file dialog and import audio into the current playlist. |
| `scanMusic` | `()` | Scan the music folder in a background thread → `scanDoneSignal`. |
| `syncNamesCovers` | `(playlist: str)` | Re-derive title/artist from filenames and re-fetch covers. |
| `requestCovers` | `(playlist: str)` | Fetch missing covers + probe durations for a playlist. |
| `requestSidebarCovers` | `()` | Fetch covers for the first few songs of every playlist. |

### Updates (auto-update)
| Slot | Args | Purpose |
|---|---|---|
| `installUpdateNow` | `()` | Install the staged `.msi` and relaunch immediately. |

### State / theme / misc
| Slot | Args | Purpose |
|---|---|---|
| `getState` | `() → str` | Full app state JSON (schema above). Callback. |
| `setTheme` | `(name: str)` | Set the theme (clears custom accent). |
| `setAccent` | `(hex_color: str)` | Set a custom accent color. |
| `backup` | `()` | Save a JSON library backup (native file dialog). |

> **`setLanguage` is not implemented.** No such slot exists in `bridge.py`;
> localization is baked into the UI strings.

---

## 3. Non-obvious contract facts

- **`downloadProgressSignal(pct, status, queue_remaining)` — the `status` string
  now carries "X/Y".** `_dl_counter()` appends `done/total` (e.g. `"İndiriliyor…
  2/5"`) whenever a batch of more than one URL is queued via `downloadUrls`.
  `queue_remaining` is `len(download_queue)` **after** the current item was
  popped. When the queue drains, `(0, "", 0)` is emitted to clear the pill.

- **`positionChanged(pos, dur)` is the single clock.** The engine is the sole
  audio source; in clip mode the muted video is driven off this same signal
  (`syncClipVideo(pos)`), and LRC lyric highlighting rides it too
  (`clipSyncLyrics` / `syncLyrics`). There is no second timeline for the video.

- **`trackChanged` fires for same-song metadata updates too.** It is emitted not
  only on song change but also for late-arriving lyrics (`_on_lyrics`), metadata
  edits (`editMetadata`), and name/cover sync (`syncNamesCovers`) — always for the
  *currently active* song. `onTrackChanged()` must tolerate this: it compares
  `track.id === active.song_id` and, if the song is unchanged, refreshes clip
  lyrics instead of tearing down the clip.

- **`clip`/video audio is always muted** (`"muted": true` forced in
  `_on_video_ready`); all DSP effects therefore apply to the clip because the
  sound still comes from the engine, avoiding double playback.

- **`loopSignal` / progress sentinels:** `loopSignal` uses `-1` for "unset"
  (`(-1,-1)` = cleared). `separationProgressSignal` uses `(100.0, "Hazır")` for
  success and `(100.0, "")` for failure.

- **Callback-style slots:** `getState`, `getQueue`, and `autoEq` are
  `result=str` and are called with a JS callback
  (`bridge.getState(json => ...)`), not synchronously.
