"""JS ↔ Python köprüsü (QWebChannel) — uygulamanın kontrolörü.

Tüm arayüz web'de; bu sınıf ses motorunu, kütüphaneyi, indirmeyi, kapakları
yönetir. Slotlar JS'ten çağrılır, sinyaller JS'e yayınlanır.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys

from PyQt6.QtCore import QObject, QThread, QTimer, pyqtSignal, pyqtSlot
from PyQt6.QtWidgets import QApplication, QFileDialog

from . import config, engine as engine_mod, eqpresets, naming, separation, updater
from .covers import CoverFetcher
from .downloader import DownloadThread
from .engine import DspEngine
from .library import Library, make_song

POLL_MS = 60
_NO_WINDOW = 0x08000000


class SearchThread(QThread):
    results = pyqtSignal(list)
    failed = pyqtSignal(str)

    def __init__(self, query: str, limit: int = 20, parent=None,
                 playlist_url: str = "") -> None:
        super().__init__(parent)
        self.query = query
        self.limit = limit
        self.playlist_url = playlist_url   # dolu ise: playlist'i aç (arama değil)
        self._stopped = False

    def stop(self) -> None:
        self._stopped = True

    def run(self) -> None:
        try:
            import yt_dlp
        except ImportError:
            self.failed.emit("yt-dlp kütüphanesi bulunamadı.")
            return
        if self.playlist_url:
            # PLAYLIST modu: URL'yi aynen aç, noplaylist=False ile tüm parçaları listele
            opts = {"quiet": True, "no_warnings": True, "skip_download": True,
                    "extract_flat": True, "noplaylist": False, "playlistend": 200}
            target = self.playlist_url
        else:
            opts = {"quiet": True, "no_warnings": True, "skip_download": True,
                    "extract_flat": True, "noplaylist": True}
            target = f"ytsearch{self.limit}:{self.query}"
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(target, download=False)
        except Exception as exc:
            self.failed.emit(str(exc))
            return
        rows = []
        for e in ((info or {}).get("entries") or []):
            if not e:
                continue
            vid = e.get("id")
            if not vid:
                continue
            dur = e.get("duration") or 0
            rows.append({
                "id": vid,
                "title": e.get("title") or vid,
                "uploader": e.get("channel") or e.get("uploader") or "",
                "duration_ms": int(dur * 1000) if dur else 0,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}",
            })
        self.results.emit(rows)


class ScanThread(QThread):
    done = pyqtSignal(list)

    def run(self) -> None:
        try:
            collected = Library.collect_music_folder()
        except Exception:
            collected = []
        self.done.emit(collected)


class DurationProber(QThread):
    """Gömülü ffmpeg ile şarkı sürelerini arka planda okur (tablo süreleri için)."""
    probed = pyqtSignal(str, int)  # song_id, duration_ms

    def __init__(self, items, parent=None) -> None:
        super().__init__(parent)
        self.items = items  # [(id, path), ...]
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        import re
        pat = re.compile(rb"Duration: (\d+):(\d+):(\d+)\.(\d+)")
        for sid, path in self.items:
            if self._stop:
                break
            if not path or not os.path.exists(path):
                continue
            try:
                proc = subprocess.run(
                    [config.FFMPEG, "-i", path, "-hide_banner"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                    creationflags=_NO_WINDOW, timeout=20)
                m = pat.search(proc.stderr or b"")
                if m and not self._stop:
                    h, mn, s, cs = (int(x) for x in m.groups())
                    self.probed.emit(sid, ((h * 3600 + mn * 60 + s) * 100 + cs) * 10)
            except Exception:
                pass


class VideoStreamThread(QThread):
    """yt-dlp ile klip akış URL'lerini çözer (İNDİRME YOK — doğrudan stream).

    QtWebEngine H.264/AAC oynatamaz; YouTube da artık muxed webm vermiyor.
    Bu yüzden WebM VP9 (video-only) + Opus (audio-only) URL'leri ayrı döner,
    arayüz bunları senkron oynatır.
    """
    ready = pyqtSignal(str)   # json {id, video, audio, title, duration}
    failed = pyqtSignal(str)

    def __init__(self, sid: str, query: str, parent=None) -> None:
        super().__init__(parent)
        self.sid = sid
        self.query = (query or "").strip()

    def run(self) -> None:
        try:
            import yt_dlp
        except ImportError:
            self.failed.emit("yt-dlp kütüphanesi bulunamadı.")
            return
        is_url = self.query.startswith(("http://", "https://"))
        target = self.query if is_url else f"ytsearch1:{self.query}"
        # QtWebEngine yalnızca webm (VP9/VP8 + Opus/Vorbis) oynatır
        fmt = ("bestvideo[ext=webm][height<=720]+bestaudio[ext=webm]/"
               "best[ext=webm][vcodec!=none][acodec!=none]/"
               "bestvideo[height<=720][ext=webm]+bestaudio")
        opts = {"quiet": True, "no_warnings": True, "skip_download": True,
                "noplaylist": True, "format": fmt}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(target, download=False)
            if info and "entries" in info:
                entries = [e for e in info["entries"] if e]
                if not entries:
                    self.failed.emit("Klip bulunamadı.")
                    return
                info = entries[0]
        except Exception as exc:
            self.failed.emit(f"Klip akışı çözülemedi: {exc}")
            return

        video_url = audio_url = ""
        rf = info.get("requested_formats")
        if rf:
            for f in rf:
                if f.get("vcodec") and f.get("vcodec") != "none":
                    video_url = f.get("url") or video_url
                if f.get("acodec") and f.get("acodec") != "none":
                    audio_url = f.get("url") or audio_url
        else:
            video_url = info.get("url") or ""
        if not video_url:
            self.failed.emit("Oynatılabilir klip akışı bulunamadı.")
            return
        self.ready.emit(json.dumps({
            "id": self.sid, "video": video_url, "audio": audio_url,
            "title": info.get("title") or "", "duration": info.get("duration") or 0,
        }))


class LyricsThread(QThread):
    """Lyrica servisinden zaman kodlu (LRC) şarkı sözü getirir."""
    ready = pyqtSignal(str, str, str)   # song_id, lyrics, source
    failed = pyqtSignal(str)

    def __init__(self, sid: str, artist: str, title: str, parent=None) -> None:
        super().__init__(parent)
        self.sid = sid
        self.artist = (artist or "").strip()
        self.title = (title or "").strip()

    @staticmethod
    def _get(url: str):
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": "JustMusic/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", "replace"))

    def run(self) -> None:
        import urllib.parse
        artist, title = self.artist, self.title
        if not title:
            return
        try:
            if not artist:  # sanatçı yoksa önce öneriyle bul
                try:
                    s = self._get(f"{config.LYRICS_API}/suggestion?q={urllib.parse.quote(title)}&limit=1")
                    items = s.get("data") or s.get("results") or s.get("suggestions") or []
                    if isinstance(items, list) and items and isinstance(items[0], dict):
                        artist = items[0].get("artist") or ""
                        title = items[0].get("title") or items[0].get("song") or title
                except Exception:
                    pass
            url = (f"{config.LYRICS_API}/lyrics/?artist={urllib.parse.quote(artist or title)}"
                   f"&song={urllib.parse.quote(title)}&timestamps=true&fast=true")
            d = self._get(url)
        except Exception as exc:
            self.failed.emit(f"Söz servisine ulaşılamadı: {exc}")
            return
        data = (d or {}).get("data") or {}
        if (d or {}).get("status") != "success" or not data.get("lyrics"):
            self.failed.emit("Bu şarkı için söz bulunamadı.")
            return
        self.ready.emit(self.sid, data.get("lyrics") or "", str(data.get("source") or ""))


class AnalyzeThread(QThread):
    """Şarkı DNA'sı (dalga formu) + ruh hali analizini arka planda yapar."""
    ready = pyqtSignal(str)

    def __init__(self, audio, sid, parent=None) -> None:
        super().__init__(parent)
        self.audio = audio
        self.sid = sid

    def run(self) -> None:
        try:
            wf = engine_mod.waveform_peaks(self.audio, 480)
            label, color = engine_mod.analyze_mood(self.audio)
            bpm = engine_mod.estimate_bpm(self.audio)
            gain = engine_mod.loudness_gain(self.audio)
            spec = engine_mod.spectrogram(self.audio)
        except Exception:
            wf, label, color, bpm, gain, spec = [], "", "", 0, 1.0, []
        self.ready.emit(json.dumps({"id": self.sid, "waveform": wf, "mood": label,
                                    "color": color, "bpm": bpm, "gain": gain, "spectrogram": spec}))


