"""Test della metà agente: tool, coda e route con desktop finti.

Serve FastAPI; i moduli di Hermes no (senza, l'evento non parte e resta il
long-poll, che è quello che i test usano). Dalla root del repository:

    uvx --with fastapi --with httpx pytest -p no:cacheprovider integrations/hermes/xmap-studio/tests
"""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def plugin(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for name in [k for k in sys.modules if k.startswith("_xmap_studio")]:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location("xmap_studio_pkg", ROOT / "__init__.py")
    pkg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pkg)
    tools = {}

    class Ctx:
        def register_tool(self, name, toolset, schema, handler):
            tools[name] = (schema, handler)

    pkg.register(Ctx())
    spec_api = importlib.util.spec_from_file_location("xmap_studio_api", ROOT / "dashboard" / "plugin_api.py")
    api = importlib.util.module_from_spec(spec_api)
    spec_api.loader.exec_module(api)
    app = fastapi.FastAPI()
    app.include_router(api.router)
    pkg.CLAIM_TIMEOUT_SECONDS = 2
    pkg.CALL_TIMEOUT_SECONDS = 2
    return pkg, tools, api.bus, TestClient(app)


def run_desktop(client, name, answer=True):
    """Un desktop finto: un giro di long-poll, claim e (se `answer`) risultato."""
    calls = client.get("/poll", params={"client": name, "xmap": 1, "version": "1", "wait": 3}).json()["calls"]
    for call in calls:
        if client.post("/claim", json={"id": call["id"], "client": name}).json()["ok"] and answer:
            client.post("/result", json={"id": call["id"], "client": name, "ok": True, "text": json.dumps(call)})


def test_registra_gli_strumenti_del_catalogo_con_il_prefisso(plugin):
    _pkg, tools, _bus, _client = plugin
    assert "xmap_read_map" in tools and "xmap_save_map" in tools
    description = tools["xmap_read_map"][0]["description"]
    # Le istruzioni citano gli strumenti con il nome Hermes, mai quello MCP nudo.
    assert "xmap_save_map" in description
    assert "save_map" not in description.replace("xmap_save_map", "")


def test_senza_desktop_risponde_subito_con_un_errore_chiaro(plugin):
    pkg, tools, _bus, _client = plugin
    started = time.time()
    out = json.loads(tools["xmap_read_map"][1]({}))
    assert out == {"ok": False, "error": pkg.NOT_CONNECTED}
    assert time.time() - started < 0.5


def test_desktop_senza_xmap_dice_di_aprire_xmap(plugin):
    pkg, tools, _bus, client = plugin
    assert client.get("/poll", params={"client": "A", "xmap": 0}).json() == {"ok": True, "calls": []}
    assert json.loads(tools["xmap_read_map"][1]({}))["error"] == pkg.XMAP_CLOSED


def test_due_desktop_la_chiamata_si_esegue_una_volta(plugin):
    _pkg, tools, bus, client = plugin
    client.get("/poll", params={"client": "A", "xmap": 1, "wait": 0})
    threads = [threading.Thread(target=run_desktop, args=(client, n)) for n in ("A", "B")]
    for t in threads:
        t.start()
    time.sleep(0.2)
    out = json.loads(tools["xmap_get_topic"][1]({"topicId": "t1", "map": 2}))
    for t in threads:
        t.join()
    assert out["ok"] is True
    echoed = json.loads(out["result"])
    assert echoed["tool"] == "get_topic" and echoed["args"] == {"topicId": "t1", "map": 2}
    call = next(iter(bus.calls.values()))
    assert call.claimed_by in ("A", "B")


def test_xmap_che_non_risponde_scade_e_il_risultato_tardivo_si_scarta(plugin):
    _pkg, tools, bus, client = plugin
    client.get("/poll", params={"client": "A", "xmap": 1, "wait": 0})
    t = threading.Thread(target=run_desktop, args=(client, "A", False))
    t.start()
    time.sleep(0.2)
    out = json.loads(tools["xmap_read_map"][1]({}))
    t.join()
    assert out == {"ok": False, "error": "XMap Studio non ha risposto in tempo."}
    call = next(iter(bus.calls.values()))
    late = client.post("/result", json={"id": call.id, "client": "A", "ok": True, "text": "tardi"}).json()
    assert late["ok"] is False


def test_il_risultato_di_un_altro_client_si_rifiuta(plugin):
    _pkg, _tools, bus, client = plugin
    call = bus.submit("read_map", {})
    assert client.post("/claim", json={"id": call.id, "client": "A"}).json()["ok"] is True
    assert client.post("/result", json={"id": call.id, "client": "B", "ok": True, "text": "x"}).json()["ok"] is False


def test_il_catalogo_del_desktop_si_salva_e_vale_al_prossimo_avvio(plugin):
    pkg, _tools, _bus, client = plugin
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    catalog["tools"] = catalog["tools"][:2]
    assert client.post("/catalog", json={"client": "A", "catalog": catalog}).json() == {"ok": True, "changed": True}
    assert client.post("/catalog", json={"client": "A", "catalog": catalog}).json()["changed"] is False
    assert len(pkg.load_catalog()["tools"]) == 2
    assert client.post("/catalog", json={"client": "A", "catalog": {"tools": "no"}}).json()["ok"] is False
