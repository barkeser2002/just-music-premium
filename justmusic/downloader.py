"""yt-dlp PYTHON kütüphanesi ile indirici (arka plan iş parçacığı).

Neden kütüphane (exe değil): gerçek ilerleme kancaları, dönüşüm sonrası kesin
dosya yolu (requested_downloads[].filepath) ve anlaşılır hata mesajları.
YouTube nsig/JS çözümü için gömülü deno kullanılır (config PATH'e ekler).
"""

from __future__ import annotations

import os

from PyQt6.QtCore import QThread, pyqtSignal

from . import config, library


class _Cancelled(Exception):
    pass


class DownloadThread(QThread):
    progress = pyqtSignal(float, str)   # yüzde, durum
    finished_ok = pyqtSignal(dict)
    failed = pyqtSignal(str)

    def __init__(self, query: str, parent=None) -> None:
        super().__init__(parent)
        self.query = query.strip()
        self._cancelled = False

    def cancel(self) -> None:
        """İşbirlikçi iptal: ilerleme kancası istisna atarak yt-dlp'yi durdurur."""
        self._cancelled = True

    # yt-dlp ilerleme kancası (worker iş parçacığında çalışır)
    def _hook(self, d: dict) -> None:
        if self._cancelled:
            raise _Cancelled()
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            pct = (done / total * 100.0) if total else 0.0
            self.progress.emit(pct, "İndiriliyor…")
        elif status == "finished":
            self.progress.emit(100.0, "Dönüştürülüyor…")

    def run(self) -> None:
        try:
            import yt_dlp
        except ImportError:
            self.failed.emit("yt-dlp kütüphanesi bulunamadı.")
            return

        config.ensure_dirs()
        is_url = self.query.startswith(("http://", "https://"))
        target = self.query if is_url else f"ytsearch1:{self.query}"
        outtmpl = str(config.DOWNLOADS_DIR / "%(title).80s [%(id)s].%(ext)s")

        opts: dict = {
            "outtmpl": outtmpl,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "ignoreerrors": False,
            "progress_hooks": [self._hook],
            "windowsfilenames": True,
            "retries": 3,
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        }
        ffdir = os.path.dirname(config.FFMPEG)
        if ffdir and os.path.isdir(ffdir):
            opts["ffmpeg_location"] = ffdir

        try:
            self.progress.emit(0.0, "Aranıyor…")
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(target, download=True)
                if info and "entries" in info:
                    entries = [e for e in info["entries"] if e]
                    if not entries:
                        self.failed.emit("Sonuç bulunamadı.")
                        return
                    info = entries[0]
                filepath = self._resolve_path(ydl, info)
        except _Cancelled:
            return
        except Exception as exc:
            if not self._cancelled:
                self.failed.emit(f"İndirme hatası: {exc}")
            return

        if self._cancelled:
            return
        if not filepath or not os.path.exists(filepath):
            self.failed.emit("İndirilen dosya bulunamadı.")
            return
        self.finished_ok.emit(self._build_song(info, filepath))

    def _resolve_path(self, ydl, info: dict) -> str | None:
        """Dönüşüm (mp3) sonrası kesin dosya yolu."""
        reqs = info.get("requested_downloads")
        if reqs and reqs[0].get("filepath"):
            return reqs[0]["filepath"]
        path = ydl.prepare_filename(info)
        if not path.lower().endswith(".mp3"):
            path = os.path.splitext(path)[0] + ".mp3"
        return path

    def _build_song(self, info: dict, filepath: str) -> dict:
        duration = int((info.get("duration") or 0) * 1000)
        song = library.make_song(
            path=filepath,
            title=info.get("title") or os.path.splitext(os.path.basename(filepath))[0],
            artist=info.get("uploader") or info.get("channel") or "",
            source="youtube",
            duration_ms=duration,
        )
        thumb = info.get("thumbnail") or ""
        vid = info.get("id")
        if not thumb and vid:
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        song["thumbnail_url"] = thumb
        # Klip modu tam bu videoyu açsın (arama yapmadan)
        song["video_url"] = info.get("webpage_url") or (
            f"https://www.youtube.com/watch?v={vid}" if vid else "")
        return song
