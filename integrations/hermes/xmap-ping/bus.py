"""Stato condiviso dello spike tra il tool (metà agente) e le route di plugin_api.py.

Il tool e le route vengono importati da loader diversi: per vedere lo stesso
stato devono passare da `get_bus()`, che registra un'unica istanza in
`sys.modules`. Funziona solo se tool e route girano nello STESSO processo:
`diag()` riporta i pid visti da ciascuna parte proprio per scoprirlo.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import types
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

_MODULE_KEY = "_xmap_ping_bus_singleton"
_KEEP = 50  # richieste recenti conservate per la diagnostica


@dataclass
class Request:
    id: str
    tool: str
    args: dict
    origin: str  # "tool" (chiamata dal modello) o "trigger" (pulsante nel desktop)
    created: float = field(default_factory=time.time)
    claimed_by: Optional[str] = None
    claimed_via: Optional[str] = None
    claimed_at: Optional[float] = None
    result: Any = None
    completed_at: Optional[float] = None
    seen_via: list = field(default_factory=list)  # canali da cui il desktop dice di averla ricevuta
    done: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self) -> dict:
        return {"id": self.id, "tool": self.tool, "args": self.args, "origin": self.origin, "created": self.created}

    def status(self) -> dict:
        return {
            **self.public(),
            "claimed_by": self.claimed_by,
            "claimed_via": self.claimed_via,
            "claimed_after_ms": None if self.claimed_at is None else round((self.claimed_at - self.created) * 1000),
            "completed_after_ms": None if self.completed_at is None else round((self.completed_at - self.created) * 1000),
            "seen_via": list(self.seen_via),
            "result": self.result,
            "done": self.done.is_set(),
        }


class Bus:
    def __init__(self) -> None:
        self.instance = uuid.uuid4().hex[:8]
        self.cond = threading.Condition()
        self.requests: dict[str, Request] = {}
        self.pids: dict[str, int] = {}  # parte → pid che l'ha usata per ultima
        self.listeners: list = []  # callback(request) per il WebSocket /events
        self.events: list = []  # registro breve degli ultimi fatti, per la diagnostica

    def note(self, part: str) -> None:
        self.pids[part] = os.getpid()

    def log(self, text: str) -> None:
        with self.cond:
            self.events.append(f"{time.strftime('%H:%M:%S')} [{os.getpid()}] {text}")
            del self.events[:-100]

    def submit(self, tool: str, args: dict, origin: str) -> Request:
        req = Request(id=uuid.uuid4().hex, tool=tool, args=args, origin=origin)
        with self.cond:
            self.requests[req.id] = req
            for old in sorted(self.requests.values(), key=lambda r: r.created)[:-_KEEP]:
                self.requests.pop(old.id, None)
            self.cond.notify_all()
            listeners = list(self.listeners)
        for cb in listeners:
            try:
                cb(req)
            except Exception as exc:  # un listener rotto non deve fermare gli altri
                self.log(f"listener fallito: {exc!r}")
        self.log(f"richiesta {req.id[:8]} creata ({origin})")
        return req

    def unclaimed(self) -> list[Request]:
        return [r for r in self.requests.values() if r.claimed_by is None and not r.done.is_set()]

    def wait_unclaimed(self, timeout: float) -> list[Request]:
        """Long-poll: restituisce subito le richieste non reclamate, altrimenti aspetta."""
        deadline = time.time() + timeout
        with self.cond:
            while True:
                pending = self.unclaimed()
                left = deadline - time.time()
                if pending or left <= 0:
                    return pending
                self.cond.wait(left)

    def claim(self, req_id: str, client: str, via: str) -> tuple[bool, str]:
        """Il primo client che reclama vince: è ciò che impedisce l'esecuzione doppia."""
        with self.cond:
            req = self.requests.get(req_id)
            if req is None:
                return False, "sconosciuta"
            if via not in req.seen_via:
                req.seen_via.append(via)
            if req.claimed_by is not None:
                return req.claimed_by == client and req.claimed_via == via, f"già reclamata da {req.claimed_by} via {req.claimed_via}"
            req.claimed_by, req.claimed_via, req.claimed_at = client, via, time.time()
        self.log(f"richiesta {req_id[:8]} reclamata da {client} via {via}")
        return True, "ok"

    def complete(self, req_id: str, client: str, result: Any) -> tuple[bool, str]:
        with self.cond:
            req = self.requests.get(req_id)
            if req is None:
                return False, "sconosciuta"
            if req.claimed_by != client:
                return False, "non sei il client che l'ha reclamata"
            if req.done.is_set():
                return False, "già completata"
            req.result, req.completed_at = result, time.time()
            req.done.set()
        self.log(f"richiesta {req_id[:8]} completata da {client}")
        return True, "ok"

    def diag(self) -> dict:
        with self.cond:
            return {
                "bus_instance": self.instance,
                "pid_now": os.getpid(),
                "pids_by_part": dict(self.pids),
                "requests": [r.status() for r in sorted(self.requests.values(), key=lambda r: -r.created)[:10]],
                "events": list(self.events[-30:]),
            }


_create_lock = threading.Lock()


def get_bus() -> Bus:
    # Niente isinstance: se bus.py viene caricato due volte (due loader), le due
    # classi Bus sono diverse ma l'istanza registrata deve restare quella.
    with _create_lock:
        holder = sys.modules.get(_MODULE_KEY)
        if holder is None:
            holder = types.ModuleType(_MODULE_KEY)
            holder.bus = Bus()  # type: ignore[attr-defined]
            sys.modules[_MODULE_KEY] = holder
        return holder.bus  # type: ignore[attr-defined,no-any-return]
