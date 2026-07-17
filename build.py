"""PyInstaller ile Windows exe üretir (gömülü ffmpeg + yt-dlp + logo).

Kullanım:
    python build.py            # tek klasör (hızlı açılır, önerilir)
    python build.py --onefile  # tek exe dosyası (taşıması kolay, yavaş açılır)

Çıktı: dist/JustMusic/JustMusic.exe  (veya --onefile ile dist/JustMusic.exe)
Bu program yalnızca Windows içindir; ffmpeg ve yt-dlp exe içine gömülür.
"""

from __future__ import annotations

import os
import subprocess
import sys

APP_NAME = "JustMusic"


def main() -> int:
    onefile = "--onefile" in sys.argv
    here = os.path.dirname(os.path.abspath(__file__))
    sep = ";"  # Windows PyInstaller --add-data/--add-binary ayırıcısı

    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--windowed",
        "--name", APP_NAME,
        "--collect-all", "sounddevice",           # PortAudio DLL'i dahil
        "--collect-all", "yt_dlp",                # yt-dlp PYTHON kütüphanesi
        "--collect-all", "certifi",               # https sertifikaları
        "--collect-all", "PyQt6.QtWebEngineCore",  # WebEngine runtime/process/resources
        # gömülü ikili dosyalar
        "--add-binary", f"{os.path.join(here, 'bin', 'ffmpeg.exe')}{sep}bin",
        "--add-binary", f"{os.path.join(here, 'bin', 'yt-dlp.exe')}{sep}bin",
        "--add-binary", f"{os.path.join(here, 'bin', 'deno.exe')}{sep}bin",
        # web arayüzü + logo
        "--add-data", f"{os.path.join(here, 'justmusic', 'web')}{sep}justmusic/web",
        "--add-data", f"{os.path.join(here, 'justmusic', 'assets', 'logo.png')}{sep}justmusic/assets",
    ]
    args += ["--onefile"] if onefile else ["--onedir"]

    icon = os.path.join(here, "logo.ico")
    if os.path.exists(icon):
        args += ["--icon", icon]

    args.append(os.path.join(here, "main.py"))
    print(">>", " ".join(args))
    return subprocess.call(args, cwd=here)


if __name__ == "__main__":
    raise SystemExit(main())
