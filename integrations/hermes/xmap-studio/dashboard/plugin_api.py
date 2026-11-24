"""xmap-studio — route usate dalla metà desktop, su /api/plugins/xmap-studio/.

Girano nel processo a cui è collegato Hermes Desktop; ogni route è async e le
attese passano da asyncio.to_thread, così il loop del gateway non si blocca.

  GET  /poll?client=…&xmap=0|1&version=…&wait=20   presenza + long-poll delle chiamate
  POST /claim   {id, client}                       prende in carico una chiamata (vince il primo)
  POST /result  {id, client, ok, text?, error?}    esito della chiamata
  POST /catalog {client, catalog}                  catalogo di XMap, per il prossimo avvio
  GET  /status                                     diagnostica
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

from fastapi import APIRouter, Body

PLUGIN_DIR = Path(__file__).resolve().parent.parent
MAX_TEXT_CHARS = 8 * 1024 * 1024
MAX_CATALOG_CHARS = 1024 * 1024


def _load(name: str, filename: str):
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / filename)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"{filename} non trovato")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module


bus = _load("_xmap_studio_bus_module", "bus.py").get_bus()
router = APIRouter()


def _client(value: object) -> str:
    text = str(value or "")[:64]
    if not text:
        raise ValueError("manca il client")
    return text


@router.get("/poll")
async def poll(client: str = "", xmap: int = 0, version: str = "", wait: float = 20.0):
    try:
        name = _client(client)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    bus.seen(name, bool(xmap), version[:32] or None)
    # Un desktop senza XMap collegato si fa vedere ma non riceve chiamate: non saprebbe eseguirle.
    if not xmap:
        return {"ok": True, "calls": []}
    calls = await asyncio.to_thread(bus.wait_unclaimed, max(0.0, min(float(wait), 25.0)))
    return {"ok": True, "calls": [c.public() for c in calls]}


@router.post("/claim")
async def claim(body: dict = Body(...)):
    ok, reason = bus.claim(str(body.get("id", "")), str(body.get("client", "")))
    return {"ok": ok, "reason": reason}


@router.post("/result")
async def result(body: dict = Body(...)):
    ok = body.get("ok") is True
    text = body.get("text") if isinstance(body.get("text"), str) else ""
    error = body.get("error") if isinstance(body.get("error"), str) else ""
    if len(text) > MAX_TEXT_CHARS:
        ok, text, error = False, "", "Risposta di XMap Studio troppo lunga."
    done, reason = bus.complete(str(body.get("id", "")), str(body.get("client", "")), ok, text, error[:4000])
    return {"ok": done, "reason": reason}


@router.post("/catalog")
async def catalog(body: dict = Body(...)):
    data = body.get("catalog")
    if not isinstance(data, dict) or not isinstance(data.get("tools"), list):
        return {"ok": False, "error": "catalogo non valido"}
    encoded = json.dumps(data, ensure_ascii=False)
    if len(encoded) > MAX_CATALOG_CHARS:
        return {"ok": False, "error": "catalogo troppo grande"}
    bus.catalog = data
    plugin = _load("_xmap_studio_plugin_init", "__init__.py")
    path = plugin.cached_catalog_path()

    def write() -> bool:
        # Scrittura atomica: un catalogo a metà non deve rompere il prossimo avvio.
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = path.read_text(encoding="utf-8") if path.exists() else None
        if previous == encoded:
            return False
        temp = path.with_suffix(".tmp")
        temp.write_text(encoded, encoding="utf-8")
        temp.replace(path)
        return True

    changed = await asyncio.to_thread(write)
    # I tool si registrano all'avvio: un catalogo nuovo vale dalla prossima sessione del gateway.
    return {"ok": True, "changed": changed}


@router.get("/status")
async def status():
    return {"ok": True, **bus.status()}
