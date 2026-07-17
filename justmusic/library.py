"""Kütüphane veri modeli ve kalıcı depolama (JSON)."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from . import config, naming


def make_song(
    path: str,
    title: str | None = None,
    artist: str = "",
    thumbnail: str = "",
    source: str = "local",
    duration_ms: int = 0,
) -> dict[str, Any]:
    """Standart bir şarkı sözlüğü üretir.

    Başlık verilmezse dosya adı temizlenip “Sanatçı - Başlık” olarak ayrıştırılır.
    """
    if title is None:
        guessed_artist, guessed_title = naming.from_filename(Path(path).stem)
        title = guessed_title
        if not artist and guessed_artist:
            artist = guessed_artist
    return {
        "id": uuid.uuid4().hex,
        "title": title,
        "artist": artist,
        "path": str(path),
        "thumbnail": thumbnail,
        "thumbnail_url": "",
        "lyrics": "",
        "favorite": False,
        "play_count": 0,
        "duration_ms": int(duration_ms),
        "source": source,
    }


def _migrate_song(s: dict[str, Any]) -> dict[str, Any]:
    """Eski/eksik alanları normalize eder."""
    if "id" not in s:
        s["id"] = uuid.uuid4().hex
    # Eski pywebview sürümü playCount / raw_path kullanıyordu
    if "play_count" not in s:
        s["play_count"] = int(s.pop("playCount", 0) or 0)
    if "duration_ms" not in s:
        s["duration_ms"] = 0
    # Eski path bir http url ise gerçek dosya yolunu kullan
    raw = s.get("raw_path")
    if raw and str(s.get("path", "")).startswith("http"):
        s["path"] = raw
    s.pop("raw_path", None)
    for key, default in (
        ("artist", ""), ("thumbnail", ""), ("thumbnail_url", ""),
        ("lyrics", ""), ("favorite", False), ("source", "local"),
    ):
        s.setdefault(key, default)
    # path/title her zaman bulunmalı (elle düzenlenmiş veriye karşı güvence)
    s.setdefault("path", "")
    s.setdefault("title", Path(s.get("path", "")).stem or "Bilinmeyen Parça")
    return s


class Library:
    """Çalma listeleri, istatistik ve ayarları tutan veri kabı."""

    def __init__(self) -> None:
        self.playlists: dict[str, list[dict[str, Any]]] = {
            name: [] for name in config.PROTECTED_PLAYLISTS
        }
        self.current: str = config.DEFAULT_PLAYLIST
        self.stats: dict[str, Any] = {"total_seconds": 0}
        self.settings: dict[str, Any] = {"theme": "green", "volume": 80, "speed": 1.0}

    # ---- kalıcılık -------------------------------------------------------
    def load(self) -> None:
        if not config.DATA_FILE.exists():
            return
        try:
            with open(config.DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return
        if not isinstance(data, dict):
            return  # bozuk/beklenmeyen kök yapısı -> varsayılanlarla devam

        pls = data.get("playlists")
        if isinstance(pls, dict) and pls:
            self.playlists = {
                name: [_migrate_song(s) for s in (songs if isinstance(songs, list) else [])
                       if isinstance(s, dict)]
                for name, songs in pls.items()
            }
        # Zorunlu listeleri garanti et
        for name in config.PROTECTED_PLAYLISTS:
            self.playlists.setdefault(name, [])

        cur = data.get("current_playlist") or data.get("current")
        self.current = cur if cur in self.playlists else config.DEFAULT_PLAYLIST

        if isinstance(data.get("stats"), dict):
            self.stats.update(data["stats"])
            # eski "totalSeconds" alanı
            if "totalSeconds" in data["stats"]:
                self.stats["total_seconds"] = int(data["stats"]["totalSeconds"])
        if isinstance(data.get("settings"), dict):
            self.settings.update(data["settings"])

    def save(self) -> None:
        payload = {
            "playlists": self.playlists,
            "current_playlist": self.current,
            "stats": self.stats,
            "settings": self.settings,
        }
        config.ensure_dirs()
        tmp = config.DATA_FILE.with_suffix(".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            os.replace(tmp, config.DATA_FILE)
        except OSError:
            pass

    def to_json(self) -> str:
        return json.dumps(
            {
                "playlists": self.playlists,
                "current_playlist": self.current,
                "stats": self.stats,
                "settings": self.settings,
            },
            ensure_ascii=False,
            indent=2,
        )

    # ---- çalma listesi işlemleri ----------------------------------------
    def current_songs(self) -> list[dict[str, Any]]:
        return self.playlists.get(self.current, [])

    def add_playlist(self, name: str) -> bool:
        name = name.strip()
        if not name or name in self.playlists:
            return False
        self.playlists[name] = []
        return True

    def remove_playlist(self, name: str) -> bool:
        if name in config.PROTECTED_PLAYLISTS or name not in self.playlists:
            return False
        del self.playlists[name]
        if self.current == name:
            self.current = config.DEFAULT_PLAYLIST
        return True

    def find_song(self, playlist: str, song_id: str) -> dict[str, Any] | None:
        for s in self.playlists.get(playlist, []):
            if s.get("id") == song_id:
                return s
        return None

    def add_song(self, song: dict[str, Any], playlist: str | None = None) -> bool:
        """Şarkıyı listeye ekler; aynı yol zaten varsa eklemez."""
        playlist = playlist or self.current
        dest = self.playlists.setdefault(playlist, [])
        if any(os.path.normpath(s["path"]) == os.path.normpath(song["path"]) for s in dest):
            return False
        dest.append(song)
        return True

    @staticmethod
    def collect_music_folder() -> list[tuple[str, list[dict[str, Any]]]]:
        """~/Music altını tarar (SALT dosya sistemi; kütüphaneyi değiştirmez).

        Her alt klasör -> (liste adı, şarkılar). İş parçacığında güvenle çağrılır.
        JustMusic veri klasörü hariç tutulur.
        """
        root = config.MUSIC_DIR
        if not root.exists():
            return []
        exclude = {config.BASE_DIR.name.lower()}
        result: list[tuple[str, list[dict[str, Any]]]] = []
        try:
            entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return []

        for entry in entries:
            if not entry.is_dir() or entry.name.lower() in exclude:
                continue
            try:
                files = [p for p in entry.rglob("*")
                         if p.is_file() and p.suffix.lower() in config.AUDIO_EXTENSIONS]
            except OSError:
                continue
            if not files:
                continue
            songs = [make_song(str(f)) for f in sorted(files, key=lambda p: p.name.lower())]
            result.append((entry.name, songs))

        try:
            root_files = [p for p in root.iterdir()
                          if p.is_file() and p.suffix.lower() in config.AUDIO_EXTENSIONS]
        except OSError:
            root_files = []
        if root_files:
            songs = [make_song(str(f)) for f in sorted(root_files, key=lambda p: p.name.lower())]
            result.append(("🎧 Müzik Klasörüm", songs))
        return result

    def merge_scanned(self, collected: list[tuple[str, list[dict[str, Any]]]]) -> tuple[int, int]:
        """collect_music_folder() sonucunu kütüphaneye işler (ana iş parçacığı)."""
        added = 0
        new_pl = 0
        for name, songs in collected:
            if name not in self.playlists:
                self.playlists[name] = []
                new_pl += 1
            for song in songs:
                if self.add_song(song, name):
                    added += 1
        return (added, new_pl)

    def set_favorite(self, song: dict[str, Any], value: bool) -> None:
        song["favorite"] = value
        favs = self.playlists.setdefault(config.FAVORITES_PLAYLIST, [])
        exists = next((s for s in favs if s.get("id") == song.get("id")
                       or os.path.normpath(s["path"]) == os.path.normpath(song["path"])), None)
        if value and not exists:
            favs.append(song)  # kopya değil referans -> künye/play_count senkron kalır
        elif not value and exists:
            favs.remove(exists)
        # Diğer listelerdeki aynı parçanın kalp durumunu da eşitle
        for name, songs in self.playlists.items():
            if name == config.FAVORITES_PLAYLIST:
                continue
            for s in songs:
                if os.path.normpath(s["path"]) == os.path.normpath(song["path"]):
                    s["favorite"] = value
