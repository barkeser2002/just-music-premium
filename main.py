"""Just Music Premium — QtWebEngine giriş noktası."""

from __future__ import annotations

import sys

from PyQt6.QtCore import QEvent, QObject, QUrl
from PyQt6.QtWebEngineCore import QWebEngineUrlScheme

from justmusic import config


def _register_scheme() -> None:
    """app:// şemasını QApplication'DAN ÖNCE kaydeder."""
    scheme = QWebEngineUrlScheme(config.SCHEME)
    scheme.setSyntax(QWebEngineUrlScheme.Syntax.Host)
    # LocalScheme YOK: sayfa "secure" origin olur -> uzaktan (ytimg) kapaklar yüklenir
    scheme.setFlags(
        QWebEngineUrlScheme.Flag.SecureScheme
        | QWebEngineUrlScheme.Flag.LocalAccessAllowed
        | QWebEngineUrlScheme.Flag.CorsEnabled
    )
    QWebEngineUrlScheme.registerScheme(scheme)


_register_scheme()


class DragDropFilter(QObject):
    """Pencereye bırakılan ses dosyalarını yakalar (web view'e gitmeden)."""

    def __init__(self, bridge) -> None:
        super().__init__()
        self.bridge = bridge

    def eventFilter(self, obj, event) -> bool:  # noqa: N802
        et = event.type()
        if et in (QEvent.Type.DragEnter, QEvent.Type.DragMove):
            md = event.mimeData()
            if md and md.hasUrls():
                event.acceptProposedAction()
                return True
        elif et == QEvent.Type.Drop:
            md = event.mimeData()
            if md and md.hasUrls():
                paths = [u.toLocalFile() for u in md.urls() if u.toLocalFile()]
                if paths:
                    self.bridge.import_paths(paths)
                event.acceptProposedAction()
                return True
        return False


def main() -> int:
    from PyQt6.QtGui import QIcon
    from PyQt6.QtWebChannel import QWebChannel
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWidgets import QApplication, QMainWindow

    from justmusic.bridge import Bridge
    from justmusic.scheme import AppSchemeHandler, configure_page

    config.ensure_dirs()
    app = QApplication(sys.argv)
    app.setApplicationName(config.APP_NAME)
    if config.LOGO_PNG.exists():
        app.setWindowIcon(QIcon(str(config.LOGO_PNG)))

    class MainWindow(QMainWindow):
        def __init__(self) -> None:
            super().__init__()
            self.setWindowTitle(config.APP_NAME)
            self.resize(1460, 920)
            self.setMinimumSize(900, 600)  # küçük ekran: responsive CSS devreye girsin
            self._bridge = None

        def closeEvent(self, event):  # noqa: N802
            if self._bridge:
                self._bridge.shutdown()
            super().closeEvent(event)

    win = MainWindow()
    view = QWebEngineView(win)
    handler = AppSchemeHandler(view)
    view.page().profile().installUrlSchemeHandler(config.SCHEME, handler)
    configure_page(view.page())

    bridge = Bridge(win, win)
    win._bridge = bridge
    channel = QWebChannel(view.page())
    channel.registerObject("bridge", bridge)
    view.page().setWebChannel(channel)

    drop_filter = DragDropFilter(bridge)
    app.installEventFilter(drop_filter)

    win.setCentralWidget(view)
    view.load(QUrl("app://app/index.html"))
    win.show()

    exit_code = app.exec()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
