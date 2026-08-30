"""Lotus Colour Automation frontend companion."""

from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web

from homeassistant.components.frontend import (
    DATA_EXTRA_MODULE_URL,
    add_extra_js_url,
    remove_extra_js_url,
)
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

DOMAIN = "lotus_automation_monitor"
VERSION = "0.2.13"
FRONTEND_DIR = Path(__file__).parent / "frontend"
OVERLAY_FILE = FRONTEND_DIR / "overlay.js"
BOOTSTRAP_FILE = FRONTEND_DIR / "bootstrap.js"
RUNTIME_FILE = FRONTEND_DIR / "runtime.js"

OVERLAY_PATH = f"/{DOMAIN}/overlay.js"
BOOTSTRAP_PATH = f"/{DOMAIN}/bootstrap.js"
RUNTIME_PATH = f"/{DOMAIN}/runtime.js"
# A unique URL per release avoids reusing a module/service-worker cache entry.
# The response body itself is the complete runtime: there is no secondary import.
OVERLAY_IMPORT_URL = f"{OVERLAY_PATH}?v={VERSION}"

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)
LOGGER = logging.getLogger(__name__)


class _NoCacheJavascriptView(HomeAssistantView):
    """Serve a JavaScript file from disk on every request."""

    requires_auth = False
    file_path: Path

    async def get(self, request: web.Request) -> web.Response:
        try:
            text = self.file_path.read_text(encoding="utf-8")
        except OSError as err:
            return web.Response(
                text=f"/* Lotus Colour Automation: resource unavailable: {err!s} */",
                status=503,
                content_type="application/javascript",
                headers={"Cache-Control": "no-store"},
            )
        return web.Response(
            text=text,
            content_type="application/javascript",
            charset="utf-8",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
                "X-Lotus-Automation-Monitor-Version": VERSION,
            },
        )


class LotusOverlayView(_NoCacheJavascriptView):
    url = OVERLAY_PATH
    name = f"{DOMAIN}:overlay"
    file_path = OVERLAY_FILE


class LotusBootstrapCompatibilityView(_NoCacheJavascriptView):
    """Compatibility route for browsers/Core sessions from 0.2.7-0.2.9."""

    url = BOOTSTRAP_PATH
    name = f"{DOMAIN}:bootstrap"
    file_path = BOOTSTRAP_FILE


class LotusRuntimeCompatibilityView(_NoCacheJavascriptView):
    """Compatibility route for browsers/Core sessions from 0.2.7-0.2.9."""

    url = RUNTIME_PATH
    name = f"{DOMAIN}:runtime"
    file_path = RUNTIME_FILE


def _purge_old_lotus_urls(hass: HomeAssistant) -> list[str]:
    """Remove every previous Lotus frontend module URL known by Home Assistant."""
    manager = hass.data.get(DATA_EXTRA_MODULE_URL)
    if manager is None:
        return []

    removed: list[str] = []
    for url in tuple(manager.urls):
        if f"/{DOMAIN}/" not in url:
            continue
        remove_extra_js_url(hass, url)
        removed.append(url)
    return removed


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register one complete, versioned frontend module."""
    if not OVERLAY_FILE.exists():
        LOGGER.warning("Surcouche frontend Lotus introuvable: %s", OVERLAY_FILE)
        return True

    hass.http.register_view(LotusOverlayView)
    # Keep the former routes alive during the migration. They are not registered
    # as frontend modules anymore, but an already-open frontend may still request them.
    if BOOTSTRAP_FILE.exists():
        hass.http.register_view(LotusBootstrapCompatibilityView)
    if RUNTIME_FILE.exists():
        hass.http.register_view(LotusRuntimeCompatibilityView)

    removed = _purge_old_lotus_urls(hass)
    add_extra_js_url(hass, OVERLAY_IMPORT_URL)

    manager = hass.data.get(DATA_EXTRA_MODULE_URL)
    active_urls = sorted(manager.urls) if manager is not None else []
    LOGGER.info(
        "Lotus Colour Automation %s: module unique enregistré %s; anciennes URL supprimées: %s; URL actives: %s",
        VERSION,
        OVERLAY_IMPORT_URL,
        removed or "aucune",
        active_urls,
    )
    return True
