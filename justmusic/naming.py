"""MP3 dosya adı temizleme: dağınık dosya adlarını temiz "Sanatçı - Başlık"a çevirir.

Amaç: hem gösterilen adı düzeltmek hem de YouTube kapak aramasını isabetli yapmak.
"""

from __future__ import annotations

import re

# Parantez/köşeli/süslü parantez içi (iç içe değil)
_BRACKETS = re.compile(r"[\(\[\{][^\(\)\[\]\{\}]*[\)\]\}]")

# Açıkça çöp olan kalite/site/etiket kelimeleri (şarkı adını bozmayacak şekilde temkinli)
_JUNK = re.compile(
    r"(?i)\b(?:"
    r"mp3|m4a|flac|wav|wma|aac|opus|"
    r"\d{2,4}\s*kbps|kbps|hq|hd|full\s*hd|4k|1080p|720p|480p|"
    r"lyrics?|lyric\s*video|official\s*(?:music\s*)?video|official\s*audio|"
    r"official\s*video|audio\s*only|visualizer|klip|"
    r"indir|download|bedava|ücretsiz|mobil|dinle|net|com"
    r")\b"
)

_SEPS = (" - ", " – ", " — ", " — ", " _ ")


def clean_title(stem: str) -> str:
    """Dosya adı gövdesini (uzantısız) temiz bir başlığa çevirir."""
    s = stem.strip()
    # baştaki iz/parça numarası: "01." ya da "01 -"
    s = re.sub(r"^\s*\d{1,2}\s*[-.]\s+", "", s)
    # parantez içi etiketleri at
    s = _BRACKETS.sub(" ", s)
    # alt çizgileri boşluğa çevir
    s = re.sub(r"_+", " ", s)
    # çöp kelimeleri at
    s = _JUNK.sub(" ", s)
    # fazla boşluk + baş/son ayraç temizliği
    s = re.sub(r"\s{2,}", " ", s).strip(" -–—_·|")
    return s or stem.strip()


def parse_artist_title(name: str) -> tuple[str, str]:
    """“Sanatçı - Başlık” kalıbını ayırır; bulunamazsa ("", name) döndürür."""
    for sep in _SEPS:
        if sep in name:
            artist, title = name.split(sep, 1)
            artist, title = artist.strip(), title.strip()
            if artist and title:
                return artist, title
    return "", name


def from_filename(stem: str) -> tuple[str, str]:
    """Dosya adından (uzantısız) (sanatçı, başlık) üretir."""
    cleaned = clean_title(stem)
    return parse_artist_title(cleaned)


def search_query(artist: str, title: str) -> str:
    """YouTube kapak araması için sorgu metni."""
    return f"{artist} {title}".strip() if artist else title.strip()
