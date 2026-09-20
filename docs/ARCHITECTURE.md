# Just Music Premium — Architecture

A Windows desktop music player. The UI is a web page (HTML/CSS/JS) rendered by
QtWebEngine; all real logic — audio, downloads, library, karaoke — is native
Python. There is **no HTTP server and no TCP port**: everything runs in one
process, and the web layer talks to Python over a QWebChannel bridge.

This document is a fast context rebuild for a future developer or AI. Every claim
is cited to a file (and line where useful). Paths are relative to the repo root
`C:\Users\bkese\Desktop\jasb31`.

---

## 1. Big picture

```
+-----------------------------------------------------------+
|  QMainWindow (main.py)                                     |
|  +-----------------------------------------------------+  |
|  |  QWebEngineView  ->  justmusic/web/index.html       |  |
|  |     HTML / app.css / app.js   (visual layer ONLY)   |  |
|  +--------------------------^--------------------------+  |
|            QWebChannel       |  (JS <-> Python, in-process)|
|  +--------------------------v--------------------------+  |
|  |  Bridge (justmusic/bridge.py)  — the controller     |  |
|  |    owns: DspEngine, Library, worker QThreads        |  |
|  +-----------------------------------------------------+  |
|  app:// URL scheme (justmusic/scheme.py) serves web       |
|  assets + cached cover images. No server, no port.        |
+-----------------------------------------------------------+
```

- **Entry point:** `main.py`. It registers the custom `app://` URL scheme
  **before** `QApplication` is created — this ordering is mandatory for
  QtWebEngine (`main.py:13-26`, `_register_scheme()` then module-level call at
  line 26; `QApplication(sys.argv)` only at `main.py:64`). It then builds the
  window, installs the scheme handler, creates the `Bridge`, wires a
  `QWebChannel` with the bridge registered as the object `"bridge"`
  (`main.py:88-92`), and loads `app://app/index.html` (`main.py:98`).
- **The bridge** (`justmusic/bridge.py`, class `Bridge(QObject)` at line 256) is
  the application controller. UI actions call its `@pyqtSlot` methods; Python
  pushes state back via `pyqtSignal`s (declared `bridge.py:257-278`). The web
  side connects to it in `app.js:1256-1257`
  (`new QWebChannel(qt.webChannelTransport, …); bridge = channel.objects.bridge;`).
- **The `app://` scheme** (`justmusic/scheme.py`) is a
  `QWebEngineUrlSchemeHandler` that reads files off disk and replies in-process:
  `app://app/<path>` -> `justmusic/web/<path>`, and `app://app/cover/<hash>.jpg`
  -> `~/Music/JustMusic/covers/<hash>.jpg` (`scheme.py:52-74`). It is registered
  as a **secure** scheme (not a LocalScheme) so the page counts as a secure
  origin and can load remote cover thumbnails from ytimg (`main.py:17-22`).
- **State sync:** a 60 ms `QTimer` (`POLL_MS = 60`, `bridge.py:24`) polls the
  engine in `Bridge._on_poll` (`bridge.py:1382`) and emits `playingChanged`,
  `spectrumSignal`, and `positionChanged(pos, dur)` (`bridge.py:1385-1391`). The
  engine itself is Qt-independent; the UI polls it.

---

## 2. Why there is no server (non-obvious)

