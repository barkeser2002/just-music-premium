# Just Music Premium — Developer Quickstart

A Windows desktop music player: **Python + PyQt6 QtWebEngine**. The UI is a local web app
(`justmusic/web/`, HTML/CSS/JS) served over a custom `app://` scheme and wired to Python through
a `QWebChannel` bridge. Audio DSP is Python (numpy/scipy/sounddevice); downloads use the yt-dlp
Python library; studio karaoke (vocal/instrument separation) uses demucs on CPU.

This is the get-started guide. For design rationale and non-obvious decisions see the companion
docs listed in [Docs index](#6-docs-index).

> Windows-only project. All commands below are for a Windows shell (PowerShell). Paths use `\`.

---

## 1. Run from source (dev)

**Interpreter.** Python 3.13 family (`C:\Python313`). CI builds on 3.12, so both are fine.
> Trap on this machine: `python3` is the Microsoft Store stub — use `python` (i.e.
> `C:\Python313\python.exe`), not `python3`.

**Create the venv and install deps** (from the project root):

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`requirements.txt` pulls PyQt6 + PyQt6-WebEngine, numpy/scipy/sounddevice, `yt-dlp`, `demucs`
(drags in torch — CPU wheel, ~490 MB), and pyinstaller.

**Embedded binaries — `bin/` must exist.** The app calls three bundled executables that are NOT
in the repo tree by default; CI downloads them fresh each build. For a source run they must be
present in `bin/`:

| File            | Purpose                                                                 |
|-----------------|-------------------------------------------------------------------------|
| `bin\ffmpeg.exe` | transcode / decode to mp3                                              |
| `bin\yt-dlp.exe` | (the in-process yt-dlp *library* does the work; exe is the fallback)   |
| `bin\deno.exe`   | **required** for YouTube nsig / JS signature solving — see ARCHITECTURE.md |

`justmusic/config.py` resolves each from `bin/` first, falls back to `PATH`, and prepends `bin/`
to the process `PATH` so the in-process yt-dlp finds `deno.exe`. Without `deno.exe`, YouTube
downloads break. (`bin/` currently has all three checked in on this machine.)

**Launch:**

```powershell
.venv\Scripts\python.exe main.py
```

`main.py` registers the `app://` URL scheme, spins up the `QMainWindow` + `QWebEngineView`,
registers the `Bridge` on the web channel, and loads `app://app/index.html`.

**User data lives outside the repo** — in `~\Music\JustMusic\` (writable even if the app is
installed read-only):

- `library.json` — the library/playlist database (`config.DATA_FILE`)
- `downloads\` — downloaded tracks
- `covers\` — cover-art cache
- `stems\` — demucs vocal/instrument separation output (studio karaoke)

`config.ensure_dirs()` creates the base, `downloads\`, and `covers\` on startup. Your own
`~\Music` is also scanned for the auto playlist.

---

## 2. Build the exe locally

```powershell
python build.py
```

Output: **`dist\JustMusic\JustMusic.exe`** (PyInstaller **onedir** — fast startup, recommended).
`build.py --onefile` produces a single `dist\JustMusic.exe` instead (portable but slow to start).

The build `--collect-all`s torch + demucs and their friends (julius, einops, lameenc,
safetensors, sphn, huggingface_hub) plus PyQt6 WebEngine, and `--add-binary`s the three `bin/`
exes and the web UI. **Consequence: the build is large (~1.4 GB `dist\`) and slow.**

> Before rebuilding, `dist\` and `build\` will be locked if the app is running. Kill any running
> `JustMusic.exe` **and** its `QtWebEngineProcess` children, then delete `dist\` and `build\`:
>
> ```powershell
> taskkill /IM JustMusic.exe /F 2>$null; taskkill /IM QtWebEngineProcess.exe /F 2>$null
> Remove-Item -Recurse -Force dist, build -ErrorAction SilentlyContinue
> ```

---

## 3. Release a new version (the important one)

Shipping is **just tag + push** — CI builds the `.msi` and publishes the GitHub Release, and the
app auto-updates itself in the field.

1. **Bump the version to match the tag.** Edit `APP_VERSION` in `justmusic\config.py` (currently
   `"1.0.3"`) so it equals the tag you're about to push, e.g. `1.0.4`.

2. **Tag and push:**

   ```powershell
   git tag v1.0.4
   git push origin v1.0.4
   ```

   The `v*` tag triggers `.github/workflows/build.yml` on `windows-latest`, which:
   - re-stamps `config.APP_VERSION` from the tag (so the exe always knows its own version — you
     still bump it in step 1 so source and tag agree);
   - `pip install -r requirements.txt`;
   - downloads fresh `ffmpeg.exe`, `yt-dlp.exe`, `deno.exe` into `bin/`;
   - runs `python build.py`;
   - packages a `.msi` with **WiX 3.14** (`heat` → `candle` → `light`, `installer\Product.wxs`) —
     **perUser install, no UAC / admin**;
   - publishes a GitHub **Release** on the tag with **`JustMusic-Setup.msi`** attached.

   You can also run it without a tag via **workflow_dispatch** (manual run) with a `version` input.

3. **In-app auto-update** — `justmusic\updater.py`. On launch, a background `UpdateCheckThread`
   asks the GitHub "latest release" API (`config.UPDATE_API`). If the release tag is newer than
   `APP_VERSION`, it downloads `JustMusic-Setup.msi` silently to `%TEMP%\JustMusic-update\` and
   stages it. On app close (`Bridge.shutdown`), a detached `.cmd` waits for the app to exit, runs
   `msiexec /i ... /qn` (silent, perUser → no UAC), and relaunches the exe.
   - Only **frozen** (PyInstaller) builds download; a source run just compares versions and does
     nothing. No network → it gives up silently.

   Net effect: to ship, you only tag + push. Users get it on their next launch/close cycle.

4. **GitHub Pages landing page** — `.github/workflows/pages.yml` deploys `site/` to Pages on push
   to `main` (when `site/**` or the workflow file changes). Independent of the release flow.

---

## 4. Common maintenance

**yt-dlp goes stale.** YouTube changes its player/signature often; an old yt-dlp starts failing
downloads (e.g. HTTP 403). Fix:

1. bump the floor in `requirements.txt` — the `yt-dlp>=YYYY.MM.DD` line;
2. bump `APP_VERSION`, tag a patch, push.

CI always fetches the newest yt-dlp, so a fresh release usually clears it. **This is exactly what
v1.0.3 was** (`yt-dlp>=2026.8.19`, fixing the 403 that `2026.07.04` caused).

---

## 5. The knowledge graph (graphify)

`graphify-out/` holds a **graphify** code graph (god nodes, community structure, cross-file
relationships). Per the repo `CLAUDE.md`:

- For codebase questions, prefer the scoped subgraph over raw grep:
  ```powershell
  graphify query "<question>"
  graphify path "<A>" "<B>"      # relationships between two things
  graphify explain "<concept>"   # focused concept
  ```
- `graphify-out/wiki/index.md` (if present) is good for broad navigation; read
  `graphify-out/GRAPH_REPORT.md` only for wide architecture review.
- **After editing code, refresh the graph** (AST-only, no API cost):
  ```powershell
  graphify update .
  ```

---

## 6. Docs index

| Doc                        | What's in it                                              |
|----------------------------|----------------------------------------------------------|
| `docs/ARCHITECTURE.md`     | Design overview + non-obvious decisions (why deno, the `app://` scheme, DSP pipeline, clip mode) |
| `docs/BRIDGE-SIGNALS.md`   | The `QWebChannel` contracts — Python `Bridge` methods and Qt signals the web UI calls/listens to |
| `docs/KNOWN-ISSUES.md`     | Known defects and traps                                  |
| `docs/DEV.md`              | This file                                                |

---

## 7. Turkish → English glossary

The code, comments, community/playlist labels, and UI strings are Turkish. Common terms a
non-Turkish reader will hit:

| Turkish              | English                        |
|----------------------|--------------------------------|
| Kütüphanem           | My Library (default playlist)  |
| Beğenilen Şarkılar   | Liked Songs (favorites)        |
| İndirilenler         | Downloads (playlist)           |
| Çalma listesi        | Playlist                       |
| Şarkı                | Song / Track                   |
| Sanatçı              | Artist                         |
| Ara / Arama          | Search                         |
| İndir                | Download                       |
| Efektler             | Effects                        |
| Ekolayzır            | Equalizer                      |
| Kuyruk / Sıradaki    | Queue / Up next                |
| Sözler / Şarkı Sözleri | Lyrics                       |
| Karaoke / Vokal      | Vocal (karaoke)                |
| Enstrümantal         | Instrumental                   |
| Ayır                 | Separate (stems)               |
| Kapak                | Cover art                      |
| Tema                 | Theme                          |
| Ayarlar              | Settings                       |
| Sürükle              | Drag                           |
| Klip / Klip izle     | Video clip / Watch clip        |
| Ses                  | Volume / Audio                 |
| Hız                  | Speed                          |
| Tara                 | Scan (music folder)            |
| Yedek / Yedek al     | Backup / Back up               |
| Güncelleme           | Update                         |
| Ruh Hali             | Mood                           |
| Akıllı Listeler      | Smart Playlists                |
| Ana Sayfa            | Home                           |
| Oynat / Duraklat     | Play / Pause                   |
| Önceki / Sonraki     | Previous / Next                |
| Karıştır             | Shuffle                        |
| Tekrarla             | Repeat                         |
| Beğen                | Like                           |
| Görselleştirici      | Visualizer                     |
| Uyku zamanlayıcı     | Sleep timer                    |
| Sessize al           | Mute                           |
| Ambiyans ışığı       | Ambient light                  |
| Kompakt mod          | Compact mode                   |
| İstatistikler        | Statistics                     |
| Ekle                 | Add (import)                   |
| Tam ekran            | Fullscreen                     |
| Bas / Orta / Tiz     | Bass / Mid / Treble (EQ bands) |
| Yankı / Reverb       | Reverb / Echo                  |
| Oda                  | Room (reverb preset)           |
| Düzenle              | Edit                           |
| Sil / Kaldır         | Delete / Remove                |
| Bilinmeyen           | Unknown (missing metadata)     |
