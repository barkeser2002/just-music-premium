"""Otomatik güncelleme (GitHub Releases → .msi).

Akış (kullanıcı tercihi: TAM OTOMATİK):
  1. Açılışta arka planda `UpdateCheckThread` en son sürümü sorar (GitHub API).
  2. Daha yeni sürüm varsa `.msi` sessizce %TEMP%'e indirilir (ilerleme yayınlanır).
  3. İndirme bitince `ready` sinyali → köprü `_staged_update` yolunu tutar.
  4. Uygulama kapanınca (`bridge.shutdown`) `install_and_relaunch` çağrılır:
     ayrık bir .cmd, uygulama tam kapansın diye bekler, `msiexec /qn` ile sessiz
     kurar ve exe'yi yeniden başlatır (perUser MSI → UAC yok).

Yalnızca DONMUŞ (PyInstaller) derlemede indirir; geliştirmede sadece sürüm
kıyaslar (dosya değiştirmek anlamsız). Ağ yoksa sessizce vazgeçer.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from PyQt6.QtCore import QThread, pyqtSignal

from . import config


def _ssl_context() -> ssl.SSLContext:
    """certifi varsa onu kullan (donmuş derlemede sistem deposu eksik olabilir)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def parse_version(text: str) -> tuple:
    """'v1.2.3' / '1.2' → (1,2,3). Sayısal olmayan son ekler yok sayılır."""
    nums = re.findall(r"\d+", text or "")
    if not nums:
        return (0,)
    return tuple(int(n) for n in nums[:4])


def is_newer(latest: str, current: str) -> bool:
    """latest > current mı? (sürüm demetlerini eşit uzunlukta kıyaslar)"""
    a, b = parse_version(latest), parse_version(current)
    n = max(len(a), len(b))
    a = a + (0,) * (n - len(a))
    b = b + (0,) * (n - len(b))
    return a > b


class UpdateCheckThread(QThread):
    """GitHub'da yeni sürüm arar; varsa .msi'yi indirir."""

    available = pyqtSignal(str, str)     # sürüm, notlar
    progress = pyqtSignal(float)         # yüzde (indirme)
    ready = pyqtSignal(str, str)         # msi_yolu, sürüm
    noUpdate = pyqtSignal()
    error = pyqtSignal(str)

    def __init__(self, current_version: str, allow_download: bool, parent=None) -> None:
        super().__init__(parent)
        self.current = current_version
        self.allow_download = allow_download
        self._ctx = _ssl_context()

    def _api_get(self, url: str) -> dict:
        req = urllib.request.Request(url, headers={
            "User-Agent": "JustMusic-Updater",
            "Accept": "application/vnd.github+json",
        })
        with urllib.request.urlopen(req, timeout=15, context=self._ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def run(self) -> None:
        try:
            data = self._api_get(config.UPDATE_API)
        except Exception as exc:  # ağ yok / repo yok / rate-limit → sessiz vazgeç
            self.error.emit(f"Güncelleme kontrolü başarısız: {exc}")
            return

        tag = data.get("tag_name") or data.get("name") or ""
        if not tag or not is_newer(tag, self.current):
            self.noUpdate.emit()
            return

        notes = (data.get("body") or "").strip()
        self.available.emit(tag.lstrip("vV"), notes)

        # Geliştirmede indirme yok — sadece "mevcut" bildirimi
        if not self.allow_download:
            return

        asset = self._pick_msi(data.get("assets") or [])
        if not asset:
            self.error.emit("Sürümde .msi kurulum dosyası yok.")
            return

        try:
            path = self._download(asset["browser_download_url"], asset["name"])
        except Exception as exc:
            self.error.emit(f"Güncelleme indirilemedi: {exc}")
            return
        self.ready.emit(str(path), tag.lstrip("vV"))

    @staticmethod
    def _pick_msi(assets: list) -> dict | None:
        msis = [a for a in assets if str(a.get("name", "")).lower().endswith(".msi")]
        if not msis:
            return None
        # Sabit adlı kurulum önce (JustMusic-Setup.msi)
        for a in msis:
            if "setup" in a["name"].lower():
                return a
        return msis[0]

    def _download(self, url: str, name: str) -> Path:
        out_dir = Path(tempfile.gettempdir()) / "JustMusic-update"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / name
        req = urllib.request.Request(url, headers={"User-Agent": "JustMusic-Updater"})
        with urllib.request.urlopen(req, timeout=30, context=self._ctx) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            with open(out, "wb") as f:
                while True:
                    chunk = resp.read(262144)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        self.progress.emit(done / total * 100.0)
        return out


def install_and_relaunch(msi_path: str, relaunch_exe: str) -> bool:
    """Ayrık bir .cmd başlatır: uygulama kapanınca sessiz kurar + yeniden açar.

    perUser MSI olduğundan UAC istemez. Uygulama bu çağrıdan hemen sonra
    kapanmalıdır ki msiexec kilitli dosyalarla karşılaşmasın.
    """
    if not msi_path or not os.path.exists(msi_path):
        return False
    log = Path(tempfile.gettempdir()) / "JustMusic-update" / "install.log"
    script = (
        "@echo off\r\n"
        "rem Uygulamanın tam kapanmasını bekle\r\n"
        "timeout /t 3 /nobreak >nul\r\n"
        f'msiexec /i "{msi_path}" /qn /L*v "{log}"\r\n'
        f'start "" "{relaunch_exe}"\r\n'
        'del "%~f0"\r\n'
    )
    cmd_path = Path(tempfile.gettempdir()) / "JustMusic-update" / "apply_update.cmd"
    cmd_path.parent.mkdir(parents=True, exist_ok=True)
    cmd_path.write_text(script, encoding="utf-8")

    # Ayrık, penceresiz süreç — uygulama ölse de yaşamaya devam eder
    flags = 0
    for name in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
        flags |= getattr(subprocess, name, 0)
    try:
        subprocess.Popen(["cmd", "/c", str(cmd_path)], creationflags=flags,
                         close_fds=True, cwd=str(cmd_path.parent))
        return True
    except Exception:
        return False


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))
