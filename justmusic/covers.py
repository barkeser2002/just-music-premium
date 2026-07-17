"""Kapak görseli getirici (tek kalıcı arka plan iş parçacığı + kuyruk).

- URL verilirse indirip önbelleğe alır.
- URL yoksa gömülü yt-dlp.exe ile şarkı adını arayıp küçük resim URL'si üretir.
"""

from __future__ import annotations

import hashlib
import queue
import subprocess
import urllib.request

from PyQt6.QtCore import QThread, pyqtSignal

from . import config

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
_NO_WINDOW = 0x08000000


class CoverFetcher(QThread):
    coverReady = pyqtSignal(str, str)   # song_id, local_path
    coverFailed = pyqtSignal(str)       # song_id (yeniden denenebilsin diye)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._q: "queue.Queue" = queue.Queue()
        self._running = True
        self._proc: subprocess.Popen | None = None

    def enqueue(self, song_id: str, title: str, url: str | None = None) -> None:
        self._q.put((song_id, title, url))

    def stop(self) -> None:
        self._running = False
        # devam eden arama alt sürecini öldür (kapanışta takılmayı önler)
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.kill()
            except Exception:
                pass
        self._q.put(None)

    def run(self) -> None:
        while self._running:
            item = self._q.get()
            if item is None or not self._running:
                break
            song_id, title, url = item
            try:
                path = self._fetch(song_id, title, url)
                if path and self._running:
                    self.coverReady.emit(song_id, path)
                elif self._running:
                    self.coverFailed.emit(song_id)  # sonraki denemeye izin ver
            except Exception:
                if self._running:
                    self.coverFailed.emit(song_id)

    def _fetch(self, song_id: str, title: str, url: str | None) -> str | None:
        config.ensure_dirs()
        cache = config.COVERS_DIR / (hashlib.md5(song_id.encode("utf-8")).hexdigest() + ".jpg")
        if cache.exists() and cache.stat().st_size > 512:
            return str(cache)
        if not url:
            url = self._search_thumbnail(title)
        if not url:
            return None
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = resp.read()
        # geçerli görsel mi? (HTML/onay sayfası veya bozuk indirmeyi önbelleğe alma)
        if not data or len(data) < 512 or data[:1] == b"<":
            return None
        cache.write_bytes(data)
        return str(cache)

    def _search_thumbnail(self, title: str) -> str | None:
        """yt-dlp PYTHON kütüphanesiyle hızlı (flat) arama -> küçük resim URL'si."""
        if not title.strip():
            return None
        try:
            import yt_dlp
        except ImportError:
            return None
        opts = {"quiet": True, "no_warnings": True, "skip_download": True,
                "extract_flat": True, "noplaylist": True, "socket_timeout": 10}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(f"ytsearch1:{title}", download=False)
        except Exception:
            return None
        entries = (info or {}).get("entries") or []
        if not entries or not entries[0]:
            return None
        vid = entries[0].get("id")
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None
