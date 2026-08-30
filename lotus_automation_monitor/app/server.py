#!/usr/bin/env python3
"""Lotus Colour Automation - Home Assistant app."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

VERSION = (Path("/VERSION").read_text(encoding="utf-8").strip() if Path("/VERSION").exists() else "0.2.13")
PORT = 8099
HA_API = "http://supervisor/core/api"
HA_WS = "ws://supervisor/core/websocket"
OPTIONS_PATH = Path("/data/options.json")
STATIC_DIR = Path(__file__).parent / "static"
COMPANION_STATUS_PATH = Path("/data/companion_status.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [lotus_automation_monitor] %(message)s",
)
LOGGER = logging.getLogger(__name__)


def load_options() -> dict[str, Any]:
    defaults = {
        "refresh_interval": 2,
        "show_disabled": True,
        "long_running_seconds": 60,
    }
    try:
        data = json.loads(OPTIONS_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            defaults.update(data)
    except FileNotFoundError:
        pass
    except Exception as exc:  # pragma: no cover - defensive at runtime
        LOGGER.warning("Impossible de lire options.json: %s", exc)
    return defaults


OPTIONS = load_options()
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")


def iso_to_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def seconds_since(value: Any) -> int | None:
    dt = iso_to_datetime(value)
    if not dt:
        return None
    return max(0, int((datetime.now(timezone.utc) - dt).total_seconds()))


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def trace_sort_key(trace: dict[str, Any]) -> str:
    timestamp = trace.get("timestamp") or {}
    return str(timestamp.get("start") or "")


class HomeAssistantClient:
    def __init__(self, token: str) -> None:
        self.token = token
        self.timeout = ClientTimeout(total=12)

    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def get_states(self) -> list[dict[str, Any]]:
        async with ClientSession(timeout=self.timeout) as session:
            async with session.get(f"{HA_API}/states", headers=self.headers()) as response:
                response.raise_for_status()
                payload = await response.json()
                if not isinstance(payload, list):
                    raise RuntimeError("Réponse /api/states inattendue")
                return payload

    async def get_config(self) -> dict[str, Any]:
        async with ClientSession(timeout=self.timeout) as session:
            async with session.get(f"{HA_API}/config", headers=self.headers()) as response:
                response.raise_for_status()
                payload = await response.json()
                if not isinstance(payload, dict):
                    raise RuntimeError("Réponse /api/config inattendue")
                return payload

    async def ws_call_many(self, commands: list[dict[str, Any]]) -> list[Any]:
        if not self.token:
            raise RuntimeError("SUPERVISOR_TOKEN absent")

        results: list[Any] = []
        async with ClientSession(timeout=self.timeout) as session:
            async with session.ws_connect(HA_WS, heartbeat=20) as ws:
                hello = await ws.receive_json()
                if hello.get("type") != "auth_required":
                    raise RuntimeError(f"Handshake WebSocket inattendu: {hello.get('type')}")

                await ws.send_json({"type": "auth", "access_token": self.token})
                auth = await ws.receive_json()
                if auth.get("type") != "auth_ok":
                    raise RuntimeError(auth.get("message") or "Authentification WebSocket refusée")

                next_id = 1
                for command in commands:
                    request = {"id": next_id, **command}
                    await ws.send_json(request)
                    while True:
                        message = await ws.receive()
                        if message.type == WSMsgType.TEXT:
                            data = json.loads(message.data)
                            if data.get("id") != next_id:
                                continue
                            if data.get("type") == "result":
                                if not data.get("success", False):
                                    error = data.get("error") or {}
                                    raise RuntimeError(error.get("message") or str(error) or "Erreur WebSocket")
                                results.append(data.get("result"))
                                break
                        elif message.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                            raise RuntimeError("Connexion WebSocket Home Assistant interrompue")
                    next_id += 1
        return results

    async def list_traces(self) -> dict[str, list[dict[str, Any]]]:
        results = await self.ws_call_many(
            [
                {"type": "trace/list", "domain": "automation"},
                {"type": "trace/list", "domain": "script"},
            ]
        )
        automation = results[0] if len(results) > 0 and isinstance(results[0], list) else []
        script = results[1] if len(results) > 1 and isinstance(results[1], list) else []
        return {"automation": automation, "script": script}

    async def get_trace(self, domain: str, item_id: str, run_id: str) -> dict[str, Any]:
        results = await self.ws_call_many(
            [
                {
                    "type": "trace/get",
                    "domain": domain,
                    "item_id": item_id,
                    "run_id": run_id,
                }
            ]
        )
        if not results or not isinstance(results[0], dict):
            raise RuntimeError("Trace vide ou invalide")
        return results[0]


HA = HomeAssistantClient(TOKEN)


class OverviewCache:
    def __init__(self) -> None:
        self.value: dict[str, Any] | None = None
        self.created = 0.0
        self.lock = asyncio.Lock()

    async def get(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        now = loop.time()
        if self.value is not None and now - self.created < 0.8:
            return self.value
        async with self.lock:
            now = loop.time()
            if self.value is not None and now - self.created < 0.8:
                return self.value
            self.value = await build_overview()
            self.created = loop.time()
            return self.value


CACHE = OverviewCache()


def group_traces(traces_by_domain: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {"automation": {}, "script": {}}
    for domain, traces in traces_by_domain.items():
        for trace in traces:
            item_id = str(trace.get("item_id") or "")
            if not item_id:
                continue
            grouped.setdefault(domain, {}).setdefault(item_id, []).append(trace)
    for domain_values in grouped.values():
        for values in domain_values.values():
            values.sort(key=trace_sort_key, reverse=True)
    return grouped


def entity_trace_candidates(entity_id: str, attrs: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    attr_id = attrs.get("id")
    if attr_id not in (None, ""):
        candidates.append(str(attr_id))
    if "." in entity_id:
        candidates.append(entity_id.split(".", 1)[1])
    return list(dict.fromkeys(candidates))


def select_traces_for_entity(
    domain: str,
    entity_id: str,
    attrs: dict[str, Any],
    grouped: dict[str, dict[str, list[dict[str, Any]]]],
) -> tuple[str, list[dict[str, Any]]]:
    domain_groups = grouped.get(domain, {})
    for candidate in entity_trace_candidates(entity_id, attrs):
        if candidate in domain_groups:
            return candidate, domain_groups[candidate]
    fallback = entity_id.split(".", 1)[1]
    return fallback, []


def build_item(
    state_obj: dict[str, Any],
    grouped: dict[str, dict[str, list[dict[str, Any]]]],
) -> dict[str, Any]:
    entity_id = str(state_obj.get("entity_id") or "")
    domain = entity_id.split(".", 1)[0]
    attrs = state_obj.get("attributes") or {}
    if not isinstance(attrs, dict):
        attrs = {}

    item_id, traces = select_traces_for_entity(domain, entity_id, attrs, grouped)
    latest = traces[0] if traces else None
    running_trace = next((t for t in traces if t.get("state") == "running"), None)
    current = safe_int(attrs.get("current"), 0)
    state = str(state_obj.get("state") or "unknown")

    is_running = current > 0 or running_trace is not None or (domain == "script" and state == "on")
    disabled = domain == "automation" and state == "off" and not is_running
    unavailable = state in {"unavailable", "unknown"}

    active_trace = running_trace if running_trace is not None else latest
    active_start = ((active_trace or {}).get("timestamp") or {}).get("start")
    duration = seconds_since(active_start) if is_running else None
    long_running = bool(is_running and duration is not None and duration >= safe_int(OPTIONS.get("long_running_seconds"), 60))

    latest_error = None
    if latest and latest.get("state") != "running":
        latest_error = latest.get("error")

    if unavailable:
        status = "unavailable"
    elif disabled:
        status = "disabled"
    elif is_running and long_running:
        status = "long_running"
    elif is_running:
        status = "running"
    elif latest_error:
        status = "error"
    else:
        status = "idle"

    recent_traces = []
    for trace in traces[:5]:
        timestamp = trace.get("timestamp") or {}
        recent_traces.append(
            {
                "run_id": trace.get("run_id"),
                "state": trace.get("state"),
                "last_step": trace.get("last_step"),
                "script_execution": trace.get("script_execution"),
                "error": trace.get("error"),
                "not_triggered": bool(trace.get("not_triggered", False)),
                "start": timestamp.get("start"),
                "finish": timestamp.get("finish"),
            }
        )

    return {
        "entity_id": entity_id,
        "domain": domain,
        "item_id": item_id,
        "name": attrs.get("friendly_name") or entity_id,
        "entity_state": state,
        "status": status,
        "current": current,
        "mode": attrs.get("mode"),
        "max": attrs.get("max"),
        "last_triggered": attrs.get("last_triggered"),
        "last_changed": state_obj.get("last_changed"),
        "duration_seconds": duration,
        "long_running": long_running,
        "last_step": (active_trace or {}).get("last_step"),
        "latest_error": latest_error,
        "active_run_id": (active_trace or {}).get("run_id"),
        "traces": recent_traces,
    }


async def build_overview() -> dict[str, Any]:
    warnings: list[str] = []
    states = await HA.get_states()

    try:
        traces_by_domain = await HA.list_traces()
    except Exception as exc:
        LOGGER.warning("Traces indisponibles: %s", exc)
        warnings.append(f"Traces indisponibles : {exc}")
        traces_by_domain = {"automation": [], "script": []}

    grouped = group_traces(traces_by_domain)
    items: list[dict[str, Any]] = []
    for state_obj in states:
        entity_id = str(state_obj.get("entity_id") or "")
        if not (entity_id.startswith("automation.") or entity_id.startswith("script.")):
            continue
        item = build_item(state_obj, grouped)
        if item["status"] == "disabled" and not bool(OPTIONS.get("show_disabled", True)):
            continue
        items.append(item)

    status_priority = {
        "error": 0,
        "long_running": 1,
        "running": 2,
        "unavailable": 3,
        "idle": 4,
        "disabled": 5,
    }
    items.sort(key=lambda x: (status_priority.get(x["status"], 9), str(x["name"]).casefold()))

    counts = {
        "total": len(items),
        "running": sum(1 for x in items if x["status"] in {"running", "long_running"}),
        "errors": sum(1 for x in items if x["status"] == "error"),
        "disabled": sum(1 for x in items if x["status"] == "disabled"),
        "automations": sum(1 for x in items if x["domain"] == "automation"),
        "scripts": sum(1 for x in items if x["domain"] == "script"),
    }

    return {
        "version": VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "refresh_interval": safe_int(OPTIONS.get("refresh_interval"), 2),
        "long_running_seconds": safe_int(OPTIONS.get("long_running_seconds"), 60),
        "counts": counts,
        "warnings": warnings,
        "items": items,
    }


def resolve_config_node(config: Any, path: str) -> Any:
    """Best effort resolver from a Home Assistant trace path to its config node."""
    node = config
    if not isinstance(path, str):
        return None

    aliases = {
        "action": ("action", "actions", "sequence"),
        "actions": ("actions", "action", "sequence"),
        "condition": ("condition", "conditions"),
        "conditions": ("conditions", "condition"),
        "trigger": ("trigger", "triggers"),
        "triggers": ("triggers", "trigger"),
    }

    for token in path.split("/"):
        if token == "":
            continue
        if isinstance(node, list):
            try:
                node = node[int(token)]
                continue
            except (ValueError, IndexError):
                return None
        if isinstance(node, dict):
            if token in node:
                node = node[token]
                continue
            found = False
            for alt in aliases.get(token, (token,)):
                if alt in node:
                    node = node[alt]
                    found = True
                    break
            if found:
                continue
            return None
        return None
    return node


def describe_node(node: Any, path: str) -> str:
    if isinstance(node, dict):
        alias = node.get("alias")
        if alias:
            return str(alias)
        action_name = node.get("action") or node.get("service")
        if action_name:
            return str(action_name)
        if "delay" in node:
            return f"Délai : {node.get('delay')}"
        if "wait_template" in node:
            return "Attente d'un modèle"
        if "wait_for_trigger" in node:
            return "Attente d'un déclencheur"
        if "choose" in node:
            return "Choix conditionnel"
        if "if" in node:
            return "Condition si / alors"
        if "repeat" in node:
            return "Répétition"
        if "condition" in node:
            return f"Condition : {node.get('condition')}"
        if "event" in node:
            return f"Événement : {node.get('event')}"
        if "scene" in node:
            return f"Scène : {node.get('scene')}"
        if "device_id" in node:
            return "Action sur un appareil"
    return path


def flatten_trace(trace: dict[str, Any]) -> list[dict[str, Any]]:
    trace_map = trace.get("trace") or {}
    config = trace.get("config")
    last_step = trace.get("last_step")
    run_state = trace.get("state")
    top_error = trace.get("error")

    rows: list[dict[str, Any]] = []
    if not isinstance(trace_map, dict):
        return rows

    for path, events in trace_map.items():
        if not isinstance(events, list) or not events:
            continue
        event = events[-1] if isinstance(events[-1], dict) else {}
        error = event.get("error")
        template_errors = event.get("template_errors") or []
        if error or template_errors:
            status = "error"
        elif top_error and path == last_step:
            status = "error"
        elif run_state == "running" and path == last_step:
            status = "current"
        else:
            status = "done"

        node = resolve_config_node(config, str(path))
        rows.append(
            {
                "path": path,
                "label": describe_node(node, str(path)),
                "status": status,
                "timestamp": event.get("timestamp"),
                "error": error,
                "template_errors": template_errors,
                "result": event.get("result"),
                "child_id": event.get("child_id"),
            }
        )
    return rows


@web.middleware
async def ingress_only(request: web.Request, handler):
    # Ingress arrives from 172.30.32.2. Loopback is kept for container health checks.
    allowed = {"172.30.32.2", "127.0.0.1", "::1"}
    remote = request.remote
    if remote not in allowed:
        LOGGER.warning("Requête refusée hors Ingress depuis %s", remote)
        raise web.HTTPForbidden(text="Ingress Home Assistant requis")
    return await handler(request)


async def index(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


async def health(_: web.Request) -> web.Response:
    return web.json_response({"ok": True, "version": VERSION})


async def api_overview(_: web.Request) -> web.Response:
    try:
        payload = await CACHE.get()
        return web.json_response(payload)
    except Exception as exc:
        LOGGER.exception("Impossible de construire la vue d'ensemble")
        return web.json_response({"error": str(exc)}, status=502)

async def api_companion(_: web.Request) -> web.Response:
    status: dict[str, Any] = {}
    try:
        raw = json.loads(COMPANION_STATUS_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            status.update(raw)
    except FileNotFoundError:
        status["component_installed"] = False
    except Exception as exc:
        status["status_error"] = str(exc)

    loaded = False
    try:
        config = await HA.get_config()
        components = config.get("components") or []
        loaded = "lotus_automation_monitor" in components
    except Exception as exc:
        status["core_check_error"] = str(exc)

    status["loaded"] = loaded
    status["restart_required"] = bool(
        status.get("component_installed")
        and status.get("configuration_registered")
        and not loaded
    )
    return web.json_response(status)


async def api_trace(request: web.Request) -> web.Response:
    domain = request.match_info["domain"]
    item_id = request.match_info["item_id"]
    run_id = request.match_info["run_id"]
    if domain not in {"automation", "script"}:
        raise web.HTTPBadRequest(text="Domaine invalide")
    try:
        trace = await HA.get_trace(domain, item_id, run_id)
        return web.json_response(
            {
                "trace": {
                    "domain": trace.get("domain"),
                    "item_id": trace.get("item_id"),
                    "run_id": trace.get("run_id"),
                    "state": trace.get("state"),
                    "script_execution": trace.get("script_execution"),
                    "timestamp": trace.get("timestamp"),
                    "last_step": trace.get("last_step"),
                    "error": trace.get("error"),
                },
                "steps": flatten_trace(trace),
            }
        )
    except Exception as exc:
        LOGGER.warning("Lecture de trace impossible %s.%s/%s: %s", domain, item_id, run_id, exc)
        return web.json_response({"error": str(exc)}, status=502)


def create_app() -> web.Application:
    app = web.Application(middlewares=[ingress_only])
    app.router.add_get("/", index)
    app.router.add_get("/health", health)
    app.router.add_get("/api/overview", api_overview)
    app.router.add_get("/api/companion", api_companion)
    app.router.add_get("/api/trace/{domain}/{item_id}/{run_id}", api_trace)
    app.router.add_static("/static/", STATIC_DIR, show_index=False)
    return app


if __name__ == "__main__":
    if not TOKEN:
        LOGGER.error("SUPERVISOR_TOKEN absent : l'accès à Home Assistant échouera")
    LOGGER.info(
        "Lotus Colour Automation %s - port %s - actualisation %ss",
        VERSION,
        PORT,
        OPTIONS.get("refresh_interval", 2),
    )
    web.run_app(create_app(), host="0.0.0.0", port=PORT, print=None)
