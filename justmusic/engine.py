"""Gerçek zamanlı DSP ses motoru.

- Çözümleme: gömülü ffmpeg ile herhangi bir biçim -> 44.1kHz stereo float PCM.
- Çıkış: sounddevice (PortAudio) geri çağırma akışı.
- İşleme zinciri (blok bazlı, numpy/scipy): hız (yeniden örnekleme) -> preamp ->
  10 bant EQ -> bass low-shelf -> echo -> reverb (çok-taplı) -> 8D spatial -> ses.
- Görselleştirici için gerçek FFT spektrumu üretir.

Qt'ye bağımlı değildir; arayüz durumu QTimer ile yoklar (poll eder).
"""

from __future__ import annotations

import math
import subprocess
import threading

import numpy as np
from scipy.signal import lfilter, sosfilt

from . import config, eqpresets

SR = 44100
BLOCK = 1024
N_BARS = 56

_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW (windowed exe'de konsol açılmasın)


# ---------------------------------------------------------------------------
#  Biquad katsayıları (RBJ cookbook)
# ---------------------------------------------------------------------------
def _peaking(f0: float, gain_db: float, q: float, sr: int) -> list[float]:
    a = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    b0 = 1 + alpha * a
    b1 = -2 * cw
    b2 = 1 - alpha * a
    a0 = 1 + alpha / a
    a1 = -2 * cw
    a2 = 1 - alpha / a
    return [b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]


def _low_shelf(f0: float, gain_db: float, sr: int) -> list[float]:
    a = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / 2 * math.sqrt((a + 1 / a) * (1 / 0.9 - 1) + 2)
    two_sqrt_a_alpha = 2 * math.sqrt(a) * alpha
    b0 = a * ((a + 1) - (a - 1) * cw + two_sqrt_a_alpha)
    b1 = 2 * a * ((a - 1) - (a + 1) * cw)
    b2 = a * ((a + 1) - (a - 1) * cw - two_sqrt_a_alpha)
    a0 = (a + 1) + (a - 1) * cw + two_sqrt_a_alpha
    a1 = -2 * ((a - 1) + (a + 1) * cw)
    a2 = (a + 1) + (a - 1) * cw - two_sqrt_a_alpha
    return [b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]


def build_eq_sos(gains_db: list[float], sr: int = SR) -> np.ndarray:
    rows = [_peaking(f, g, 1.1, sr) for f, g in zip(eqpresets.BANDS, gains_db)]
    return np.array(rows, dtype=np.float64)


def decode_audio(path: str, sr: int = SR) -> np.ndarray:
    """ffmpeg ile dosyayı (N, 2) float32 diziye çözümler."""
    cmd = [
        config.FFMPEG, "-v", "quiet", "-nostdin",
        "-i", path, "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", "2", "-ar", str(sr), "-",
    ]
    proc = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        creationflags=_NO_WINDOW,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError("Çözümleme başarısız")
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if data.size < 2:
        raise RuntimeError("Boş ses")
    return data.reshape(-1, 2).copy()


def auto_eq_gains(audio: np.ndarray, sr: int = SR) -> list[float]:
    """Parçanın ortalama spektrumunu analiz edip düzleştirici + hafif gülümseme
    EQ kazançları üretir (Oto mod)."""
    if audio is None or audio.size < sr:
        return [0.0] * eqpresets.N_BANDS
    mono = audio.mean(axis=1)
    if mono.size > sr * 60:
        mono = mono[: sr * 60]
    win = 8192
    if mono.size < win:
        return [0.0] * eqpresets.N_BANDS
    window = np.hanning(win)
    mags = []
    for start in range(0, mono.size - win, win):
        seg = mono[start:start + win]
        mags.append(np.abs(np.fft.rfft(seg * window)))
    if not mags:
        return [0.0] * eqpresets.N_BANDS
    avg = np.mean(mags, axis=0)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    band_db = []
    for f in eqpresets.BANDS:
        lo, hi = f / 1.414, f * 1.414
        sel = (freqs >= lo) & (freqs < hi)
        val = avg[sel].mean() if sel.any() else 1e-6
        band_db.append(20 * np.log10(val + 1e-9))
    band_db = np.array(band_db)
    gains = np.clip((band_db.mean() - band_db) * 0.5, -8, 8)
    smile = np.array([2, 1.5, 0.5, 0, 0, 0, 0, 0.5, 1.5, 2])
    gains = np.clip(gains + smile, -12, 12)
    return [round(float(g), 1) for g in gains]


def waveform_peaks(audio: np.ndarray, n: int = 480) -> list[float]:
    """Şarkının tamamından N adet tepe değeri (dalga formu önizlemesi) üretir."""
    if audio is None or audio.size == 0:
        return []
    mono = np.abs(audio).max(axis=1)
    binsz = max(1, mono.size // n)
    usable = mono[: binsz * (mono.size // binsz)]
    if usable.size == 0:
        return []
    peaks = usable.reshape(-1, binsz).max(axis=1)
    mx = float(peaks.max()) or 1.0
    return [round(float(p / mx), 3) for p in peaks[:n]]


def analyze_mood(audio: np.ndarray, sr: int = SR) -> tuple[str, str]:
    """Sesin enerji + parlaklığından bir 'ruh hali' etiketi ve rengi çıkarır."""
    if audio is None or audio.size < sr:
        return ("🎵 Dengeli", "#1db954")
    mono = audio.mean(axis=1)
    if mono.size > sr * 50:
        mono = mono[sr * 5: sr * 50]
    rms = float(np.sqrt(np.mean(mono ** 2)))
    win = 8192
    if mono.size < win:
        return ("🎵 Dengeli", "#1db954")
    window = np.hanning(win)
    mags = []
    for start in range(0, mono.size - win, win):
        mags.append(np.abs(np.fft.rfft(mono[start:start + win] * window)))
    if not mags:
        return ("🎵 Dengeli", "#1db954")
    avg = np.mean(mags, axis=0)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    centroid = float((freqs * avg).sum() / (avg.sum() + 1e-9))
    energy = min(1.0, rms * 6.5)
    bright = min(1.0, centroid / 4500.0)
    if energy > 0.5 and bright > 0.5:
        return ("⚡ Enerjik", "#f97316")
    if energy > 0.5 and bright <= 0.5:
        return ("🔥 Güçlü", "#ef4444")
    if energy <= 0.32 and bright > 0.5:
        return ("✨ Aydınlık", "#38bdf8")
    if energy <= 0.32 and bright <= 0.42:
        return ("🌙 Sakin", "#8b5cf6")
    return ("🎧 Dengeli", "#1db954")


def estimate_bpm(audio: np.ndarray, sr: int = SR) -> int:
    """Onset zarfı otokorelasyonuyla kaba BPM tahmini."""
    if audio is None or audio.size < sr * 5:
        return 0
    mono = audio.mean(axis=1)
    if mono.size > sr * 60:
        mono = mono[sr * 5: sr * 60]
    hop, win = 512, 1024
    rms = np.array([np.sqrt(np.mean(mono[i:i + win] ** 2))
                    for i in range(0, mono.size - win, hop)])
    if rms.size < 20:
        return 0
    env = np.diff(rms)
    env[env < 0] = 0
    env = env - env.mean()
    ac = np.correlate(env, env, "full")[env.size - 1:]
    fps = sr / hop
    lo, hi = int(fps * 60 / 190), int(fps * 60 / 60)
    hi = min(hi, ac.size - 1)
    if hi <= lo:
        return 0
    lag = lo + int(np.argmax(ac[lo:hi]))
    bpm = 60 * fps / max(1, lag)
    while bpm < 70:
        bpm *= 2
    while bpm > 190:
        bpm /= 2
    return int(round(bpm))


def integrated_loudness(audio: np.ndarray) -> float:
    """Parçanın ortalama gürültülük (RMS dB) değeri — ses eşitleme için."""
    if audio is None or audio.size == 0:
        return -20.0
    rms = float(np.sqrt(np.mean(audio ** 2)) + 1e-9)
    return 20.0 * np.log10(rms)


def loudness_gain(audio: np.ndarray, target_db: float = -14.0) -> float:
    """Hedef gürültülüğe getiren çarpan (0.3..3.0 arası)."""
    ld = integrated_loudness(audio)
    gain = 10 ** ((target_db - ld) / 20.0)
    return float(max(0.3, min(3.0, gain)))


def spectrogram(audio: np.ndarray, sr: int = SR, cols: int = 130, rows: int = 48) -> list:
    """Küçük spektrogram (cols x rows, 0..1) — görsel analiz için."""
    if audio is None or audio.size < sr:
        return []
    mono = audio.mean(axis=1)
    if mono.size > sr * 240:
        mono = mono[: sr * 240]
    win = 2048
    hop = max(1, (mono.size - win) // cols)
    if hop < 1:
        return []
    window = np.hanning(win)
    out = []
    freqs = np.fft.rfftfreq(win, 1 / sr)
    edges = np.logspace(np.log10(40), np.log10(sr / 2), rows + 1)
    idx = [np.searchsorted(freqs, e) for e in edges]
    for c in range(cols):
        start = c * hop
        seg = mono[start:start + win]
        if seg.size < win:
            break
        mag = np.abs(np.fft.rfft(seg * window))
        col = []
        for r in range(rows):
            a, b = idx[r], max(idx[r] + 1, idx[r + 1])
            col.append(float(mag[a:b].mean()))
        out.append(col)
    if not out:
        return []
    arr = np.array(out)
    arr = np.log1p(arr)
    mx = arr.max() or 1.0
    arr = (arr / mx)
    return [[round(float(v), 2) for v in col] for col in arr.tolist()]


class DspEngine:
    def __init__(self) -> None:
        self.sr = SR
        self.block = BLOCK
        self._lock = threading.Lock()

        self.audio: np.ndarray | None = None
        self.current_path = None       # çözümlemesi biten dosya (analiz için)
        self.pos = 0.0                 # kesirli örnek indeksi
        self.playing = False
        self._at_end = False
        self.load_error = ""
        self._gen = 0                  # yükleme kuşağı (eski çözümlemeleri yok say)

        # parametreler
        self.speed = 1.0
        self.volume = 0.8              # 0..1.5
        self.eq_enabled = True
        self._sos = build_eq_sos(eqpresets.PRESETS["🎚 Flat"])
        self._zi = np.zeros((self._sos.shape[0], 2, 2))
        self.preamp = 1.0
        self.effects = dict(eqpresets.DEFAULT_EFFECTS)
        # A-B döngü + ses manzarası (soundscape)
        self.loop_a = None
        self.loop_b = None
        self.soundscape = "off"
        self.soundscape_level = 0.0
        self._brown_zi = np.zeros((1, 2))
        self._sc_rng = np.random.default_rng(7)

        # efekt durumları
        self._bass_sos: np.ndarray | None = None
        self._bass_zi = np.zeros((1, 2, 2))
        maxd = 2 * SR
        self._echo_ring = np.zeros((maxd, 2), dtype=np.float32)
        self._echo_wp = 0
        self._echo_max = maxd
        self._rv_ring = np.zeros((SR, 2), dtype=np.float32)
        self._rv_wp = 0
        self._rv_max = SR
        self._rv_taps = [int(SR * t) for t in (0.030, 0.058, 0.089, 0.121, 0.157)]
        self._rv_gains = [0.62, 0.48, 0.36, 0.26, 0.18]
        self._spatial_phase = 0.0

        # görselleştirici spektrumu
        self._spectrum = np.zeros(N_BARS, dtype=np.float32)
        self._win = np.hanning(BLOCK).astype(np.float32)

        self._stream = None

    # ------------------------------------------------------------------ akış
    def start(self) -> bool:
        if self._stream is not None:
            return True
        try:
            import sounddevice as sd
            self._stream = sd.OutputStream(
                samplerate=self.sr, channels=2, blocksize=self.block,
                dtype="float32", callback=self._callback,
            )
            self._stream.start()
            return True
        except Exception as exc:
            self.load_error = f"Ses aygıtı açılamadı: {exc}"
            self._stream = None
            return False

    def close(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

    # --------------------------------------------------------------- yükleme
    def load(self, path: str, autoplay: bool = True) -> None:
        self._gen += 1
        gen = self._gen
        self.load_error = ""
        with self._lock:
            self.audio = None
            self.current_path = None
            self.pos = 0.0
            self.playing = False
            self._at_end = False
            self.loop_a = self.loop_b = None
        threading.Thread(target=self._decode_worker, args=(path, gen, autoplay), daemon=True).start()

    def _decode_worker(self, path: str, gen: int, autoplay: bool) -> None:
        try:
            audio = decode_audio(path)
        except Exception as exc:
            if gen == self._gen:
                self.load_error = str(exc)
            return
        if gen != self._gen:
            return  # bu arada başka parça yüklendi
        with self._lock:
            self.audio = audio
            self.current_path = path
            self.pos = 0.0
            self._at_end = False
            self.playing = autoplay
            self._reset_filter_state()

    def swap_source(self, path: str) -> None:
        """Aynı parçanın alternatif kaynağına geç (ör. htdemucs enstrümantal/vokal
        stem) — KONUMU ve çalma durumunu KORU. Karaoke/akapella için kesintisiz geçiş.
        (load() konumu sıfırlar; bu onu korur.)"""
        self._gen += 1
        gen = self._gen
        self.load_error = ""
        with self._lock:
            keep_pos = self.pos
            was_playing = self.playing
        threading.Thread(target=self._swap_worker,
                         args=(path, gen, keep_pos, was_playing), daemon=True).start()

    def _swap_worker(self, path: str, gen: int, keep_pos: float, was_playing: bool) -> None:
        try:
            audio = decode_audio(path)
        except Exception as exc:
            if gen == self._gen:
                self.load_error = str(exc)
            return
        if gen != self._gen:
            return  # bu arada başka parça yüklendi
        with self._lock:
            self.audio = audio
            self.current_path = path
            n = audio.shape[0]
            self.pos = float(np.clip(keep_pos, 0, max(0, n - 1)))
            self._at_end = False
            self.playing = was_playing
            self._reset_filter_state()

    def _reset_filter_state(self) -> None:
        self._zi = np.zeros((self._sos.shape[0], 2, 2))
        self._bass_zi = np.zeros((1, 2, 2))
        self._echo_ring[:] = 0
        self._rv_ring[:] = 0

    # ------------------------------------------------------------- transport
    def play(self) -> None:
        with self._lock:
            if self.audio is not None:
                if self._at_end:
                    self.pos = 0.0
                    self._at_end = False
                self.playing = True

    def pause(self) -> None:
        with self._lock:
            self.playing = False

    def toggle(self) -> None:
        with self._lock:
            if self.audio is not None:
                self.playing = not self.playing

    def stop(self) -> None:
        with self._lock:
            self.playing = False
            self.pos = 0.0

    def clear(self) -> None:
        """Yüklü parçayı boşaltır (is_loaded -> False)."""
        with self._lock:
            self.audio = None
            self.current_path = None
            self.pos = 0.0
            self.playing = False
            self._at_end = False
            self.loop_a = self.loop_b = None

    def seek(self, seconds: float) -> None:
        with self._lock:
            if self.audio is not None:
                n = self.audio.shape[0]
                self.pos = float(np.clip(seconds * self.sr, 0, max(0, n - 1)))
                self._at_end = False

    def is_playing(self) -> bool:
        return self.playing

    def is_loaded(self) -> bool:
        return self.audio is not None

    def position(self) -> float:
        return self.pos / self.sr

    def duration(self) -> float:
        with self._lock:
            return (self.audio.shape[0] / self.sr) if self.audio is not None else 0.0

    def consume_end(self) -> bool:
        """Parça bittiyse True döndürür ve bayrağı temizler (poller kullanır)."""
        if self._at_end:
            self._at_end = False
            return True
        return False

    def spectrum(self) -> np.ndarray:
        return self._spectrum

    # ------------------------------------------------------------ parametre
    def set_volume(self, pct: float) -> None:
        self.volume = max(0.0, min(1.5, pct / 100.0))

    def set_speed(self, rate: float) -> None:
        self.speed = max(0.25, min(3.0, float(rate)))

    def set_loop(self, a: float, b: float) -> None:
        with self._lock:
            if b > a >= 0:
                self.loop_a, self.loop_b = float(a), float(b)

    def clear_loop(self) -> None:
        with self._lock:
            self.loop_a = self.loop_b = None

    def set_soundscape(self, kind: str, level: float) -> None:
        self.soundscape = kind or "off"
        self.soundscape_level = max(0.0, min(1.0, level / 100.0))

    def waveform(self, n: int = 480):
        with self._lock:
            return waveform_peaks(self.audio, n) if self.audio is not None else []

    def mood(self):
        with self._lock:
            return analyze_mood(self.audio) if self.audio is not None else ("", "")

    def set_eq(self, gains_db: list[float]) -> None:
        sos = build_eq_sos(gains_db)
        with self._lock:
            self._sos = sos
            if self._zi.shape[0] != sos.shape[0]:
                self._zi = np.zeros((sos.shape[0], 2, 2))

    def set_eq_enabled(self, on: bool) -> None:
        self.eq_enabled = on

    def set_effect(self, name: str, value: float) -> None:
        self.effects[name] = value
        if name == "preamp":
            self.preamp = 10 ** (((value - 50) / 50.0 * 12.0) / 20.0)
        elif name == "bass":
            if value <= 0:
                self._bass_sos = None
            else:
                self._bass_sos = np.array([_low_shelf(110, value / 100.0 * 12.0, self.sr)])
                self._bass_zi = np.zeros((1, 2, 2))

    # -------------------------------------------------------------- callback
    def _callback(self, outdata, frames, time_info, status) -> None:  # noqa: ARG002
        try:
            with self._lock:
                audio = self.audio
                sc, sc_lvl = self.soundscape, self.soundscape_level
                if audio is None or not self.playing:
                    outdata[:] = self._gen_soundscape(frames) if (sc != "off" and sc_lvl > 0) else 0
                    return
                n = audio.shape[0]
                speed = self.speed
                pos = self.pos
                if pos >= n - 1:
                    self.playing = False
                    self._at_end = True
                    outdata[:] = self._gen_soundscape(frames) if (sc != "off" and sc_lvl > 0) else 0
                    return
                idx = pos + np.arange(frames) * speed
                i0 = np.floor(idx).astype(np.int64)
                frac = (idx - i0).astype(np.float32)
                i0 = np.clip(i0, 0, n - 2)
                block = (audio[i0] * (1.0 - frac)[:, None]
                         + audio[i0 + 1] * frac[:, None]).astype(np.float32)
                self.pos = pos + frames * speed
                # A-B döngü (pratik modu)
                if self.loop_b is not None and self.loop_a is not None and self.pos >= self.loop_b * self.sr:
                    self.pos = self.loop_a * self.sr
                elif self.pos >= n - 1:
                    self._at_end = True
                    self.playing = False
                sos = self._sos
                eq_on = self.eq_enabled
                preamp = self.preamp
                volume = self.volume
                bass_sos = self._bass_sos
                fx = self.effects
                karaoke = fx.get("karaoke", 0)

            # ---- ağır DSP (kilit dışında; filtre durumlarına yalnız callback dokunur) ----
            block *= preamp
            if eq_on:
                block, self._zi = sosfilt(sos, block, axis=0, zi=self._zi)
                block = block.astype(np.float32)
            if bass_sos is not None:
                block, self._bass_zi = sosfilt(bass_sos, block, axis=0, zi=self._bass_zi)
                block = block.astype(np.float32)
            # karaoke / vokal azaltma (merkez kanal iptali)
            if karaoke > 0:
                amt = karaoke / 100.0
                mid = (block[:, 0] + block[:, 1]) * 0.5
                block[:, 0] -= amt * mid
                block[:, 1] -= amt * mid

            self._update_spectrum(block)

            if fx["echo"] > 0:
                block = self._apply_echo(block, frames, fx)
            if fx["reverb"] > 0:
                block = self._apply_reverb(block, frames, fx)
            if fx["spatial"] > 0:
                block = self._apply_spatial(block, frames, fx)

            block *= volume
            if sc != "off" and sc_lvl > 0:
                block = block + self._gen_soundscape(frames)
            np.clip(block, -1.0, 1.0, out=block)
            outdata[:] = block
        except Exception:
            outdata[:] = 0

    def _gen_soundscape(self, frames: int) -> np.ndarray:
        lvl = self.soundscape_level
        kind = self.soundscape
        if kind == "off" or lvl <= 0:
            return np.zeros((frames, 2), dtype=np.float32)
        white = self._sc_rng.standard_normal((frames, 2))
        if kind == "white":
            out = white * 0.16
        else:  # brown / rain — sürekli (tıksız) leaky integrator
            filt, self._brown_zi = lfilter(np.array([0.03]), np.array([1.0, -0.985]),
                                           white, axis=0, zi=self._brown_zi)
            out = filt * 9.0
            if kind == "rain":
                out = out * 0.7 + white * 0.09
            out = out * 0.55
        return (out * lvl).astype(np.float32)

    # ---- efekt uygulayıcıları --------------------------------------------
    def _apply_echo(self, block, frames, fx):
        mix = fx["echo"] / 100.0
        delay = 0.05 + fx["echo_time"] / 100.0 * 0.75
        fb = fx["echo_feedback"] / 100.0 * 0.85
        L = int(delay * self.sr)
        L = max(frames, min(L, self._echo_max - frames))
        wp = self._echo_wp
        ridx = (wp - L + np.arange(frames)) % self._echo_max
        delayed = self._echo_ring[ridx]
        wet = block + fb * delayed
        widx = (wp + np.arange(frames)) % self._echo_max
        self._echo_ring[widx] = wet
        self._echo_wp = (wp + frames) % self._echo_max
        return ((1 - mix) * block + mix * wet).astype(np.float32)

    def _apply_reverb(self, block, frames, fx):
        amount = fx["reverb"] / 100.0
        wp = self._rv_wp
        widx = (wp + np.arange(frames)) % self._rv_max
        self._rv_ring[widx] = block
        wet = np.zeros_like(block)
        for tap, g in zip(self._rv_taps, self._rv_gains):
            ridx = (wp - tap + np.arange(frames)) % self._rv_max
            wet += self._rv_ring[ridx] * g
        self._rv_wp = (wp + frames) % self._rv_max
        return (block + amount * 0.7 * wet).astype(np.float32)

    def _apply_spatial(self, block, frames, fx):
        depth = fx["spatial"] / 100.0
        rate = 0.18  # Hz
        step = 2 * math.pi * rate / self.sr
        phase = self._spatial_phase + np.arange(frames) * step
        self._spatial_phase = float((phase[-1] + step) % (2 * math.pi))
        pan = depth * np.sin(phase)
        lg = np.cos((pan + 1) * math.pi / 4).astype(np.float32)
        rg = np.sin((pan + 1) * math.pi / 4).astype(np.float32)
        out = block.copy()
        out[:, 0] *= lg
        out[:, 1] *= rg
        return out

    def _update_spectrum(self, block) -> None:
        if block.shape[0] < self.block:
            return
        mono = block[: self.block, 0] + block[: self.block, 1]
        spec = np.abs(np.fft.rfft(mono * self._win))
        # logaritmik grup -> N_BARS
        edges = np.logspace(np.log10(2), np.log10(len(spec) - 1), N_BARS + 1).astype(int)
        bars = np.zeros(N_BARS, dtype=np.float32)
        for i in range(N_BARS):
            a, b = edges[i], max(edges[i] + 1, edges[i + 1])
            bars[i] = spec[a:b].mean()
        bars = np.log1p(bars) / 6.0
        np.clip(bars, 0, 1, out=bars)
        # yumuşat
        self._spectrum = (0.6 * self._spectrum + 0.4 * bars).astype(np.float32)
