"""Discord Rich Presence — çalan parçayı Discord profilinde gösterir (opsiyonel).

`pypresence` gerektirir (opsiyonel bağımlılık) ve bir Discord **Application Client
ID** ister (https://discord.com/developers/applications → yeni uygulama → ID kopyala).
Discord masaüstü uygulaması açık değilse ya da Client ID verilmemişse sessizce devre
dışı kalır — çağıran taraf her zaman güvenle çağırabilir.

Görsellerin (logo/play/pause) görünmesi için aynı Discord uygulamasının
"Rich Presence → Art Assets" bölümüne bu anahtarlarla resim yüklenmelidir; anahtar
yoksa yalnız metin görünür (hata olmaz).
"""

from __future__ import annotations

import threading
import time


def pypresence_available() -> bool:
    try:
        import pypresence  # noqa: F401
        return True
    except Exception:
        return False


class DiscordPresence:
    """İş parçacığına duyarlı, hataya dayanıklı Discord RPC sarmalayıcısı."""

    def __init__(self, client_id: str = "") -> None:
        self.client_id = (client_id or "").strip()
        self._rpc = None
        self._connected = False
        self._enabled = False
        self._lock = threading.Lock()
        self._last_push = 0.0
        self._last_key = None

    # ------------------------------------------------------------------ ayar
    def set_client_id(self, cid: str) -> None:
        cid = (cid or "").strip()
        if cid != self.client_id:
            self.client_id = cid
            self._disconnect()
            if self._enabled:
                self._ensure()

    def enable(self) -> None:
        self._enabled = True
        self._ensure()

    def disable(self) -> None:
        self._enabled = False
        with self._lock:
            rpc = self._rpc
        if rpc is not None:
            try:
                rpc.clear()
            except Exception:
                pass
        self._disconnect()

    def close(self) -> None:
        self.disable()

    # -------------------------------------------------------------- bağlantı
    def _disconnect(self) -> None:
        with self._lock:
            rpc = self._rpc
            self._rpc = None
            self._connected = False
            self._last_key = None
        if rpc is not None:
            try:
                rpc.close()
            except Exception:
                pass

    def _ensure(self) -> bool:
        if self._connected and self._rpc is not None:
            return True
        if not self._enabled or not self.client_id:
            return False
        # Discord IPC handshake bloklayabilir -> arka planda bağlan
        threading.Thread(target=self._connect_worker,
                         args=(self.client_id,), daemon=True).start()
        return False

    def _connect_worker(self, cid: str) -> None:
        try:
            from pypresence import Presence
        except Exception:
            return
        rpc = None
        try:
            rpc = Presence(cid)
            rpc.connect()
        except Exception:
            # Discord açık değil / geçersiz ID -> yarım kalan bağlantıyı kapat
            if rpc is not None:
                try:
                    rpc.close()
                except Exception:
                    pass
            return
        with self._lock:
            if cid != self.client_id or not self._enabled:
                try:
                    rpc.close()
                except Exception:
                    pass
                return
            self._rpc = rpc
            self._connected = True
            self._last_key = None

    # ------------------------------------------------------------ güncelleme
    def update(self, title: str, artist: str, playing: bool,
               position: float = 0.0, duration: float = 0.0,
               large_text: str = "Just Music Premium") -> None:
        """Çalan parçayı yayınlar. Devre dışı/bağlanmamışsa sessizce döner."""
        if not self._enabled or not self.client_id:
            return
        if not self._connected:
            self._ensure()
            return
        # aşırı istek engeli (Discord ~5/20s sınırlı); parça değişince hemen güncelle
        key = (title, artist, bool(playing), int(max(0.0, position) // 5))
        now = time.time()
        if key == self._last_key and (now - self._last_push) < 15:
            return
        self._last_key = key
        self._last_push = now

        kwargs = {
            "details": (title or "Bilinmeyen parça")[:128],
            "large_image": "logo",
            "large_text": large_text[:128],
        }
        if artist:
            kwargs["state"] = artist[:128]
        if playing and duration and duration > 0:
            start = int(now - max(0.0, position))
            kwargs["start"] = start
            kwargs["end"] = int(start + duration)
            kwargs["small_image"] = "play"
            kwargs["small_text"] = "Çalıyor"
        else:
            kwargs["small_image"] = "pause"
            kwargs["small_text"] = "Duraklatıldı"

        with self._lock:
            rpc = self._rpc
        if rpc is None:
            return
        try:
            rpc.update(**kwargs)
        except Exception:
            self._disconnect()

    def clear(self) -> None:
        with self._lock:
            rpc = self._rpc
        if rpc is not None:
            try:
                rpc.clear()
            except Exception:
                pass
        self._last_key = None
