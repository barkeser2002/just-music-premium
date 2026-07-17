"""10 bantlı ekolayzır: bant frekansları + 30 hazır profil + efekt varsayılanları."""

from __future__ import annotations

# 10 bant merkez frekansları (Hz)
BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
BAND_LABELS = ["31", "62", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"]
N_BANDS = len(BANDS)

# Her profil: 10 bant kazancı (dB, -12..+12). "Oto" ayrı hesaplanır.
PRESETS: dict[str, list[float]] = {
    "🎚 Flat":            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "🔊 Bass Boost":      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    "💥 Süper Bass":      [10, 9, 7, 4, 1, -1, -2, -2, -1, 0],
    "🎙 Vokal":           [-3, -3, -1, 2, 4, 5, 4, 2, 0, -1],
    "🎸 Rock":            [5, 4, 2, -1, -2, 1, 3, 4, 4, 3],
    "🎤 Pop":             [-1, 0, 2, 4, 4, 2, 0, -1, -1, 0],
    "🎧 Hip-Hop":         [8, 7, 4, 2, 0, 1, 2, 2, 3, 2],
    "🕺 Dance":           [7, 6, 3, 0, -1, 1, 3, 4, 4, 3],
    "🎹 Elektronik":      [6, 5, 1, 0, -2, 2, 1, 2, 5, 6],
    "🎻 Klasik":          [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    "🎷 Jazz":            [4, 3, 1, 2, -1, -1, 0, 1, 2, 3],
    "🪕 Akustik":         [4, 4, 2, 0, 1, 1, 3, 3, 2, 1],
    "🥁 Techno":          [8, 6, 2, 0, -2, 1, 3, 5, 6, 6],
    "🌴 Reggae":          [3, 2, 0, 3, 0, -1, 2, 3, 2, 1],
    "🤘 Metal":           [6, 5, 3, 0, -1, 2, 4, 5, 5, 4],
    "🎼 Orkestra":        [5, 4, 3, 2, 0, -1, 1, 3, 4, 5],
    "🌙 Gece (Kısık)":    [-2, -2, -3, -3, -4, -4, -5, -6, -7, -8],
    "🚗 Araba":           [7, 6, 4, 1, -1, 0, 2, 4, 5, 4],
    "🎮 Oyun":            [5, 4, 2, 1, 2, 3, 4, 5, 4, 3],
    "🎬 Sinema":          [6, 5, 3, 1, 0, 1, 2, 3, 4, 5],
    "📻 Radyo":           [-4, -2, 1, 3, 4, 4, 3, 1, -2, -4],
    "👂 Kulaklık":        [4, 3, 1, -1, -2, 0, 2, 4, 5, 5],
    "🔈 Küçük Hoparlör":  [-6, -4, -1, 2, 3, 3, 2, 1, -1, -3],
    "🎺 Full Tiz":        [-2, -2, -1, 0, 1, 2, 4, 6, 8, 9],
    "🫧 Vaporwave":       [6, 5, 4, 2, 1, 0, -1, -1, 0, 1],
    "⚡ Nightcore":       [3, 2, 1, 0, 1, 3, 4, 5, 6, 6],
    "🌊 Lo-Fi":           [5, 4, 3, 2, 1, 0, -2, -4, -5, -6],
    "🎯 Denge":           [2, 2, 1, 0, 0, 0, 1, 2, 2, 2],
    "🔥 Loudness":        [7, 5, 2, 0, 1, 2, 3, 4, 6, 7],
    "🧊 Kristal":         [1, 1, 0, 0, 1, 2, 3, 4, 5, 6],
}

PRESET_NAMES = list(PRESETS.keys())

# Efekt paneli varsayılanları (0..100 ölçekli slider değerleri)
DEFAULT_EFFECTS = {
    "preamp": 50,      # 0..100 -> -12..+12 dB
    "echo": 0,         # 0..100 wet
    "echo_time": 35,   # 0..100 -> 0.05..0.8 sn
    "echo_feedback": 40,  # 0..100 -> 0..0.85
    "reverb": 0,       # 0..100
    "spatial": 0,      # 0..100 (8D dönen ses)
    "bass": 0,         # 0..100 low-shelf boost
    "karaoke": 0,      # 0..100 (merkez/vokal azaltma)
}
