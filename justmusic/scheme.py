"""app:// özel URL şeması: web varlıklarını ve yerel kapakları servis eder.

Sunucu/port yok — QWebEngine içinde in-process çalışır.
  app://app/index.html   -> justmusic/web/index.html
  app://cover/<hash>.jpg  -> ~/Music/JustMusic/covers/<hash>.jpg
"""

from __future__ import annotations

from PyQt6.QtCore import QBuffer, QByteArray, QIODevice
from PyQt6.QtWebEngineCore import (
    QWebEngineSettings,
    QWebEngineUrlRequestJob,
    QWebEngineUrlSchemeHandler,
)

from . import config


def configure_page(page) -> None:
    """Klip akışı için sayfa ayarları.

    PlaybackRequiresUserGesture=False şart: klip sesi ayrı bir <audio> akışı
    (Opus) ve sessize alınamaz; yt-dlp URL'leri çözerken kullanıcı hareketi
    jetonu çoktan düşer, aksi halde ses sessizce duraklı kalır.
    """
    st = page.settings()
    st.setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False)
    st.setAttribute(QWebEngineSettings.WebAttribute.ScreenCaptureEnabled, False)

_MIME = {
    ".html": b"text/html",
    ".js": b"application/javascript",
    ".css": b"text/css",
    ".json": b"application/json",
    ".jpg": b"image/jpeg",
    ".jpeg": b"image/jpeg",
    ".png": b"image/png",
    ".svg": b"image/svg+xml",
    ".webp": b"image/webp",
    ".woff2": b"font/woff2",
    ".woff": b"font/woff",
    ".ttf": b"font/ttf",
    ".ico": b"image/x-icon",
}


class AppSchemeHandler(QWebEngineUrlSchemeHandler):
    def requestStarted(self, job: QWebEngineUrlRequestJob) -> None:  # noqa: N802
        url = job.requestUrl()
        path = url.path().lstrip("/")

        # Kapaklar da aynı origin (app://app) altında -> canvas ile renk çıkarılabilir
        if path.startswith("cover/"):
            filepath = config.COVERS_DIR / path[len("cover/"):]
        else:
            filepath = config.WEB_DIR / (path or "index.html")

        try:
            if not filepath.is_file():
                job.fail(QWebEngineUrlRequestJob.Error.UrlNotFound)
                return
            data = filepath.read_bytes()
        except OSError:
            job.fail(QWebEngineUrlRequestJob.Error.RequestFailed)
            return

        ext = filepath.suffix.lower()
        mime = _MIME.get(ext, b"application/octet-stream")

        buf = QBuffer(job)  # job'a parent -> yaşam süresi güvenli
        buf.setData(QByteArray(data))
        buf.open(QIODevice.OpenModeFlag.ReadOnly)
        job.reply(mime, buf)