An earlier version of this app used **pywebview**, which served the web UI from a
**local HTTP server on port 8998**. That produced a port-collision / infinite-lock
bug. The current design serves every asset in-process through the `app://` scheme,
so that entire class of bug is structurally impossible — there is no socket to
collide on and nothing to deadlock. This is documented in the project README
(`README.md:38-40`, "Sunucu / port YOK … Eski pywebview sürümündeki port
çakışması / sonsuz kilitlenme burada imkânsız") and `scheme.py:1-6`. Residual
traces of the old pywebview data model are still migrated on load
(`library.py:50-59`, old `playCount` / `raw_path` fields).

---

## 3. Audio is native, not the browser

QtWebEngine is used for **pixels only**. All sound goes through the native DSP
engine in `justmusic/engine.py` (class `DspEngine`, line 247).

- **Decode:** `decode_audio()` shells out to the embedded ffmpeg
  (`config.FFMPEG`) to turn any input format into raw `f32le` stereo PCM, then
  reshapes it to a NumPy `(N, 2)` float32 buffer at 44.1 kHz
  (`engine.py:67-83`). ffmpeg is run with `CREATE_NO_WINDOW` so no console flashes
  in the windowed exe (`engine.py:27`, `74-77`).
- **Playback:** a `sounddevice` (PortAudio) `OutputStream` with a callback
  (`engine.py:298-312`, callback at `504`). Decoding happens on a background
  thread (`_decode_worker`, `engine.py:337`); a generation counter `_gen`
  discards stale decodes when the user skips quickly (`engine.py:325`, `344-345`).
- **Real-time chain** (per audio block, in `_callback`, `engine.py:504-569`):
  variable-speed resampling by linear interpolation over a fractional sample
  index (`engine.py:520-526`) -> preamp -> **10-band EQ** (RBJ biquads via
  `scipy.signal.sosfilt`, `engine.py:543-544`) -> bass low-shelf
  (`engine.py:546-548`) -> **karaoke** center-channel cancel (`engine.py:550-554`)
  -> echo -> reverb (multi-tap) -> spatial **8D** panning -> volume -> optional
  soundscape mix -> clip to [-1, 1] (`engine.py:558-569`). Effect implementations:
  `_apply_echo`/`_apply_reverb`/`_apply_spatial` (`engine.py:591-630`).
- **Presets:** 30 EQ presets + an auto-EQ analyzer. Presets live in
  `eqpresets.py:11-42` (`PRESETS`, 30 entries); "Oto" is computed from the track's
  average spectrum in `engine.auto_eq_gains` (`engine.py:86-116`) and applied via
  `Bridge.autoEq` (`bridge.py:815`).

This native pipeline is the whole reason the feature set exists: `QMediaPlayer`
could not provide a custom per-block DSP chain, so 30 EQ presets plus
bass/echo/reverb/8D/karaoke are only possible because audio is handled in NumPy,
not the browser. The engine also derives extras from the same buffer: waveform
peaks, mood, BPM, loudness normalization, and a small spectrogram
(`engine.py:119-244`).

---

## 4. Clip (video) mode — the single-clock design (very non-obvious)

The most subtle part of the app. Read this before touching clip code.

**The constraint.** QtWebEngine cannot decode H.264/AAC, and YouTube no longer
serves a muxed WebM stream. So a `<video>` element cannot both show the picture
and carry synced audio. (`VideoStreamThread` docstring, `bridge.py:127-133`;
format string forces WebM VP9 video + WebM/Opus audio, `bridge.py:150-153`.)

**The solution: one clock, one audio source.** The clip's picture is the VP9
video played **muted**; the **only** audio is the DSP engine's already-loaded mp3.
The muted `<video>` is slaved to the engine:

- `Bridge.playVideo` (`bridge.py:1010-1032`) does **not** stop the engine. It
  records the engine's current position as the video start offset
  (`_video_handoff`, `bridge.py:1026`) and kicks off `VideoStreamThread` to
  resolve stream URLs with yt-dlp (no download).
- When URLs arrive, `_on_video_ready` forces `data["muted"] = True` and passes the
  start second (`bridge.py:1034-1041`). Audio always comes from the engine.
- In the web layer, `buildClipMedia` (`app.js:1085-1108`) creates a muted
  `<video>` (`v.muted=true; v.volume=0`), seeks it to the handoff second, mirrors
  the engine's play state, and matches `v.playbackRate` to the DSP speed
  (`app.js:1092-1106`).
- The engine is the single clock. On every `positionChanged` tick the video is
  re-synced and lyrics advance: `bridge.positionChanged.connect((pos,dur)=>{ …
  if(clip){syncClipVideo(pos); clipSyncLyrics(pos);} })` (`app.js:714`).
  `syncClipVideo` nudges `currentTime` only when drift exceeds 0.35 s
  (`app.js:1110-1114`); `clipMirrorPlay` mirrors play/pause (`app.js:1116-1119`).

Result: no double playback, and every DSP effect (EQ, speed, karaoke, reverb…)
applies to the clip too because the clip's sound *is* the engine.

**The crash guard.** `stopClip(resume)` (`app.js:1120-1131`) must strip the
`src` and remove the `<video>` from the DOM (`v.pause(); v.removeAttribute('src');
v.load();` then `c.host.remove()`). A merely-paused `<video>` left live in the DOM
keeps network traffic and **crashes WebEngine on window close** — this is called
out in the code comment at `app.js:1124-1126`.

**Persistent mini-player.** The video/lyrics live inside a single persistent
`clip.host` element that is **moved, never destroyed**, when the user navigates
away — so the stream is not torn down and yt-dlp is not re-invoked. `goMiniClip`
(`app.js:1138-1151`) reparents `clip.host` into a bottom-right mini box;
`renderClipView` (`app.js:1152-1182`) moves it back onto the big stage. Leaving
the clip view calls `goMiniClip()` rather than stopping (`app.js:218`, `236`,
`249`). The clip only truly ends on "Sese geç" (exit), closing the mini box, or a
track change (design comment `app.js:1075-1078`). `resumeMusic`
(`bridge.py:1046-1051`) just ensures the engine is playing; it never stopped.

`VideoStreamThread` still resolves an `audio_url` too, but the new architecture
ignores it — audio is always the engine (`bridge.py:169-185`, and
`data["muted"]=True` at `1040`).

---

## 5. Downloads and search

- **yt-dlp is used as a Python library, not the exe.** `downloader.py`
  (`DownloadThread`) imports `yt_dlp` and drives it directly for real progress
  hooks, an exact post-conversion file path, and readable errors
  (module docstring `downloader.py:1-6`; `import yt_dlp` at `52`; opts at
  `60-75`; mp3 postprocessor 192 kbps). Cover search also uses the library
  (`covers.py:85-92`). Clip streaming uses it too (`bridge.py:144`). The bundled
  `bin/yt-dlp.exe` exists but the running code path is the in-process library.
- **Embedded binaries in `bin/`:** `ffmpeg.exe`, `yt-dlp.exe`, `deno.exe`
  (confirmed present in `bin/`). Resolved in `config.py:60-71`.
- **Deno is REQUIRED.** Modern yt-dlp needs a JavaScript runtime to solve
  YouTube's `nsig` signature challenge. Without Deno, *search* still works but
  *downloads* mostly 403 / fail. `config.py:71` points `DENO` at `bin/deno.exe`,
  and — critically — `config.py:78-79` **prepends `bin/` to the process `PATH`**
  so the in-process `yt_dlp` library discovers Deno and ffmpeg. `subprocess_env()`
  (`config.py:82-86`) does the same for any child processes.
- **yt-dlp goes stale fast** (YouTube keeps changing), so the pinned floor is
  bumped often: `requirements.txt:7` is `yt-dlp>=2026.8.19` with a note that
  `2026.07.04` caused HTTP 403 on download until the upgrade fixed it. The CI
  build always fetches the newest `yt-dlp.exe` (`.github/workflows/build.yml:60`).
  Keep it bumped.

---

## 6. Karaoke / vocal separation

- **Engine:** `justmusic/separation.py` runs Demucs `htdemucs` on **CPU only**
  (`Separator(model="htdemucs", device="cpu", …)`, `separation.py:106`). It splits
  a track into stems and builds the instrumental as `drums + bass + other`
  (`separation.py:113`), saving `no_vocals.wav` (karaoke) and `vocals.wav`
  (acapella).
- **Cache:** stems are cached under `~/Music/JustMusic/stems/<hash>/`, where the
  hash is md5 of `abspath|filesize` (`separation.py:35-45`). A cached track
  switches instantly and is never re-separated (`cached_stems`,
  `separation.py:48-54`; `SeparationThread.run` short-circuits on cache,
  `separation.py:73-76`). CPU separation is slow (minutes/song), so it runs on a
  `QThread` with progress signals (`separation.py:57-125`).
- **Seamless switch via `swap_source`.** Selecting a stem calls
  `DspEngine.swap_source(path)` (`engine.py:354-383`), which decodes the stem on a
  worker thread and swaps the audio buffer while **preserving the current position
  and play state** (`_swap_worker`, `engine.py:367-383`). This is the key
  difference from `load()`, which resets position to 0 (`engine.py:324-335`).
  Because position is preserved, karaoke / acapella toggles mid-song without a jump
  and all DSP effects keep applying. Wiring: `Bridge.setKaraoke`
  (`bridge.py:834-885`) and `_apply_stem` (`bridge.py:887-892`). Modes are
  `off`, `quick` (instant mid-side cancel, no engine needed), `instrumental`, and
  `vocals`. If torch/demucs are unavailable, `demucs_available()`
  (`separation.py:25-32`) is false and the UI falls back to `quick` mid-side
  karaoke (`bridge.py:863-868`).
- **Bundling:** `torch` and `demucs` (plus `julius`, `einops`, `lameenc`,
  `safetensors`, `sphn`, `huggingface_hub`) are collected into the exe
  (`build.py:33-42`; `requirements.txt:10-12`, CPU torch wheel, no CUDA).

---

## 6b. Transitions: crossfade / gapless + Discord (v1.3.0)

- **Pre-decode the next track.** `DspEngine.preload_next(path)` decodes the
  upcoming track on a worker thread into `_next_audio` (gen-guarded like `_gen`).
  `Bridge._maybe_preload_next` (in `_on_poll`) triggers this when
  `dur - pos ≤ crossfade + 8s`, but **only for predictable sequential playback** —
  it bails when `shuffle`, a non-empty `user_queue`, or `repeat_mode == 2`
  (repeat-one) would make "next" unpredictable. `load()`/`swap_source()`/`clear()`
  all call `clear_next()` so a manual skip drops a stale preload.
- **The blend happens in the one audio callback.** In `_callback`, once the next
  buffer exists and no A-B loop is active: with `crossfade_sec > 0` it equal-power
  crossfades (`gout=cos(t·π/2)`, `gin=sin(t·π/2)`, `t` from per-sample seconds-left)
  by mixing `_interp_block(current)` with `_interp_block(next)` **before** the shared
  DSP chain, so EQ/effects apply once to the blended stream. With `gapless` (and
  `crossfade_sec == 0`) it promotes at the boundary with no overlap.
- **Promotion → gapless UI update.** `_promote_next()` swaps `audio`/`current_path`
  ← next under the lock, carries `pos` from `_next_pos`, and sets `_advanced`.
  The poll calls `engine.consume_advanced()`; a returned path routes to
  `Bridge._on_crossfade_advanced`, which advances `play_index`/`active_song_id` and
  emits `trackChanged` **without reloading the engine** — no gap, no re-decode.
  **Default off (`crossfade=0`, `gapless=False`) = byte-for-byte the old behavior**
  (the engine sets `_at_end`, the poll's `consume_end()` → `_on_media_ended`).
- **Discord Rich Presence** lives in `justmusic/richpresence.py` (`DiscordPresence`),
  an optional, thread-safe, fault-tolerant wrapper over **`pypresence`** (imported
  lazily; `pypresence_available()` gates the UI). It needs Discord running **and** a
  user-supplied **Application Client ID** (`settings.discord_client_id`). Updates are
  throttled (~15s, immediate on track/play-state change) and pushed from `_on_poll`
  (`_tick % 80`), on `trackChanged`, and on play/pause. Connection failures degrade
  silently (Discord closed / bad ID → no-op). Slots: `setCrossfade`, `setGapless`,
  `setDiscordRpc`, `setDiscordClientId`.

---

## 7. Packaging and distribution

- **PyInstaller onedir.** `build.py` builds a windowed one-dir bundle (default;
  `--onefile` optional). It `--collect-all`s WebEngine core, sounddevice
  (PortAudio DLL), yt_dlp, certifi, torch, demucs and friends, adds the `bin/`
  binaries and `justmusic/web/` + logo as data (`build.py:25-57`). A checked-in
  `JustMusic.spec` also exists.
- **CI: `.github/workflows/build.yml`.** On a `v*` tag push (or manual dispatch)
  it stamps `config.APP_VERSION` from the tag (`build.yml:38-44`), downloads fresh
  ffmpeg / yt-dlp / deno into `bin/` (`build.yml:51-65`), runs `build.py`, then
  packages a **`.msi` with WiX 3.14** via heat/candle/light (`build.yml:79-98`)
  and uploads it to a GitHub Release (`build.yml:100-105`). The MSI is **perUser**
  (no UAC / admin), per `installer/Product.wxs` and the release notes
  (`build.yml:109`).
- **In-app auto-update:** `justmusic/updater.py`. `UpdateCheckThread`
  (`updater.py:58`) queries the GitHub "latest release" API 3.5 s after launch
  (`bridge.py:339`, `_start_update_check` at `1054`). In a frozen build it silently
  downloads the new `.msi` to `%TEMP%\JustMusic-update\` in the background
  (`updater.py:123-140`); the path is staged in `Bridge._staged_update`
  (`bridge.py:1071-1075`). On close, `bridge.shutdown` calls `_perform_update`
  (`bridge.py:1478-1480`), which writes a detached `.cmd` that waits for the app to
  exit, runs `msiexec /i … /qn` silently (perUser -> no UAC), and relaunches the
  exe (`updater.install_and_relaunch`, `updater.py:143-173`). In dev (non-frozen)
  it only compares versions, never downloads (`updater.py:96-98`).
- **Landing page:** a static GitHub Pages site in `site/` (`site/index.html`,
  `site/img/`).

---

## 8. Module map (one line each)

- `justmusic/config.py` — constants and paths; resolves embedded `bin/` binaries
  and **prepends `bin/` to `PATH`** so in-process yt-dlp finds Deno/ffmpeg.
- `justmusic/engine.py` — `DspEngine`: ffmpeg decode to NumPy `(N,2)`, sounddevice
  output, real-time speed/EQ/effects/karaoke chain, `swap_source`, analysis.
- `justmusic/bridge.py` — QWebChannel controller: `@pyqtSlot` API for the UI,
  signals back, owns the engine/library and all worker `QThread`s.
- `justmusic/library.py` — data model + JSON persistence (`library.json`),
  playlists, `~/Music` scan, favorites, legacy migration.
- `justmusic/downloader.py` — `DownloadThread`: yt-dlp Python library search +
  download, ffmpeg extract to mp3, builds a song dict.
- `justmusic/covers.py` — background cover fetcher (queue + thread): downloads a
  thumbnail URL, or searches one via yt-dlp; caches to `covers/`.
- `justmusic/naming.py` — messy filename -> clean "Artist - Title" for display and
  cover search.
- `justmusic/separation.py` — Demucs `htdemucs` (CPU) stem separation with
  on-disk cache under `stems/<hash>/`.
- `justmusic/updater.py` — GitHub-Releases auto-update: check, background `.msi`
  download, detached silent install + relaunch on close.
- `justmusic/scheme.py` — the `app://` URL scheme handler serving web assets and
  cover images in-process (no server).
- `justmusic/eqpresets.py` — 10 band center frequencies, 30 EQ presets, default
  effect slider values.
- `justmusic/web/app.js` — the whole UI: rendering, event wiring, QWebChannel
  hookup, clip mode (buildClipMedia / stopClip / goMiniClip / sync), lyrics.
- `justmusic/web/app.css` — all styling (themes, layout, responsive, player bar,
  clip stage + mini player).
- `justmusic/web/index.html` — DOM skeleton (topbar, sidebar, main view, player
  footer); loads `qwebchannel.js`, `app.css`, `app.js`.

---

### Quick pointers for common tasks

- Change an EQ preset or add one: `justmusic/eqpresets.py`.
- Add a UI action: add a `@pyqtSlot` on `Bridge` and call `bridge.<method>()` from
  `app.js`; push results back with a `pyqtSignal`.
- Touch clip playback: re-read section 4 first, and never leave a live `<video>`
  in the DOM.
- After editing code, `graphify update .` keeps `graphify-out/` current (per the
  project CLAUDE.md).
