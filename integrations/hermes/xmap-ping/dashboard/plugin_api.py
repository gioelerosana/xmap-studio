"""xmap-ping — route del backend, montate su /api/plugins/xmap-ping/.

Girano nel processo del gateway a cui è collegato Hermes Desktop. Ogni route è
async e non blocca il loop: le attese passano da asyncio.to_thread.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import time
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

PLUGIN_ID = "xmap-ping"


def _load_bus():
    # Un solo modulo bus.py per processo, chiunque lo carichi per primo (tool o route):
    # registrato in sys.modules prima di eseguirlo, come richiedono le dataclass.
    name = "_xmap_ping_bus_module"
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent.parent / "bus.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("bus.py non trovato")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module.get_bus()


bus = _load_bus()
router = APIRouter()


@router.get("/hello")
async def hello():
    bus.note("api")
    return {"ok": True, "plugin": PLUGIN_ID, "pid": os.getpid(), "bus_instance": bus.instance, "time": time.time()}


@router.post("/echo")
async def echo(body: dict):
    bus.note("api")
    return {"ok": True, "pid": os.getpid(), "received": body}


@router.get("/pending")
async def pending(wait: float = 20.0, client: str = ""):
    """Long-poll: il canale server → desktop che non dipende da eventi né WebSocket."""
    bus.note("api")
    wait = max(0.0, min(wait, 25.0))
    reqs = await asyncio.to_thread(bus.wait_unclaimed, wait)
    return {"requests": [r.public() for r in reqs], "pid": os.getpid()}


@router.post("/claim")
async def claim(body: dict):
    bus.note("api")
    ok, why = bus.claim(str(body.get("id", "")), str(body.get("client", "")), str(body.get("via", "")))
    return {"ok": ok, "reason": why}


@router.post("/result")
async def result(body: dict):
    bus.note("api")
    ok, why = bus.complete(str(body.get("id", "")), str(body.get("client", "")), body.get("result"))
    return {"ok": ok, "reason": why}


@router.post("/trigger")
async def trigger(body: dict):
    """Crea una richiesta senza passare dal modello, per provare il giro server → desktop → server."""
    bus.note("api")
    req = bus.submit("xmap_ping", {"message": str(body.get("message") or "trigger")}, origin="trigger")
    sent = {}
    try:
        from hermes_cli.plugin_events import broadcast_plugin_event

        broadcast_plugin_event(PLUGIN_ID, "request", req.public())
        sent["broadcast_plugin_event"] = "inviato"
    except Exception as exc:
        sent["broadcast_plugin_event"] = f"errore: {exc!r}"
    return {"id": req.id, "announced": sent}


@router.get("/request/{req_id}")
async def request_status(req_id: str):
    req = bus.requests.get(req_id)
    return req.status() if req else {"error": "sconosciuta"}


@router.get("/diag")
async def diag():
    bus.note("api")
    return bus.diag()


@router.websocket("/events")
async def events(ws: WebSocket):
    """Canale ctx.socket: atteso morto con Desktop su remote OAuth (il client non lo apre)."""
    await ws.accept()
    bus.log("WebSocket /events aperto")
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def on_request(req):
        loop.call_soon_threadsafe(queue.put_nowait, req.public())

    bus.listeners.append(on_request)
    try:
        await ws.send_json({"type": "hello", "pid": os.getpid()})
        while True:
            await ws.send_json({"type": "request", "request": await queue.get()})
    except WebSocketDisconnect:
        pass
    finally:
        bus.listeners.remove(on_request)
        bus.log("WebSocket /events chiuso")
