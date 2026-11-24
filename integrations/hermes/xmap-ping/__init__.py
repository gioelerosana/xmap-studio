"""xmap-ping — metà agente dello spike.

Registra il tool `xmap_ping`: crea una richiesta sul bus condiviso, la annuncia
al desktop su tutti i canali server → desktop disponibili e aspetta che un
desktop la reclami e risponda (via ctx.rest o RPC). Il risultato dice quale
canale ha funzionato.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import sys
import time
from pathlib import Path

logger = logging.getLogger(__name__)

PLUGIN_ID = "xmap-ping"
WAIT_SECONDS = 45.0


def _load_bus():
    # Un solo modulo bus.py per processo, chiunque lo carichi per primo (tool o route):
    # registrato in sys.modules prima di eseguirlo, come richiedono le dataclass.
    name = "_xmap_ping_bus_module"
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("bus.py"))
        if spec is None or spec.loader is None:
            raise RuntimeError("bus.py non trovato")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module.get_bus()


SCHEMA = {
    "name": "xmap_ping",
    "description": (
        "Spike di diagnostica: manda un messaggio al plugin desktop collegato (Hermes Desktop sul portatile) "
        "e riporta per quale canale è arrivata la risposta. Usalo solo quando l'utente chiede di provare xmap-ping."
    ),
    "parameters": {
        "type": "object",
        "properties": {"message": {"type": "string", "description": "Testo da far rimbalzare."}},
        "required": [],
    },
}


def announce(ctx, bus, req, session_id: str | None) -> dict:
    """Annuncia la richiesta su ogni canale server → desktop; riporta cosa è partito."""
    sent: dict = {}
    try:
        from hermes_cli.plugin_events import broadcast_plugin_event

        broadcast_plugin_event(PLUGIN_ID, "request", req.public())
        sent["broadcast_plugin_event"] = "inviato"
    except Exception as exc:
        sent["broadcast_plugin_event"] = f"errore: {exc!r}"
    if ctx is not None and session_id:
        try:
            sent["emit_to_session"] = bool(ctx.emit_to_session(session_id, "request", req.public()))
        except Exception as exc:
            sent["emit_to_session"] = f"errore: {exc!r}"
    else:
        sent["emit_to_session"] = "saltato (nessuna session_id)"
    # Il long-poll GET /pending e il WebSocket /events leggono direttamente il bus.
    bus.log(f"annuncio {req.id[:8]}: {sent}")
    return sent


def register(ctx):
    bus = _load_bus()
    bus.note("register")

    def xmap_ping(args: dict, **kwargs) -> str:
        try:
            bus.note("tool")
            session_id = kwargs.get("session_id") or None
            req = bus.submit("xmap_ping", {"message": str(args.get("message") or "ping")}, origin="tool")
            sent = announce(ctx, bus, req, session_id)
            started = time.time()
            answered = req.done.wait(WAIT_SECONDS)
            out = {
                "answered": answered,
                "waited_ms": round((time.time() - started) * 1000),
                "announced": sent,
                "pid_tool": os.getpid(),
                "bus": {"instance": bus.instance, "pids_by_part": dict(bus.pids)},
                "request": req.status(),
            }
            if not answered:
                out["error"] = (
                    f"Nessun desktop ha risposto entro {int(WAIT_SECONDS)} s. Se pids_by_part non contiene "
                    "'api' con lo stesso pid del tool, le route e il tool girano in processi diversi."
                )
            return json.dumps(out, ensure_ascii=False)
        except Exception as exc:  # un handler non deve mai sollevare
            logger.exception("xmap_ping fallito")
            return json.dumps({"error": f"xmap_ping fallito: {exc!r}"})

    ctx.register_tool(name="xmap_ping", toolset="xmap-ping", schema=SCHEMA, handler=xmap_ping)

    # Percorso alternativo desktop → server: JSON-RPC sul socket principale del gateway
    # (host.request('plugin.xmap-ping.<nome>')), utile se ctx.rest non arrivasse.
    def rpc_ping(params, *, session_id=None, **kwargs):
        bus.note("rpc")
        return {"pong": True, "pid": os.getpid(), "bus_instance": bus.instance, "session_id": session_id}

    def rpc_claim(params, *, session_id=None, **kwargs):
        bus.note("rpc")
        ok, why = bus.claim(str(params.get("id", "")), str(params.get("client", "")), str(params.get("via", "")))
        return {"ok": ok, "reason": why, "pid": os.getpid()}

    def rpc_result(params, *, session_id=None, **kwargs):
        bus.note("rpc")
        ok, why = bus.complete(str(params.get("id", "")), str(params.get("client", "")), params.get("result"))
        return {"ok": ok, "reason": why, "pid": os.getpid()}

    try:
        ctx.register_rpc("ping", rpc_ping)
        ctx.register_rpc("claim", rpc_claim)
        ctx.register_rpc("result", rpc_result)
    except Exception:  # host senza plugin RPC: lo spike lo riporta come canale assente
        logger.warning("xmap-ping: register_rpc non disponibile", exc_info=True)
