"""Persistent daily-bar cache.

K-line history is immutable once a session closes, so it is cached per
(code, date) in SQLite. This turns repeat snapshot builds from roughly four
minutes of network work into a local read.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import date
from typing import Any

from . import config as cfg

log = logging.getLogger("fupan.klcache")

_mem: dict[str, list[dict[str, Any]]] = {}
_MAX_MEM = 4000


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(cfg.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS klines (
                   code TEXT NOT NULL,
                   bar_date TEXT NOT NULL,
                   o REAL, c REAL, h REAL, l REAL, v REAL,
                   updated_at INTEGER NOT NULL,
                   PRIMARY KEY (code, bar_date)
               )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS kline_meta (
                   code TEXT PRIMARY KEY,
                   fetched_at INTEGER NOT NULL
               )"""
        )


def load(
    code: str, today: str | None = None, min_bars: int = 0
) -> list[dict[str, Any]] | None:
    """Return cached bars for a code, or None when a refresh is required.

    A cache entry is reused when it was written during the same trading day and
    already contains that day's bar. Once the day rolls over the entry is stale,
    because the next session adds a new bar. `min_bars` lets a caller that needs
    a longer history (weekly/monthly resampling) force a wider refetch.
    """
    if code in _mem:
        cached = _mem[code]
        if len(cached) >= min_bars:
            return cached

    today = today or date.today().isoformat()
    with _conn() as c:
        meta = c.execute("SELECT fetched_at FROM kline_meta WHERE code=?", (code,)).fetchone()
        if not meta:
            return None
        rows = c.execute(
            "SELECT bar_date, o, c, h, l, v FROM klines WHERE code=? ORDER BY bar_date",
            (code,),
        ).fetchall()
    if not rows:
        return None
    if min_bars and len(rows) < min_bars:
        return None

    fetched_day = time.strftime("%Y-%m-%d", time.localtime(meta["fetched_at"]))
    last_bar = rows[-1]["bar_date"]
    # Same-day write that already saw today's bar, or a write after today's
    # close (the newest bar is today or later). Otherwise refetch.
    fresh = fetched_day == today and last_bar >= today
    if not fresh:
        return None

    bars = [
        {
            "date": r["bar_date"],
            "open": r["o"],
            "close": r["c"],
            "high": r["h"],
            "low": r["l"],
            "volume": r["v"],
        }
        for r in rows
    ]
    if len(_mem) > _MAX_MEM:
        _mem.clear()
    _mem[code] = bars
    return bars


def save(code: str, bars: list[dict[str, Any]]) -> None:
    if not bars:
        return
    now = int(time.time())
    with _conn() as c:
        c.executemany(
            "INSERT OR REPLACE INTO klines(code, bar_date, o, c, h, l, v, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            [
                (code, b["date"], b["open"], b["close"], b["high"], b["low"], b["volume"], now)
                for b in bars
            ],
        )
        c.execute(
            "INSERT OR REPLACE INTO kline_meta(code, fetched_at) VALUES (?,?)", (code, now)
        )
    if len(_mem) > _MAX_MEM:
        _mem.clear()
    _mem[code] = bars


def clear_memory() -> None:
    _mem.clear()