class Bridge(QObject):
    # Py -> JS
    stateChanged = pyqtSignal()
    trackChanged = pyqtSignal(str)
    playingChanged = pyqtSignal(bool)
    positionChanged = pyqtSignal(float, float)
    spectrumSignal = pyqtSignal(str)
    coverReadySignal = pyqtSignal(str, str)
    toastSignal = pyqtSignal(str)
    downloadProgressSignal = pyqtSignal(float, str, int)
    downloadDoneSignal = pyqtSignal(str)
    searchResultsSignal = pyqtSignal(str)
    scanDoneSignal = pyqtSignal(int, int)
    durationSignal = pyqtSignal(str, int)   # song_id, ms
    queueChanged = pyqtSignal(str)          # json kuyruk
    videoReadySignal = pyqtSignal(str)      # json {id, video, audio, title}
    analysisSignal = pyqtSignal(str)        # json {id, waveform, mood, color}
    loopSignal = pyqtSignal(float, float)   # A, B (sn); -1 = yok
    updateAvailableSignal = pyqtSignal(str, str)  # sürüm, notlar
    updateProgressSignal = pyqtSignal(float)      # indirme yüzdesi
    updateReadySignal = pyqtSignal(str)           # sürüm (indirildi, çıkışta kurulur)
    separationProgressSignal = pyqtSignal(float, str)  # yüzde, durum (htdemucs)
    karaokeModeSignal = pyqtSignal(str)           # off/quick/instrumental/vocals

    def __init__(self, window=None, parent=None) -> None:
        super().__init__(parent)
        self.window = window
        self.library = Library()
        self.library.load()
        self.engine = DspEngine()
        self.engine.start()
        self.cover_fetcher = CoverFetcher(self)
        self.cover_fetcher.coverReady.connect(self._on_cover)
        self.cover_fetcher.coverFailed.connect(lambda sid: self.cover_requested.discard(sid))
        self.cover_fetcher.start()

        self.play_list_name = self.library.current
        self.play_index = -1
        self.active_song_id = None
        self.shuffle = False
        self.repeat_one = False
        self.repeat_mode = 1   # 0=kapalı, 1=liste, 2=tek
        self._base_volume = float(self.library.settings.get("volume", 80))
        self._cur_gain = 1.0
        self.normalize = bool(self.library.settings.get("normalize", False))
        self.download_queue: list[str] = []
        self.active_download = None
        self.download_total = 0        # "X/Y" pill sayacı (toplu indirmede)
        self.scan_thread = None
        self._search = None
        self.user_queue: list[dict] = []      # {"playlist","id"}
        self._probers: list = []
        self._analyzers: list = []
        self._lyric_threads: list = []
        self._video_threads: list = []
        self._video_handoff = 0.0   # klip<->müzik konum devri (sn); 0 = devir yok
        self._analyzed_id = None
        self._loop_a = None
        self._loop_b = None
        self._probed_ids: set[str] = set()
        self.cover_requested: set[str] = set()
        self._last_dur = -1.0
        self._last_playing = False
        self._tick = 0
        self._listen_accum = 0.0
        self._cover_dirty = False
        self._closing = False
        self._staged_update = None    # kurulacak .msi yolu (indirildiyse)
        self._staged_version = ""
        self._update_thread = None
        self._sep_thread = None       # htdemucs ayırma iş parçacığı
        self._karaoke_mode = "off"    # off/quick/instrumental/vocals
        self._sep_song_id = None      # ayırmanın hedef parçası
        self._sep_target = "off"      # ayırma bitince uygulanacak mod

        self._apply_audio_settings()
        self.poll = QTimer(self)
        self.poll.timeout.connect(self._on_poll)
        self.poll.start(POLL_MS)

        if self._is_library_empty():
            QTimer.singleShot(600, self.scanMusic)
        # Açılış yükünü etkilememek için güncelleme kontrolü gecikmeli başlar
        QTimer.singleShot(3500, self._start_update_check)

    # ================= yardımcılar =================
    def _is_library_empty(self) -> bool:
        return all(len(v) == 0 for v in self.library.playlists.values())

    def _cover_url(self, song_id: str) -> str:
        return "app://app/cover/" + hashlib.md5(song_id.encode("utf-8")).hexdigest() + ".jpg"

    def _song_view(self, song: dict) -> dict:
        thumb = song.get("thumbnail", "")
        return {
            "id": song["id"], "title": song.get("title", ""),
            "artist": song.get("artist", ""), "favorite": song.get("favorite", False),
            "duration_ms": song.get("duration_ms", 0), "play_count": song.get("play_count", 0),
            "source": song.get("source", "local"),
            "cover": self._cover_url(song["id"]),
            "hasCover": bool(thumb and os.path.exists(thumb)),
            "mood": song.get("mood", ""),
            "bpm": song.get("bpm", 0),
        }

    def _track_json(self) -> str:
        song = (self.library.find_song(self.play_list_name, self.active_song_id)
                if self.active_song_id else None)
        if not song:
            return json.dumps({"none": True})
        v = self._song_view(song)
        v.update({"playlist": self.play_list_name, "lyrics": song.get("lyrics", ""),
                  "shuffle": self.shuffle, "repeat": self.repeat_one,
                  "repeat_mode": self.repeat_mode})
        return json.dumps(v)

    def _apply_audio_settings(self) -> None:
        s = self.library.settings
        self._base_volume = float(s.get("volume", 80))
        self.normalize = bool(s.get("normalize", False))
        self._apply_norm_gain()
        self.engine.set_speed(float(s.get("speed", 1.0)))
        gains = s.get("eq_gains") or eqpresets.PRESETS["🎚 Flat"]
        self.engine.set_eq([float(g) for g in gains])
        self.engine.set_eq_enabled(bool(s.get("eq_enabled", True)))
        fx = dict(eqpresets.DEFAULT_EFFECTS)
        fx.update(s.get("effects", {}))
        for k, val in fx.items():
            self.engine.set_effect(k, val)
        sc = s.get("soundscape")
        if isinstance(sc, list) and len(sc) == 2:
            self.engine.set_soundscape(sc[0], sc[1])

    # ================= durum =================
    @pyqtSlot(result=str)
    def getState(self) -> str:  # noqa: N802
        if os.environ.get("JM_GATE") and not getattr(self, "_proofed", False):
            self._proofed = True
            try:
                import tempfile
                # donmuş derlemede torch/demucs gerçekten yüklenebiliyor mu da kanıtla
                with open(os.path.join(tempfile.gettempdir(), "jm_web_proof.txt"), "w") as f:
                    f.write(f"ui-loaded demucs={separation.demucs_available()}")
            except Exception:
                pass
        playlists = {name: [self._song_view(s) for s in songs]
                     for name, songs in self.library.playlists.items()}
        return json.dumps({
            "playlists": playlists,
            "protected": list(config.PROTECTED_PLAYLISTS),
            "version": config.APP_VERSION,
            "current": self.library.current,
            "settings": self.library.settings,
            "presets": eqpresets.PRESETS,
            "presetNames": eqpresets.PRESET_NAMES,
            "bandLabels": eqpresets.BAND_LABELS,
            "effectDefaults": eqpresets.DEFAULT_EFFECTS,
            "effectDefsOrder": [k for k in eqpresets.DEFAULT_EFFECTS],
            "active": {"playlist": self.play_list_name, "song_id": self.active_song_id,
                       "playing": self.engine.is_playing(),
                       "shuffle": self.shuffle, "repeat": self.repeat_one,
                       "repeat_mode": self.repeat_mode},
            "stats": self.library.stats,
            "recent": self._recent_views(),
            "favoritesName": config.FAVORITES_PLAYLIST,
            "demucs": separation.demucs_available(),   # stüdyo karaoke motoru var mı
            "karaokeMode": self._karaoke_mode,
        })

    def _recent_views(self) -> list:
        out = []
        seen = set()
        for r in self.library.settings.get("recent", []):
            key = r.get("id")
            if key in seen:
                continue
            s = self.library.find_song(r.get("playlist", ""), r.get("id", ""))
            if s:
                seen.add(key)
                v = self._song_view(s)
                v["playlist"] = r.get("playlist", "")
                out.append(v)
        return out

    # ================= oynatma =================
    @pyqtSlot(str, str)
    def play(self, song_id: str, playlist: str) -> None:
        songs = self.library.playlists.get(playlist, [])
        for i, s in enumerate(songs):
            if s["id"] == song_id:
                self.play_list_name = playlist
                self._play(i)
                return

    def _play(self, index: int) -> None:
        songs = self.library.playlists.get(self.play_list_name, [])
        if not (0 <= index < len(songs)):
            return
        song = songs[index]
        if not os.path.exists(song["path"]):
            self.toastSignal.emit("Dosya bulunamadı (taşınmış olabilir).")
            return
        self.play_index = index
        self.active_song_id = song["id"]
        song["play_count"] = song.get("play_count", 0) + 1
        self._last_dur = -1.0
        self._loop_a = self._loop_b = None  # yeni parça -> A-B döngü sıfırla
        self.loopSignal.emit(-1.0, -1.0)
        self._cur_gain = float(song.get("lgain", 1.0))  # ses eşitleme (varsa önbellek)
        self._apply_norm_gain()
        self.engine.load(song["path"], autoplay=True)
        # yeni parça: karaoke/stem modunu sıfırla (orijinal yüklendi)
        if self._sep_thread and self._sep_thread.isRunning():
            self._sep_thread.cancel()
        if self._karaoke_mode != "off":
            self._karaoke_mode = "off"
            self._sep_target = "off"
            self.engine.set_effect("karaoke", 0)
            self.karaokeModeSignal.emit("off")
        self._maybe_fetch_cover(song)
        if not song.get("lyrics"):
            self._start_lyrics(song)  # Lyrica'dan otomatik (zaman kodlu) söz
        self._record_recent(self.play_list_name, song["id"])
        self.trackChanged.emit(self._track_json())
        self._cover_dirty = True

    def _record_recent(self, playlist: str, sid: str) -> None:
        rec = self.library.settings.setdefault("recent", [])
        rec[:] = [r for r in rec if r.get("id") != sid]
        rec.insert(0, {"playlist": playlist, "id": sid})
        del rec[24:]

    @pyqtSlot()
    def toggle(self) -> None:
        if not self.engine.is_loaded():
            songs = self.library.playlists.get(self.library.current, [])
            if songs:
                self.play_list_name = self.library.current
                self._play(0)
            return
        self.engine.toggle()

    @pyqtSlot()
    def playPause(self) -> None:
        self.toggle()

    @pyqtSlot()
    def next(self) -> None:
        songs = self.library.playlists.get(self.play_list_name, [])
        if not songs:
            return
        if self.shuffle and len(songs) > 1:
            import random
            idx = self.play_index
            while idx == self.play_index:
                idx = random.randint(0, len(songs) - 1)
            self._play(idx)
        else:
            self._play((self.play_index + 1) % len(songs))

    @pyqtSlot()
    def prev(self) -> None:
        songs = self.library.playlists.get(self.play_list_name, [])
        if not songs:
            return
        if self.play_index < 0:
            self._play(0)
            return
        if self.engine.position() > 3.0:
            self.engine.seek(0)
            return
        if self.shuffle and len(songs) > 1:
            import random
            self._play(random.randint(0, len(songs) - 1))
        else:
            self._play((self.play_index - 1) % len(songs))

    def _on_media_ended(self) -> None:
        if self.repeat_mode == 2:
            self.engine.seek(0)
            self.engine.play()
        elif self.user_queue:
            item = self.user_queue.pop(0)
            self.queueChanged.emit(self.getQueue())
            self.play(item["id"], item["playlist"])
        elif self.repeat_mode == 0:
            songs = self.library.playlists.get(self.play_list_name, [])
            if self.play_index < len(songs) - 1:
                self.next()  # kapalı: son parçada durur
        else:
            self.next()

    @pyqtSlot(int)
    def setRepeatMode(self, mode: int) -> None:
        self.repeat_mode = mode % 3
        self.repeat_one = (self.repeat_mode == 2)

    @pyqtSlot(str, str)
    def openFileLocation(self, sid: str, playlist: str) -> None:
        song = self.library.find_song(playlist, sid)
        if not song or not os.path.exists(song.get("path", "")):
            self.toastSignal.emit("Dosya bulunamadı.")
            return
        try:
            subprocess.Popen(["explorer", "/select,", os.path.normpath(song["path"])],
                             creationflags=_NO_WINDOW)
        except Exception:
            pass

    # ---- kuyruk (Sıradaki) ----
    @pyqtSlot(str, str)
    def addToQueue(self, sid: str, playlist: str) -> None:
        self.user_queue.append({"playlist": playlist, "id": sid})
        self.queueChanged.emit(self.getQueue())
        self.toastSignal.emit("Sıraya eklendi.")

    @pyqtSlot(str, str)
    def playNext(self, sid: str, playlist: str) -> None:
        self.user_queue.insert(0, {"playlist": playlist, "id": sid})
        self.queueChanged.emit(self.getQueue())
        self.toastSignal.emit("Sıradaki olarak eklendi.")

    @pyqtSlot(result=str)
    def getQueue(self) -> str:  # noqa: N802
        out = []
        for item in self.user_queue:
            s = self.library.find_song(item["playlist"], item["id"])
            if s:
                v = self._song_view(s)
                v["playlist"] = item["playlist"]
                out.append(v)
        return json.dumps(out)

    @pyqtSlot()
    def clearQueue(self) -> None:
        self.user_queue = []
        self.queueChanged.emit("[]")

    @pyqtSlot(int)
    def removeFromQueue(self, index: int) -> None:
        if 0 <= index < len(self.user_queue):
            self.user_queue.pop(index)
            self.queueChanged.emit(self.getQueue())

    @pyqtSlot(int)
    def playQueueIndex(self, index: int) -> None:
        if 0 <= index < len(self.user_queue):
            item = self.user_queue.pop(index)
            self.queueChanged.emit(self.getQueue())
            self.play(item["id"], item["playlist"])

    @pyqtSlot(str, str)
    def playPlaylistShuffled(self, playlist: str, _unused: str = "") -> None:
        import random
        songs = self.library.playlists.get(playlist, [])
        if not songs:
            return
        self.shuffle = True
        self.play_list_name = playlist
        self._play(random.randint(0, len(songs) - 1))

    # ---- ÇAĞ AÇICI: analiz, A-B döngü, ses manzarası ----
    def _on_analysis(self, payload: str) -> None:
        try:
            d = json.loads(payload)
        except json.JSONDecodeError:
            self.analysisSignal.emit(payload)
            return
        sid = d.get("id")
        for songs in self.library.playlists.values():
            for s in songs:
                if s.get("id") == sid:
                    s["mood"] = d.get("mood", "")
                    s["bpm"] = d.get("bpm", 0)
                    s["lgain"] = d.get("gain", 1.0)
        self._cur_gain = d.get("gain", 1.0)
        self._apply_norm_gain()
        self._cover_dirty = True
        self.analysisSignal.emit(payload)

    def _apply_norm_gain(self) -> None:
        g = self._cur_gain if self.normalize else 1.0
        self.engine.set_volume(self._base_volume * g)

    @pyqtSlot(bool)
    def setNormalize(self, on: bool) -> None:
        self.normalize = on
        self.library.settings["normalize"] = on
        self._apply_norm_gain()
        self.toastSignal.emit("Ses eşitleme açık" if on else "Ses eşitleme kapalı")

    @pyqtSlot()
    def setLoopA(self) -> None:
        self._loop_a = self.engine.position()
        self._apply_loop()

    @pyqtSlot()
    def setLoopB(self) -> None:
        self._loop_b = self.engine.position()
        self._apply_loop()

    @pyqtSlot()
    def clearLoop(self) -> None:
        self._loop_a = self._loop_b = None
        self.engine.clear_loop()
        self.loopSignal.emit(-1.0, -1.0)

    def _apply_loop(self) -> None:
        if self._loop_a is not None and self._loop_b is not None and self._loop_b > self._loop_a:
            self.engine.set_loop(self._loop_a, self._loop_b)
            self.loopSignal.emit(self._loop_a, self._loop_b)
        elif self._loop_a is not None:
            self.loopSignal.emit(self._loop_a, -1.0)

    @pyqtSlot(str, float)
    def setSoundscape(self, kind: str, level: float) -> None:
        self.engine.set_soundscape(kind, level)
        self.library.settings["soundscape"] = [kind, level]

    # ---- RADİKAL: radyo, kırpma, sıralama, kopya, m3u, liste kapağı ----
    @pyqtSlot(str, str)
    def startRadio(self, sid: str, playlist: str) -> None:
        import random
        base = self.library.find_song(playlist, sid)
        base_mood = (base or {}).get("mood", "")
        pool = [(pl, s) for pl, songs in self.library.playlists.items()
                for s in songs if s.get("id") != sid]
        random.shuffle(pool)
        pool.sort(key=lambda ps: 0 if (base_mood and ps[1].get("mood") == base_mood) else 1)
        n = 0
        for pl, s in pool[:20]:
            self.user_queue.append({"playlist": pl, "id": s["id"]})
            n += 1
        self.queueChanged.emit(self.getQueue())
        self.toastSignal.emit(f"📻 Radyo: {n} benzer parça kuyruğa eklendi.")

    @pyqtSlot(str)
    def addAllToQueue(self, playlist: str) -> None:
        for s in self.library.playlists.get(playlist, []):
            self.user_queue.append({"playlist": playlist, "id": s["id"]})
        self.queueChanged.emit(self.getQueue())
        self.toastSignal.emit("Tüm liste kuyruğa eklendi.")

    @pyqtSlot(str, int, int)
    def reorderSong(self, playlist: str, frm: int, to: int) -> None:
        songs = self.library.playlists.get(playlist, [])
        if 0 <= frm < len(songs) and 0 <= to < len(songs) and frm != to:
            songs.insert(to, songs.pop(frm))
            if playlist == self.play_list_name and self.active_song_id:
                self.play_index = next((i for i, x in enumerate(songs)
                                        if x["id"] == self.active_song_id), self.play_index)
            self.library.save()
            self.stateChanged.emit()

    @pyqtSlot(str, str)
    def setPlaylistCover(self, playlist: str, url: str) -> None:
        self.library.settings.setdefault("playlist_covers", {})[playlist] = url
        self.library.save()
        self.stateChanged.emit()

    @pyqtSlot(str, str)
    def setPlaylistDescription(self, playlist: str, text: str) -> None:
        self.library.settings.setdefault("playlist_desc", {})[playlist] = text
        self.library.save()
        self.stateChanged.emit()

    @pyqtSlot(str)
    def removeDuplicates(self, playlist: str) -> None:
        songs = self.library.playlists.get(playlist, [])
        seen, out = set(), []
        for s in songs:
            key = os.path.normcase(os.path.normpath(s.get("path", "")))
            if key in seen:
                continue
            seen.add(key)
            out.append(s)
        removed = len(songs) - len(out)
        self.library.playlists[playlist] = out
        self.library.save()
        self.stateChanged.emit()
        self.toastSignal.emit(f"{removed} tekrar kaldırıldı." if removed else "Tekrar bulunamadı.")

    @pyqtSlot(str)
    def exportM3U(self, playlist: str) -> None:
        songs = self.library.playlists.get(playlist, [])
        if not songs:
            return
        path, _ = QFileDialog.getSaveFileName(self.window, "M3U dışa aktar",
                                              str(config.MUSIC_DIR / (playlist + ".m3u")), "M3U (*.m3u)")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("#EXTM3U\n")
                for s in songs:
                    f.write(f"#EXTINF:-1,{s.get('artist','')} - {s.get('title','')}\n{s.get('path','')}\n")
            self.toastSignal.emit("M3U kaydedildi.")
        except OSError as exc:
            self.toastSignal.emit(f"Hata: {exc}")

    @pyqtSlot(str, str, float, float)
    def exportTrim(self, sid: str, playlist: str, a: float, b: float) -> None:
        song = self.library.find_song(playlist, sid)
        if not song or not os.path.exists(song.get("path", "")) or b <= a:
            self.toastSignal.emit("Kırpma için geçerli A-B noktaları ve dosya gerekli.")
            return
        out, _ = QFileDialog.getSaveFileName(self.window, "Kırpılan parçayı kaydet",
                                             str(config.DOWNLOADS_DIR / (song["title"] + "_kirpik.mp3")), "MP3 (*.mp3)")
        if not out:
            return
        try:
            subprocess.run([config.FFMPEG, "-y", "-ss", str(a), "-to", str(b), "-i", song["path"],
                            "-c:a", "libmp3lame", "-q:a", "2", out],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=_NO_WINDOW, timeout=90)
            self.toastSignal.emit("✂️ Kırpılan parça kaydedildi.")
        except Exception as exc:
            self.toastSignal.emit(f"Kırpma hatası: {exc}")

    @pyqtSlot(float)
    def seek(self, seconds: float) -> None:
        self.engine.seek(seconds)

    @pyqtSlot(bool)
    def setShuffle(self, on: bool) -> None:
        self.shuffle = on

    @pyqtSlot(bool)
    def setRepeat(self, on: bool) -> None:
        self.repeat_one = on

    @pyqtSlot(float)
    def setVolume(self, v: float) -> None:
        self._base_volume = v
        if v > 0:
            self.library.settings["volume"] = v
        self._apply_norm_gain()

    @pyqtSlot(float)
    def setSpeed(self, r: float) -> None:
        self.engine.set_speed(r)
        self.library.settings["speed"] = r

    # ================= EQ / efekt =================
    @pyqtSlot(str)
    def setEq(self, gains_json: str) -> None:
        gains = json.loads(gains_json)
        self.engine.set_eq([float(g) for g in gains])
        self.library.settings["eq_gains"] = gains

    @pyqtSlot(str)
    def setEqPreset(self, name: str) -> None:
        self.library.settings["eq_preset"] = name

    @pyqtSlot(bool)
    def setEqEnabled(self, on: bool) -> None:
        self.engine.set_eq_enabled(on)
        self.library.settings["eq_enabled"] = on

    @pyqtSlot(result=str)
    def autoEq(self) -> str:  # noqa: N802
        audio = self.engine.audio
        if audio is None:
            self.toastSignal.emit("Önce bir şarkı çalın (Oto EQ için).")
            return json.dumps([])
        gains = engine_mod.auto_eq_gains(audio)
        self.engine.set_eq(gains)
        self.library.settings["eq_gains"] = gains
        self.library.settings["eq_preset"] = "🤖 Oto"
        self.toastSignal.emit("🤖 Oto EQ uygulandı.")
        return json.dumps(gains)

    @pyqtSlot(str, float)
    def setEffect(self, name: str, val: float) -> None:
        self.engine.set_effect(name, val)
        self.library.settings.setdefault("effects", {})[name] = val

    # ================= karaoke / vokal ayırma (htdemucs) =================
    @pyqtSlot(str)
    def setKaraoke(self, mode: str) -> None:
        """Karaoke/akapella modu:
          off          — normal (stem yok, mid-side kapalı)
          quick        — anında mid-side vokal azaltma (motor gerektirmez)
          instrumental — htdemucs ile vokalsiz karışım (stüdyo karaoke)
          vocals       — htdemucs ile sadece vokal (akapella)
        htdemucs CPU'da yavaştır (birkaç dk); stem'ler önbelleğe alınır → sonra anında."""
        song = (self.library.find_song(self.play_list_name, self.active_song_id)
                if self.active_song_id else None)
        # stem modunda mid-side'ı üst üste bindirme
        if mode != "quick":
            self.engine.set_effect("karaoke", 0)

        if mode in ("off", "quick"):
            self._karaoke_mode = mode
            self._sep_target = "off"
            if song and self.engine.current_path != song["path"]:
                self.engine.swap_source(song["path"])   # stem'den orijinale dön
            if mode == "quick":
                self.engine.set_effect("karaoke", 85)
                self.toastSignal.emit("⚡ Hızlı karaoke açık (mid-side)")
            self.karaokeModeSignal.emit(mode)
            return

        # instrumental / vocals -> htdemucs
        if not song:
            self.toastSignal.emit("Önce bir şarkı çal.")
            return
        if not separation.demucs_available():
            self.engine.set_effect("karaoke", 85)   # motor yoksa hızlıya düş
            self._karaoke_mode = "quick"
            self.karaokeModeSignal.emit("quick")
            self.toastSignal.emit("Stüdyo karaoke motoru yok — hızlı karaoke açıldı.")
            return

        self._sep_song_id = self.active_song_id
        self._sep_target = mode
        cached = separation.cached_stems(song["path"])
        if cached:
            self._apply_stem(cached["no_vocals"] if mode == "instrumental" else cached["vocals"], mode)
            return
        self.toastSignal.emit("🎤 Vokaller ayrılıyor… (CPU, birkaç dk sürebilir)")
        self.separationProgressSignal.emit(1.0, "Başlıyor…")
        if self._sep_thread and self._sep_thread.isRunning():
            self._sep_thread.cancel()
        t = separation.SeparationThread(song["path"], self)
        t.progress.connect(self.separationProgressSignal)
        t.done.connect(self._on_separation_done)
        t.failed.connect(self._on_separation_failed)
        self._sep_thread = t
        t.start()

    def _apply_stem(self, stem_path: str, mode: str) -> None:
        self.engine.swap_source(stem_path)
        self._karaoke_mode = mode
        self.karaokeModeSignal.emit(mode)
        self.toastSignal.emit("🎙 Akapella — sadece vokal" if mode == "vocals"
                              else "🎤 Karaoke — enstrümantal (vokal ayrıldı)")

    def _on_separation_done(self, no_vocals: str, vocals: str) -> None:
        self.separationProgressSignal.emit(100.0, "Hazır")
        if self.active_song_id != self._sep_song_id:
            self.toastSignal.emit("🎤 Vokal ayırma hazır (parça değişmiş).")
            return
        mode = self._sep_target
        if mode in ("instrumental", "vocals"):
            self._apply_stem(no_vocals if mode == "instrumental" else vocals, mode)

    def _on_separation_failed(self, msg: str) -> None:
        self.separationProgressSignal.emit(100.0, "")
        self.toastSignal.emit(msg)
        self._karaoke_mode = "off"
        self.karaokeModeSignal.emit("off")

    # ================= çalma listeleri =================
    @pyqtSlot(str)
    def selectPlaylist(self, name: str) -> None:
        if name in self.library.playlists:
            self.library.current = name

    @pyqtSlot(str)
    def addPlaylist(self, name: str) -> None:
        if self.library.add_playlist(name):
            self.library.current = name
            self.library.save()
            self.stateChanged.emit()
            self.toastSignal.emit(f"“{name}” listesi oluşturuldu.")
        else:
            self.toastSignal.emit("Bu isimde bir liste zaten var.")

    @pyqtSlot(str)
    def deletePlaylist(self, name: str) -> None:
        if self.library.remove_playlist(name):
            if name == self.play_list_name:
                self.engine.clear()
                self.active_song_id = None
                self.play_index = -1
                self.play_list_name = self.library.current
                self.trackChanged.emit(self._track_json())
            self.library.save()
            self.stateChanged.emit()
            self.toastSignal.emit("Liste silindi.")

    @pyqtSlot(str, str)
    def renamePlaylist(self, old: str, new: str) -> None:
        new = new.strip()
        if not new or new == old or new in self.library.playlists or old in config.PROTECTED_PLAYLISTS:
            return
        self.library.playlists = {(new if k == old else k): v
                                  for k, v in self.library.playlists.items()}
        if self.library.current == old:
            self.library.current = new
        if self.play_list_name == old:
            self.play_list_name = new
        self.library.save()
        self.stateChanged.emit()

    # ================= şarkı işlemleri =================
    @pyqtSlot(str, str)
    def toggleFavorite(self, song_id: str, playlist: str) -> None:
        song = self.library.find_song(playlist, song_id)
        if not song:
            return
        new_val = not song.get("favorite", False)
        self.library.set_favorite(song, new_val)
        if not new_val and self.play_list_name == config.FAVORITES_PLAYLIST and song_id == self.active_song_id:
            self.engine.clear()
            self.active_song_id = None
            self.play_index = -1
            self.trackChanged.emit(self._track_json())
        self.library.save()
        self.stateChanged.emit()

    @pyqtSlot(str, str)
    def removeSong(self, song_id: str, playlist: str) -> None:
        songs = self.library.playlists.get(playlist, [])
        idx = next((i for i, s in enumerate(songs) if s["id"] == song_id), -1)
        if idx < 0:
            return
        songs.pop(idx)
        if song_id == self.active_song_id and playlist == self.play_list_name:
            self.engine.clear()
            self.active_song_id = None
            self.play_index = -1
            self.trackChanged.emit(self._track_json())
        elif playlist == self.play_list_name and idx < self.play_index:
            self.play_index -= 1
        self.library.save()
        self.stateChanged.emit()

    @pyqtSlot(str, str, str)
    def copyToPlaylist(self, song_id: str, playlist: str, target: str) -> None:
        song = self.library.find_song(playlist, song_id)
        if not song:
            return
        if self.library.add_song(dict(song), target):
            self.library.save()
            self.stateChanged.emit()
            self.toastSignal.emit(f"“{target}” listesine eklendi.")
        else:
            self.toastSignal.emit("Bu parça hedef listede zaten var.")

    @pyqtSlot(str, str, str, str)
    def editMetadata(self, song_id: str, playlist: str, title: str, artist: str) -> None:
        song = self.library.find_song(playlist, song_id)
        if not song:
            return
        song["title"] = title.strip() or song["title"]
        song["artist"] = artist.strip()
        self.library.save()
        self.stateChanged.emit()
        if song_id == self.active_song_id:
            self.trackChanged.emit(self._track_json())

    # ---- Klip modu: video AKIŞI (indirme yok) ----
    @pyqtSlot(str, str)
    def playVideo(self, sid: str, playlist: str) -> None:
        song = self.library.find_song(playlist, sid)
        if not song:
            return
        query = song.get("video_url") or naming.search_query(
            song.get("artist", ""), song.get("title", ""))
        if not query:
            self.toastSignal.emit("Klip için şarkı adı gerekli.")
            return
        self.toastSignal.emit("🎬 Klip görüntüsü hazırlanıyor…")
        # YENİ MİMARİ: ses DSP motorundan (mp3) gelir; video SESSİZ ve motora
        # senkron oynar. Böylece tek ses kaynağı + tüm DSP efektleri klibe de uygulanır
        # (çift playback yok). Motoru DURDURMA; gerekiyorsa çaldır.
        if sid == self.active_song_id and not self.engine.is_playing():
            self.engine.play()
        self._video_handoff = self.engine.position()   # videonun başlangıç saniyesi
        t = VideoStreamThread(sid, query, self)
        t.ready.connect(self._on_video_ready)
        t.failed.connect(self._on_video_failed)
        t.finished.connect(lambda x=t: self._video_threads.remove(x) if x in self._video_threads else None)
        self._video_threads.append(t)
        t.start()

    def _on_video_ready(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except ValueError:
            return
        data["start"] = round(self._video_handoff, 2)
        data["muted"] = True   # ses motordan gelir; video her zaman sessiz
        self.videoReadySignal.emit(json.dumps(data))

    def _on_video_failed(self, msg: str) -> None:
        self.toastSignal.emit(msg)   # motor zaten çalıyor, ekstra işlem yok

    @pyqtSlot(float)
    def resumeMusic(self, pos: float = -1.0) -> None:
        """Klip kapatılınca çağrılır. Motor hiç durmadı — sadece çaldığından emin ol."""
        self._video_handoff = 0.0
        if not self.engine.is_playing():
            self.engine.play()

    # ---- Otomatik güncelleme (GitHub Releases → .msi) ----
    def _start_update_check(self) -> None:
        if self._closing:
            return
        t = updater.UpdateCheckThread(config.APP_VERSION, updater.is_frozen(), self)
        t.available.connect(self._on_update_available)
        t.progress.connect(self.updateProgressSignal)
        t.ready.connect(self._on_update_ready)
        t.error.connect(lambda m: None)      # ağ yok/rate-limit → sessiz
        t.noUpdate.connect(lambda: None)
        self._update_thread = t
        t.start()

    def _on_update_available(self, version: str, notes: str) -> None:
        self.updateAvailableSignal.emit(version, notes)
        if not updater.is_frozen():
            self.toastSignal.emit(f"🔔 Yeni sürüm mevcut: v{version} (geliştirme modunda indirilmez).")

    def _on_update_ready(self, msi_path: str, version: str) -> None:
        self._staged_update = msi_path
        self._staged_version = version
        self.updateReadySignal.emit(version)
        self.toastSignal.emit(f"🎉 Güncelleme indirildi (v{version}) — çıkışta otomatik kurulacak.")

    def _perform_update(self) -> bool:
        """Ayrık kurucuyu başlatır. Donmuşta çalışan exe = MSI'nin güncellediği yol."""
        if not self._staged_update:
            return False
        exe = sys.executable
        ok = updater.install_and_relaunch(self._staged_update, exe)
        if ok:
            self._staged_update = None
        return ok

    @pyqtSlot()
    def installUpdateNow(self) -> None:
        """Kullanıcı 'şimdi yeniden başlat' derse: hemen kur + yeniden aç."""
        if self._staged_update and self._perform_update():
            QApplication.quit()

    # ---- Lyrica: otomatik (zaman kodlu) şarkı sözü ----
    @pyqtSlot(str, str)
    def fetchLyrics(self, sid: str, playlist: str) -> None:
        song = self.library.find_song(playlist, sid)
        if not song:
            return
        self.toastSignal.emit("🎵 Sözler aranıyor…")
        self._start_lyrics(song, manual=True)

    def _start_lyrics(self, song: dict, manual: bool = False) -> None:
        t = LyricsThread(song["id"], song.get("artist", ""), song.get("title", ""), self)
        t.ready.connect(self._on_lyrics)
        if manual:
            t.failed.connect(self.toastSignal)
        t.finished.connect(lambda x=t: self._lyric_threads.remove(x) if x in self._lyric_threads else None)
        self._lyric_threads.append(t)
        t.start()

    def _on_lyrics(self, sid: str, lyrics: str, source: str) -> None:
        found = False
        for songs in self.library.playlists.values():
            for s in songs:
                if s.get("id") == sid:
                    s["lyrics"] = lyrics
                    found = True
        if not found:
            return
        self.library.save()
        if sid == self.active_song_id:
            self.trackChanged.emit(self._track_json())
        self.toastSignal.emit(f"🎵 Sözler bulundu ({source})")

    @pyqtSlot(str, str, str)
    def saveLyrics(self, song_id: str, playlist: str, text: str) -> None:
        song = self.library.find_song(playlist, song_id)
        if not song:
            return
        song["lyrics"] = text
        self.library.save()
        if song_id == self.active_song_id:
            self.trackChanged.emit(self._track_json())
        self.toastSignal.emit("Sözler kaydedildi.")

    # ================= içe aktarma / tarama / senkron =================
    @pyqtSlot()
    def importFiles(self) -> None:
        exts = " ".join(f"*{e}" for e in config.AUDIO_EXTENSIONS)
        files, _ = QFileDialog.getOpenFileNames(
            self.window, "Müzik dosyalarını seç", str(config.MUSIC_DIR),
            f"Ses Dosyaları ({exts});;Tüm Dosyalar (*.*)")
        self.import_paths(files)

    def import_paths(self, files: list[str]) -> None:
        added = 0
        for path in files:
            if path.lower().endswith(config.AUDIO_EXTENSIONS):
                song = make_song(path)
                if self.library.add_song(song, self.library.current):
                    added += 1
                    self._maybe_fetch_cover(song)
        if added:
            self.library.save()
            self.stateChanged.emit()
            self.toastSignal.emit(f"{added} şarkı eklendi.")
        else:
            self.toastSignal.emit("Uygun/yeni dosya bulunamadı.")

    @pyqtSlot()
    def scanMusic(self) -> None:
        if self.scan_thread and self.scan_thread.isRunning():
            return
        self.toastSignal.emit("Müzik klasörü taranıyor…")
        self.scan_thread = ScanThread(self)
        self.scan_thread.done.connect(self._on_scan_done)
        self.scan_thread.start()

    def _on_scan_done(self, collected: list) -> None:
        added, new_pl = self.library.merge_scanned(collected)
        if added or new_pl:
            self.library.save()
            self.stateChanged.emit()
            self.requestSidebarCovers()  # taranan listelerin kapaklarını çekmeye başla
        self.scanDoneSignal.emit(added, new_pl)
        self.toastSignal.emit(f"Tarama bitti: {added} şarkı, {new_pl} liste."
                              if (added or new_pl) else "Yeni şarkı bulunamadı.")

    @pyqtSlot(str)
    def syncNamesCovers(self, playlist: str) -> None:
        songs = self.library.playlists.get(playlist, [])
        if not songs:
            self.toastSignal.emit("Bu listede şarkı yok.")
            return
        for song in songs:
            stem = os.path.splitext(os.path.basename(song["path"]))[0]
            artist, title = naming.from_filename(stem)
            if title:
                song["title"] = title
            if artist:
                song["artist"] = artist
            self._force_cover_refetch(song)
        self.library.save()
        self.stateChanged.emit()
        if self.active_song_id:
            self.trackChanged.emit(self._track_json())
        self.toastSignal.emit(f"{len(songs)} parça senkronize ediliyor; kapaklar geliyor…")

    # ================= kapaklar =================
    @pyqtSlot(str)
    def requestCovers(self, playlist: str) -> None:
        """Bir liste açıldığında kapakları ve süreleri arka planda çeker."""
        songs = self.library.playlists.get(playlist, [])
        for s in songs:
            self._maybe_fetch_cover(s)
        self._probe_durations(songs)

    def _probe_durations(self, songs: list) -> None:
        items = [(s["id"], s["path"]) for s in songs
                 if not s.get("duration_ms") and s["id"] not in self._probed_ids
                 and os.path.exists(s.get("path", ""))]
        if not items:
            return
        for sid, _ in items:
            self._probed_ids.add(sid)
        pr = DurationProber(items[:300], self)
        pr.probed.connect(self._on_duration_probed)
        pr.finished.connect(lambda p=pr: self._probers.remove(p) if p in self._probers else None)
        self._probers.append(pr)
        pr.start()

    def _on_duration_probed(self, sid: str, ms: int) -> None:
        for songs in self.library.playlists.values():
            for s in songs:
                if s.get("id") == sid:
                    s["duration_ms"] = ms
        self.durationSignal.emit(sid, ms)
        self._cover_dirty = True

    @pyqtSlot()
    def requestSidebarCovers(self) -> None:
        """Kenar çubuğu/ana sayfa küçük resimleri için her listenin ilk
        (kapaksız) birkaç şarkısının kapağını çeker."""
        for songs in self.library.playlists.values():
            for s in songs[:3]:
                self._maybe_fetch_cover(s)

    def _maybe_fetch_cover(self, song: dict) -> None:
        thumb = song.get("thumbnail")
        if thumb and os.path.exists(thumb):
            return
        if song["id"] in self.cover_requested:
            return
        self.cover_requested.add(song["id"])
        query = naming.search_query(song.get("artist", ""), song.get("title", ""))
        self.cover_fetcher.enqueue(song["id"], query or song.get("title", ""),
                                   song.get("thumbnail_url") or None)

    def _force_cover_refetch(self, song: dict) -> None:
        try:
            cache = config.COVERS_DIR / (hashlib.md5(song["id"].encode("utf-8")).hexdigest() + ".jpg")
            if cache.exists():
                cache.unlink()
        except Exception:
            pass
        song["thumbnail"] = ""
        self.cover_requested.discard(song["id"])
        self._maybe_fetch_cover(song)

    def _on_cover(self, song_id: str, path: str) -> None:
        for songs in self.library.playlists.values():
            for s in songs:
                if s.get("id") == song_id:
                    s["thumbnail"] = path
        self.coverReadySignal.emit(song_id, self._cover_url(song_id))
        self._cover_dirty = True

    # ================= YouTube ara / indir =================
    @pyqtSlot(str)
    def searchYouTube(self, query: str) -> None:
        query = query.strip()
        if not query:
            return
        self._search = SearchThread(query, 20, self)
        self._search.results.connect(lambda rows: self.searchResultsSignal.emit(json.dumps(rows)))
        self._search.failed.connect(lambda m: self.searchResultsSignal.emit(json.dumps({"error": m})))
        self._search.start()

    @pyqtSlot(str)
    def importPlaylist(self, url: str) -> None:
        """YouTube playlist URL'sini aç: tüm parçaları arama sonucu satırları gibi
        listeler → renderSearchRows checkbox'larıyla önizle-ve-seç, toplu indir."""
        url = url.strip()
        if not url:
            return
        self.toastSignal.emit("📃 Playlist yükleniyor…")
        self._search = SearchThread("", 20, self, playlist_url=url)
        self._search.results.connect(self._on_playlist_rows)
        self._search.failed.connect(lambda m: self.searchResultsSignal.emit(json.dumps({"error": m})))
        self._search.start()

    def _on_playlist_rows(self, rows: list) -> None:
        self.searchResultsSignal.emit(json.dumps(rows))
        if rows:
            self.toastSignal.emit(f"📃 Playlist: {len(rows)} parça — seç ve indir.")
        else:
            self.toastSignal.emit("Playlist boş veya çözülemedi.")

    def _dl_counter(self) -> str:
        if self.download_total > 1:
            done = self.download_total - len(self.download_queue)
            return f"{done}/{self.download_total}"
        return ""

    @pyqtSlot(str)
    def downloadUrls(self, urls_json: str) -> None:
        try:
            urls = json.loads(urls_json)
        except json.JSONDecodeError:
            return
        if isinstance(urls, str):
            urls = [urls]
        if not urls:
            return
        self.download_queue.extend(urls)
        self.download_total += len(urls)      # toplu sayaç birikir
        self._maybe_start_download()

    def _maybe_start_download(self) -> None:
        if self._closing or (self.active_download and self.active_download.isRunning()):
            return
        if not self.download_queue:
            self.download_total = 0            # kuyruk bitti: sayacı sıfırla
            self.downloadProgressSignal.emit(0, "", 0)
            return
        url = self.download_queue.pop(0)
        c = self._dl_counter()
        self.downloadProgressSignal.emit(0, f"İndiriliyor… {c}".strip(), len(self.download_queue))
        t = DownloadThread(url, self)
        t.progress.connect(lambda pct, s: self.downloadProgressSignal.emit(
            pct, f"{s} {self._dl_counter()}".strip(), len(self.download_queue)))
        t.finished_ok.connect(self._on_download_done)
        t.failed.connect(lambda m: self.toastSignal.emit(m))
        t.finished.connect(self._download_finished)
        self.active_download = t
        t.start()

    def _download_finished(self) -> None:
        self.active_download = None
        self._maybe_start_download()

    def _on_download_done(self, song: dict) -> None:
        # İndirilenler her zaman belli bir (korumalı) listeye gider
        target = config.DOWNLOADS_PLAYLIST
        if target not in self.library.playlists:
            self.library.playlists[target] = []
        if self.library.add_song(song, target):
            self._maybe_fetch_cover(song)
            self.library.save()
            self.stateChanged.emit()
            self.downloadDoneSignal.emit(json.dumps(self._song_view(song)))
            self.toastSignal.emit(f"İndirildi: {song['title']}  →  İndirilenler")
        else:
            self.toastSignal.emit("Bu parça zaten indirilmiş.")

    # ================= tema / yedek =================
    @pyqtSlot(str)
    def setTheme(self, name: str) -> None:
        self.library.settings["theme"] = name
        self.library.settings.pop("accent", None)  # tema seçilince özel renk sıfırlanır
        self.library.save()

    @pyqtSlot(str)
    def setAccent(self, hex_color: str) -> None:
        self.library.settings["accent"] = hex_color
        self.library.save()

    @pyqtSlot(str)
    def setLanguage(self, code: str) -> None:
        self.library.settings["lang"] = "en" if code == "en" else "tr"
        self.library.save()

    @pyqtSlot()
    def backup(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self.window, "Yedeği kaydet", str(config.BASE_DIR / "just_music_yedek.json"), "JSON (*.json)")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(self.library.to_json())
            self.toastSignal.emit("Yedek kaydedildi.")
        except OSError as exc:
            self.toastSignal.emit(f"Yedek başarısız: {exc}")

    # ================= yoklama =================
    def _on_poll(self) -> None:
        eng = self.engine
        playing = eng.is_playing()
        if playing != self._last_playing:
            self._last_playing = playing
            self.playingChanged.emit(playing)
        self.spectrumSignal.emit(json.dumps([round(float(x), 3) for x in eng.spectrum()]))
        if eng.is_loaded():
            pos, dur = eng.position(), eng.duration()
            self.positionChanged.emit(pos, dur)
            if dur > 0 and self.active_song_id:
                song = self.library.find_song(self.play_list_name, self.active_song_id)
                if song and not song.get("duration_ms"):
                    song["duration_ms"] = int(dur * 1000)
            # Şarkı DNA'sı + ruh hali: yeni parça çözümlenince bir kez
            if self.active_song_id and self.active_song_id != self._analyzed_id and eng.audio is not None:
                song = self.library.find_song(self.play_list_name, self.active_song_id)
                if song and eng.current_path == song["path"]:
                    self._analyzed_id = self.active_song_id
                    at = AnalyzeThread(eng.audio, self.active_song_id, self)
                    at.ready.connect(self._on_analysis)
                    at.finished.connect(lambda a=at: self._analyzers.remove(a) if a in self._analyzers else None)
                    self._analyzers.append(at)
                    at.start()
        if eng.consume_end():
            self._on_media_ended()
        if eng.load_error:
            self.toastSignal.emit(eng.load_error)
            eng.load_error = ""
        if playing:
            self._listen_accum += POLL_MS / 1000.0
            if self._listen_accum >= 1.0:
                add = int(self._listen_accum)
                self._listen_accum -= add
                self.library.stats["total_seconds"] = self.library.stats.get("total_seconds", 0) + add
        self._tick += 1
        if self._tick % 250 == 0 or (self._cover_dirty and self._tick % 50 == 0):
            self.library.save()
            self._cover_dirty = False

    # ================= kapanış =================
    def shutdown(self) -> None:
        self._closing = True
        self.download_queue.clear()
        self.poll.stop()
        try:
            self.engine.close()
        except Exception:
            pass
        self.library.save()
        try:
            self.cover_fetcher.stop()
            if not self.cover_fetcher.wait(6000):
                self.cover_fetcher.wait()
        except Exception:
            pass
        if self._search and self._search.isRunning():
            self._search.stop()
            self._search.wait(2000)
        if self.scan_thread and self.scan_thread.isRunning():
            self.scan_thread.wait(3000)
        for pr in list(self._probers):
            try:
                pr.stop()
                pr.wait(2500)
            except Exception:
                pass
        for a in list(self._analyzers):
            try:
                a.wait(2500)
            except Exception:
                pass
        for lt in list(self._lyric_threads):
            try:
                lt.wait(3000)
            except Exception:
                pass
        if self._sep_thread and self._sep_thread.isRunning():
            try:
                self._sep_thread.cancel()
                self._sep_thread.wait(8000)
            except Exception:
                pass
        for vt in list(self._video_threads):
            try:
                vt.wait(3000)
            except Exception:
                pass
        if self.active_download and self.active_download.isRunning():
            self.active_download.cancel()
            self.active_download.wait(5000)
        # Güncelleme iş parçacığı hâlâ indiriyorsa kısa bekle, sonra bırak
        if self._update_thread and self._update_thread.isRunning():
            if not self._update_thread.wait(1500):
                self._update_thread.terminate()
                self._update_thread.wait(1000)
        # İndirilmiş güncelleme varsa: ayrık kurucuyu başlat (uygulama şimdi kapanıyor)
        if self._staged_update:
            self._perform_update()
