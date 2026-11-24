"""xmap-studio — metà agente del plugin Hermes.

Registra gli strumenti di XMap Studio come tool `xmap_<nome>`. Ogni chiamata
diventa una richiesta per Hermes Desktop sul computer dell'utente, che la gira
all'app aperta (WebSocket su 127.0.0.1, vedi docs/MCP.md di XMap Studio) e
manda indietro l'esito. Questo processo non tocca mai file di mappe.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import re
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

PLUGIN_ID = "xmap-studio"
TOOLSET = "xmap-studio"
TOOL_PREFIX = "xmap_"
#: Tempo per cui un Hermes Desktop deve prendere in carico la chiamata.
CLAIM_TIMEOUT_SECONDS = 15.0
#: Poco più di quanto XMap concede a una chiamata (120 s), come il bridge MCP.
CALL_TIMEOUT_SECONDS = 130.0

NOT_CONNECTED = "XMap non è collegato: apri Hermes Desktop e XMap sul portatile."
XMAP_CLOSED = (
    "Hermes Desktop è collegato ma XMap Studio no: apri XMap Studio e accendi "
    "Impostazioni › Hermes, poi controlla porta e token nelle impostazioni del plugin."
)


def _load_bus():
    name = "_xmap_studio_bus_module"
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("bus.py"))
        if spec is None or spec.loader is None:
            raise RuntimeError("bus.py non trovato accanto a __init__.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module.get_bus()


def cached_catalog_path() -> Path:
    """Dove la route /catalog conserva l'ultimo catalogo mandato da XMap Studio."""
    try:
        from hermes_constants import get_hermes_home

        home = Path(get_hermes_home())
    except Exception:
        home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    return home / "xmap-studio" / "catalog.json"


def load_catalog() -> dict:
    """Catalogo dell'ultimo XMap collegato, se c'è; altrimenti la copia nel pacchetto."""
    for path in (cached_catalog_path(), Path(__file__).with_name("catalog.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("tools"), list):
                return data
        except FileNotFoundError:
            continue
        except Exception:
            logger.warning("xmap-studio: catalogo illeggibile in %s", path, exc_info=True)
    return {"instructions": "", "tools": []}


def _prefix_names(text: str, names: list[str]) -> str:
    """I testi del catalogo citano gli strumenti per nome MCP (read_map): qui si chiamano xmap_read_map."""
    if not names:
        return text
    pattern = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")(?![\w])")
    return pattern.sub(lambda m: TOOL_PREFIX + m.group(1), text)


def tool_schemas(catalog: dict) -> list[tuple[str, str, dict]]:
    """(nome MCP, nome Hermes, schema) per ogni strumento valido del catalogo."""
    tools = [t for t in catalog.get("tools", []) if isinstance(t, dict) and isinstance(t.get("name"), str)]
    names = [t["name"] for t in tools]
    instructions = _prefix_names(str(catalog.get("instructions") or ""), names)
    out = []
    for tool in tools:
        name = tool["name"]
        description = _prefix_names(str(tool.get("description") or ""), names)
        # Le istruzioni d'uso (MCP le dà una volta sola) vanno sugli strumenti da cui si parte.
        if name in ("list_maps", "read_map") and instructions:
            description = f"{description}\n\n{instructions}"
        parameters = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {"type": "object", "properties": {}}
        out.append((name, TOOL_PREFIX + name, {"name": TOOL_PREFIX + name, "description": f"XMap Studio — {description}", "parameters": parameters}))
    return out


def _error(message: str) -> str:
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)


def make_handler(bus, mcp_name: str):
    def handler(args: dict, **kwargs) -> str:
        try:
            if not bus.ready():
                return _error(XMAP_CLOSED if bus.alive() else NOT_CONNECTED)
            call = bus.submit(mcp_name, dict(args or {}))
            try:
                from hermes_cli.plugin_events import broadcast_plugin_event

                broadcast_plugin_event(PLUGIN_ID, "call", call.public())
            except Exception:
                # Resta il long-poll del desktop: l'evento è solo la via più rapida.
                logger.warning("xmap-studio: evento non inviato", exc_info=True)
            if not call.claimed.wait(CLAIM_TIMEOUT_SECONDS):
                bus.abandon(call, "Nessun Hermes Desktop ha preso la richiesta.")
                return _error(f"{NOT_CONNECTED} (nessun Hermes Desktop ha risposto entro {int(CLAIM_TIMEOUT_SECONDS)} s)")
            if not call.done.wait(CALL_TIMEOUT_SECONDS):
                bus.abandon(call, "XMap Studio non ha risposto in tempo.")
                return _error("XMap Studio non ha risposto in tempo.")
            if call.ok:
                return json.dumps({"ok": True, "result": call.text}, ensure_ascii=False)
            return _error(call.error or "Errore sconosciuto da XMap Studio.")
        except Exception as exc:  # un handler non deve mai sollevare
            logger.exception("xmap-studio: %s fallito", mcp_name)
            return _error(f"Chiamata a XMap Studio non riuscita: {exc}")

    return handler


def register(ctx):
    bus = _load_bus()
    for mcp_name, hermes_name, schema in tool_schemas(load_catalog()):
        ctx.register_tool(name=hermes_name, toolset=TOOLSET, schema=schema, handler=make_handler(bus, mcp_name))
