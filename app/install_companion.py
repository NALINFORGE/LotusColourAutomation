#!/usr/bin/env python3
"""Install the Home Assistant frontend companion for Lotus Colour Automation."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VERSION = (Path("/VERSION").read_text(encoding="utf-8").strip() if Path("/VERSION").exists() else "0.2.12")
DOMAIN = "lotus_automation_monitor"
SOURCE = Path("/companion/custom_components") / DOMAIN
HA_CONFIG = Path("/homeassistant")
TARGET = HA_CONFIG / "custom_components" / DOMAIN
CONFIG_FILE = HA_CONFIG / "configuration.yaml"
OPTIONS_FILE = Path("/data/options.json")
STATUS_FILE = Path("/data/companion_status.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [lotus_automation_monitor.installer] %(message)s",
)
LOGGER = logging.getLogger(__name__)


def load_options() -> dict[str, Any]:
    defaults = {
        "install_native_overlay": True,
        "auto_register_frontend": True,
    }
    try:
        data = json.loads(OPTIONS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            defaults.update(data)
    except FileNotFoundError:
        pass
    except Exception as exc:
        LOGGER.warning("Impossible de lire options.json: %s", exc)
    return defaults


def write_status(**values: Any) -> None:
    payload = {
        "version": VERSION,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **values,
    }
    STATUS_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def copy_component() -> bool:
    if not SOURCE.exists():
        raise RuntimeError(f"Source du composant absente: {SOURCE}")
    TARGET.parent.mkdir(parents=True, exist_ok=True)

    current_version = None
    try:
        current_version = json.loads((TARGET / "manifest.json").read_text(encoding="utf-8")).get("version")
    except Exception:
        pass

    if TARGET.exists():
        shutil.rmtree(TARGET)
    shutil.copytree(SOURCE, TARGET)
    LOGGER.info("Compagnon frontend %s installé dans %s (ancienne version: %s)", VERSION, TARGET, current_version)
    return current_version != VERSION


def is_registered(text: str) -> bool:
    return bool(re.search(r"(?m)^lotus_automation_monitor[ \t]*:", text))


def register_configuration() -> tuple[bool, str | None]:
    if not CONFIG_FILE.exists():
        return False, "configuration.yaml introuvable"

    text = CONFIG_FILE.read_text(encoding="utf-8")
    if is_registered(text):
        LOGGER.info("Entrée %s déjà présente dans configuration.yaml", DOMAIN)
        return False, None

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = CONFIG_FILE.with_name(f"configuration.yaml.lam-backup-{stamp}")
    shutil.copy2(CONFIG_FILE, backup)

    suffix = "" if text.endswith("\n") else "\n"
    addition = (
        f"{suffix}\n"
        "# Lotus Colour Automation - surcouche native Home Assistant\n"
        f"{DOMAIN}:\n"
    )
    CONFIG_FILE.write_text(text + addition, encoding="utf-8")
    LOGGER.info("Entrée %s ajoutée à configuration.yaml; sauvegarde: %s", DOMAIN, backup.name)
    return True, None


def main() -> int:
    options = load_options()
    if not options.get("install_native_overlay", True):
        LOGGER.info("Installation de la surcouche native désactivée par configuration")
        write_status(
            component_installed=False,
            configuration_registered=False,
            restart_required=False,
            disabled=True,
        )
        return 0

    if not HA_CONFIG.exists():
        message = "Le dossier Home Assistant /homeassistant n'est pas monté"
        LOGGER.error(message)
        write_status(
            component_installed=False,
            configuration_registered=False,
            restart_required=False,
            error=message,
        )
        return 1

    try:
        component_changed = copy_component()
        config_changed = False
        registration_error = None
        if options.get("auto_register_frontend", True):
            config_changed, registration_error = register_configuration()
        else:
            try:
                config_text = CONFIG_FILE.read_text(encoding="utf-8")
                registered = is_registered(config_text)
            except Exception:
                registered = False
            if not registered:
                registration_error = (
                    "Ajoutez manuellement 'lotus_automation_monitor:' dans configuration.yaml"
                )

        try:
            registered_now = is_registered(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            registered_now = False

        write_status(
            component_installed=True,
            configuration_registered=registered_now,
            component_changed=component_changed,
            configuration_changed=config_changed,
            restart_required=bool((component_changed or config_changed) and registered_now),
            warning=registration_error,
        )
        return 0
    except Exception as exc:
        LOGGER.exception("Échec de l'installation du compagnon frontend")
        write_status(
            component_installed=False,
            configuration_registered=False,
            restart_required=False,
            error=str(exc),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
