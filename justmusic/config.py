"""Uygulama sabitleri ve dosya yolları.

Tüm kullanıcı verisi (kütüphane, indirilenler, kapaklar) tek bir klasörde,
yazılabilir bir konumda tutulur: ~/Music/JustMusic
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

APP_NAME = "Just Music Premium"
ORG_NAME = "JustMusic"

# Sürüm — GitHub sürüm etiketiyle (v1.0.0) aynı tutulur. CI derlemede etiketten
# damgalanır (bkz. .github/workflows/build.yml), böylece exe kendi sürümünü bilir.
APP_VERSION = "1.1.0"

# Otomatik güncelleme (GitHub Releases)
GITHUB_OWNER = "barkeser2002"
GITHUB_REPO = "just-music-premium"
UPDATE_API = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
RELEASES_PAGE = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases"

# Yazılabilir veri klasörü (kullanıcıya özel, Program Files gibi salt-okunur
# konumlara kurulsa bile çalışır).
BASE_DIR = Path.home() / "Music" / "JustMusic"
DOWNLOADS_DIR = BASE_DIR / "downloads"
COVERS_DIR = BASE_DIR / "covers"
DATA_FILE = BASE_DIR / "library.json"

# Kullanıcının müzik klasörü (otomatik playlist taraması için)
MUSIC_DIR = Path.home() / "Music"

# Lyrica söz servisi (zaman kodlu/LRC sözler)
LYRICS_API = "https://test-0k.onrender.com"


def _app_base() -> Path:
    """Gömülü kaynakların (bin/, assets/) kök klasörü.

    PyInstaller ile donmuş halde sys._MEIPASS; geliştirmede proje kökü.
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


APP_BASE = _app_base()
BIN_DIR = APP_BASE / "bin"
ASSETS_DIR = Path(__file__).resolve().parent / "assets"
WEB_DIR = Path(__file__).resolve().parent / "web"

# QtWebEngine özel şeması (yerel varlıklar + kapaklar; sunucu/port yok)
SCHEME = b"app"


def _resolve_binary(name: str) -> str:
    """Gömülü bin/ klasörünü, yoksa PATH'i kullanarak ikili yolunu bulur."""
    bundled = BIN_DIR / name
    if bundled.exists():
        return str(bundled)
    found = shutil.which(Path(name).stem)
    return found or str(bundled)


FFMPEG = _resolve_binary("ffmpeg.exe")
YTDLP = _resolve_binary("yt-dlp.exe")
DENO = str(BIN_DIR / "deno.exe")   # yt-dlp'nin YouTube JS (nsig) çözümü için
LOGO_PNG = ASSETS_DIR / "logo.png"
LOGO_ICO = APP_BASE / "logo.ico"


# Gömülü bin/ klasörünü SÜRECİN PATH'ine ekle: in-process yt_dlp kütüphanesi
# gömülü deno'yu (YouTube nsig/JS çözümü) ve ffmpeg'i bulabilsin.
if str(BIN_DIR) not in os.environ.get("PATH", ""):
    os.environ["PATH"] = str(BIN_DIR) + os.pathsep + os.environ.get("PATH", "")


def subprocess_env() -> dict:
    """bin/ klasörünü PATH'in başına ekler; böylece yt-dlp gömülü deno'yu bulur."""
    env = os.environ.copy()
    env["PATH"] = str(BIN_DIR) + os.pathsep + env.get("PATH", "")
    return env

DEFAULT_PLAYLIST = "Kütüphanem"
FAVORITES_PLAYLIST = "Beğenilen Şarkılar"
DOWNLOADS_PLAYLIST = "İndirilenler"
PROTECTED_PLAYLISTS = (DEFAULT_PLAYLIST, FAVORITES_PLAYLIST, DOWNLOADS_PLAYLIST)

AUDIO_EXTENSIONS = (".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".wma")


def ensure_dirs() -> None:
    """Gerekli klasörleri oluşturur (varsa dokunmaz)."""
    for d in (BASE_DIR, DOWNLOADS_DIR, COVERS_DIR):
        d.mkdir(parents=True, exist_ok=True)
