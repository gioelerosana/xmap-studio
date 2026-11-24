"""Coda delle chiamate tra i tool (metà agente) e le route di plugin_api.py.

I tool e le route sono importati da loader diversi ma girano nello stesso
processo (il gateway a cui è collegato Hermes Desktop: verificato con lo spike
xmap-ping): per vedere lo stesso stato passano entrambi da `get_bus()`, che
tiene un'unica istanza in `sys.modules`.

Una chiamata vive così: il tool la crea (`submit`) e la annuncia; un Hermes
Desktop la reclama (`claim`, vince il primo: mai eseguita due volte), la gira a
XMap Studio e manda l'esito (`complete`); il tool, che aspettava, lo restituisce
al modello. Se nessuno la reclama o risponde in tempo, il tool la chiude
(`abandon`) e un esito arrivato dopo viene scartato.
"""

from __future__ import annotations

import sys
import threading
import time
import types
import uuid
from dataclasses import dataclass, field
from typing import Optional

_MODULE_KEY = "_xmap_studio_bus_singleton"
_KEEP_CALLS = 100
#: Un desktop che non fa poll da più di così è considerato scollegato.
PRESENCE_TTL_SECONDS = 45.0


@dataclass
class Call:
    id: str
    tool: str
    args: dict
    created: float = field(default_factory=time.time)
    claimed_by: Optional[str] = None
    ok: Optional[bool] = None
    text: str = ""
    error: str = ""
    claimed: threading.Event = field(default_factory=threading.Event, repr=False)
    done: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self) -> dict:
        return {"id": self.id, "tool": self.tool, "args": self.args, "created": self.created}


@dataclass
class Desktop:
    client: str
    last_seen: float
    xmap: bool
    xmap_version: Optional[str]


class Bus:
    def __init__(self) -> None:
        self.cond = threading.Condition()
        self.calls: dict[str, Call] = {}
        self.desktops: dict[str, Desktop] = {}
        self.catalog: Optional[dict] = None

    # --- presenza dei desktop -------------------------------------------------

    def seen(self, client: str, xmap: bool, xmap_version: Optional[str]) -> None:
        with self.cond:
            self.desktops[client] = Desktop(client, time.time(), xmap, xmap_version)
            cutoff = time.time() - PRESENCE_TTL_SECONDS * 4
            for key in [k for k, d in self.desktops.items() if d.last_seen < cutoff]:
                del self.desktops[key]

    def alive(self) -> list[Desktop]:
        cutoff = time.time() - PRESENCE_TTL_SECONDS
        with self.cond:
            return [d for d in self.desktops.values() if d.last_seen >= cutoff]

    def ready(self) -> list[Desktop]:
        return [d for d in self.alive() if d.xmap]

    # --- chiamate -------------------------------------------------------------

    def submit(self, tool: str, args: dict) -> Call:
        call = Call(id=uuid.uuid4().hex, tool=tool, args=args)
        with self.cond:
            self.calls[call.id] = call
            finished = [c for c in self.calls.values() if c.done.is_set()]
            for old in sorted(finished, key=lambda c: c.created)[: max(0, len(self.calls) - _KEEP_CALLS)]:
                self.calls.pop(old.id, None)
            self.cond.notify_all()
        return call

    def unclaimed(self) -> list[Call]:
        return [c for c in self.calls.values() if c.claimed_by is None and not c.done.is_set()]

    def wait_unclaimed(self, timeout: float) -> list[Call]:
        """Long-poll: restituisce subito le chiamate non reclamate, altrimenti aspetta."""
        deadline = time.time() + timeout
        with self.cond:
            while True:
                pending = self.unclaimed()
                left = deadline - time.time()
                if pending or left <= 0:
                    return pending
                self.cond.wait(left)

    def claim(self, call_id: str, client: str) -> tuple[bool, str]:
        with self.cond:
            call = self.calls.get(call_id)
            if call is None:
                return False, "chiamata sconosciuta"
            if call.done.is_set():
                return False, "chiamata già chiusa"
            if call.claimed_by is not None:
                return False, "già presa da un altro Hermes Desktop"
            call.claimed_by = client
            call.claimed.set()
        return True, "ok"

    def complete(self, call_id: str, client: str, ok: bool, text: str, error: str) -> tuple[bool, str]:
        with self.cond:
            call = self.calls.get(call_id)
            if call is None:
                return False, "chiamata sconosciuta"
            if call.claimed_by != client:
                return False, "la chiamata non è di questo client"
            if call.done.is_set():
                return False, "chiamata già chiusa"
            call.ok, call.text, call.error = ok, text, error
            call.done.set()
        return True, "ok"

    def abandon(self, call: Call, error: str) -> None:
        """Chiude una chiamata scaduta: un esito che arriva dopo viene rifiutato."""
        with self.cond:
            if call.done.is_set():
                return
            call.ok, call.error = False, error
            call.claimed.set()
            call.done.set()

    def status(self) -> dict:
        with self.cond:
            return {
                "desktops": [
                    {"client": d.client, "seconds_ago": round(time.time() - d.last_seen, 1), "xmap": d.xmap, "xmap_version": d.xmap_version}
                    for d in self.desktops.values()
                ],
                "pending": len(self.unclaimed()),
                "catalog_tools": len(self.catalog.get("tools", [])) if self.catalog else None,
            }


_create_lock = threading.Lock()


def get_bus() -> Bus:
    # Niente isinstance: se bus.py viene caricato due volte, le classi sono diverse ma l'istanza resta una.
    with _create_lock:
        holder = sys.modules.get(_MODULE_KEY)
        if holder is None:
            holder = types.ModuleType(_MODULE_KEY)
            holder.bus = Bus()  # type: ignore[attr-defined]
            sys.modules[_MODULE_KEY] = holder
        return holder.bus  # type: ignore[attr-defined,no-any-return]
