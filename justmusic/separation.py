"""htdemucs ile vokal/enstrüman ayırma (karaoke & akapella) — YALNIZCA CPU.

Demucs (htdemucs modeli) ile şarkıyı stem'lere böler; vokalsiz karışım
(enstrümantal = drums+bass+other) karaoke için, vokal stem'i akapella için
kullanılır. Ayrılan stem'ler `BASE_DIR/stems/<hash>/` altında ÖNBELLEĞE alınır,
böylece aynı şarkı bir daha ayrılmaz (anında).

CPU'da ayırma yavaştır (şarkı başına birkaç dakika) — bu yüzden arka plan
iş parçacığında ve ilerleme bildirimiyle çalışır. torch/demucs yoksa (ör. hafif
donmuş derleme) `demucs_available()` False döner ve arayüz hızlı mid-side
karaoke'ye düşer.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from PyQt6.QtCore import QThread, pyqtSignal

from . import config


def demucs_available() -> bool:
    """demucs + torch içe aktarılabiliyor mu (ağır bağımlılık isteğe bağlı)."""
    try:
        import demucs.api  # noqa: F401
        import torch  # noqa: F401
        return True
    except Exception:
        return False


def _key(path: str) -> str:
    try:
        size = os.path.getsize(path)
    except OSError:
        size = 0
    raw = f"{os.path.abspath(path)}|{size}".encode("utf-8", "ignore")
    return hashlib.md5(raw).hexdigest()


def stems_dir(path: str) -> Path:
    return config.BASE_DIR / "stems" / _key(path)


def cached_stems(path: str) -> dict | None:
    """Bu dosya için ayrılmış stem'ler diskte varsa yollarını döndür."""
    d = stems_dir(path)
    nv, vo = d / "no_vocals.wav", d / "vocals.wav"
    if nv.is_file() and vo.is_file():
        return {"no_vocals": str(nv), "vocals": str(vo)}
    return None


class SeparationThread(QThread):
    """Bir dosyayı htdemucs ile ayırır (CPU); stem'leri önbelleğe yazar."""

    progress = pyqtSignal(float, str)   # yüzde, durum metni
    done = pyqtSignal(str, str)         # no_vocals_yolu, vocals_yolu
    failed = pyqtSignal(str)

    def __init__(self, file_path: str, parent=None) -> None:
        super().__init__(parent)
        self.file_path = file_path
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        cached = cached_stems(self.file_path)
        if cached:
            self.done.emit(cached["no_vocals"], cached["vocals"])
            return
        if not os.path.exists(self.file_path):
            self.failed.emit("Ayrılacak ses dosyası bulunamadı.")
            return
        try:
            import torch
            from demucs.api import Separator, save_audio
        except Exception:
            self.failed.emit("Karaoke motoru (demucs/torch) yüklü değil.")
            return

        try:
            self.progress.emit(2.0, "Karaoke motoru hazırlanıyor…")
            torch.set_num_threads(max(1, torch.get_num_threads() or 4))

            def _cb(data):
                # demucs geri çağrısı: segment_offset / audio_length ~ ilerleme
                if self._cancel:
                    raise _Cancelled()
                try:
                    al = float(data.get("audio_length") or 0)
                    off = float(data.get("segment_offset") or 0)
                    models = max(1, int(data.get("models") or 1))
                    mi = int(data.get("model_idx_in_bag") or 0)
                    if al > 0:
                        frac = (mi + min(1.0, off / al)) / models
                        self.progress.emit(5 + frac * 90.0, "Vokaller ayrılıyor… (CPU)")
                except Exception:
                    pass

            sep = Separator(model="htdemucs", device="cpu",
                            progress=False, callback=_cb)
            self.progress.emit(5.0, "Vokaller ayrılıyor… (CPU, birkaç dk sürebilir)")
            _origin, stems = sep.separate_audio_file(self.file_path)
            if self._cancel:
                return

            no_vocals = stems["drums"] + stems["bass"] + stems["other"]
            out = stems_dir(self.file_path)
            out.mkdir(parents=True, exist_ok=True)
            self.progress.emit(97.0, "Kaydediliyor…")
            save_audio(no_vocals, str(out / "no_vocals.wav"), samplerate=sep.samplerate)
            save_audio(stems["vocals"], str(out / "vocals.wav"), samplerate=sep.samplerate)
        except _Cancelled:
            return
        except Exception as exc:
            self.failed.emit(f"Ayırma başarısız: {exc}")
            return

        self.done.emit(str(out / "no_vocals.wav"), str(out / "vocals.wav"))


class _Cancelled(Exception):
    pass
