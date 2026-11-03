"""Reconstruct a previous session's limit-up ladder from daily K-line history.

The snapshot feed only describes *today*. To compare today's ladder against the
previous session, that session is re-derived from the same forward-adjusted
daily bars used for streak counting: a bar whose close-to-close move reaches the
stock's limit band was a sealed limit-up that day.

Cost model
----------
An exhaustive probe over ~4,800 stocks costs ~2 minutes cold. Results are
cached per session date, so this runs once per trading day: later refreshes
reuse the stored ladder. A full scan is the default because a popularity-ranked
shortlist measurably loses recall (a stock that sealed yesterday can close
today almost anywhere), so correctness is preferred over a cheap partial answer.

`probe_budget` exists for explicit low-latency callers; when it truncates the
scan the payload is marked `approximate`.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import analysis, config as cfg, fetch

log = logging.getLogger("fupan.history")

HISTORY_DAYS = 12


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(cfg.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS prev_ladder (
                   session_date TEXT PRIMARY KEY,
                   payload TEXT NOT NULL
               )"""
        )


def _load_cache(today: str) -> dict[str, Any] | None:
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT payload FROM prev_ladder WHERE session_date=?", (today,)
            ).fetchone()
        if not row:
            return None
        payload = json.loads(row["payload"])
        # Older entries written by a truncated scan are not reused.
        if payload.get("approximate"):
            return None
        return payload
    except Exception as exc:
        log.debug("prev ladder cache read failed: %s", exc)
        return None


def _save_cache(today: str, payload: dict[str, Any]) -> None:
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO prev_ladder(session_date, payload) VALUES (?,?)",
                (today, json.dumps(payload, ensure_ascii=False)),
            )
    except Exception as exc:
        log.debug("prev ladder cache write failed: %s", exc)


def _is_limit_bar(bars: list[dict[str, Any]], idx: int, name: str, code: str) -> bool:
    lim = analysis.limit_pct(code, name)
    if idx <= 0:
        return False
    prev = bars[idx - 1].get("close") or 0
    cur = bars[idx].get("close") or 0
    if prev <= 0 or cur <= 0:
        return False
    return (cur - prev) / prev * 100 >= lim - 0.35


def _streak_ending_at(bars: list[dict[str, Any]], idx: int, name: str, code: str) -> int:
    n = 0
    i = idx
    while i > 0 and _is_limit_bar(bars, i, name, code):
        n += 1
        i -= 1
    return n


def build_previous_ladder(
    rows: list[dict[str, Any]],
    session_date: str = "",
    max_workers: int = 16,
    probe_budget: int | None = None,
) -> dict[str, Any] | None:
    """Return {date, groups, total, probed, approximate} for the prior session."""
    candidates = [r for r in rows if r.get("price") and r.get("pre_close")]
    if not candidates:
        return None

    if session_date:
        cached = _load_cache(session_date)
        if cached:
            log.info("previous ladder served from cache for %s", session_date)
            return cached

    def work(row: dict[str, Any]):
        bars = fetch.fetch_kline(row["code"], HISTORY_DAYS)
        if len(bars) < 3:
            return None
        idx = len(bars) - 2  # the bar just before today
        if not _is_limit_bar(bars, idx, row["name"], row["code"]):
            return None
        streak = _streak_ending_at(bars, idx, row["name"], row["code"])
        prev_close = bars[idx - 1].get("close") or 0
        close = bars[idx].get("close") or 0
        chg = round((close - prev_close) / prev_close * 100, 2) if prev_close else 0.0
        return {
            "date": bars[idx]["date"],
            "code": row["code"],
            "name": row["name"],
            "board": streak,
            "chg": chg,
        }

    probe = candidates
    if probe_budget and probe_budget < len(candidates):
        # Lowest-latency option only; recall drops, so the result is flagged.
        probe = sorted(candidates, key=lambda r: -abs(r.get("chg") or 0.0))[:probe_budget]

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = [x for x in pool.map(work, probe) if x]

    if not results:
        return None

    date = max(r["date"] for r in results)
    results = [r for r in results if r["date"] == date]

    groups: dict[int, list[dict[str, Any]]] = {}
    for r in results:
        if r["board"] >= 1:
            groups.setdefault(r["board"], []).append(
                {"code": r["code"], "name": r["name"], "chg": r["chg"]}
            )

    packed = [
        {"board": b, "label": f"昨日{b}板", "list": sorted(groups[b], key=lambda x: -x["chg"])}
        for b in sorted(groups, reverse=True)
    ]
    payload = {
        "date": date,
        "groups": packed,
        "total": len(results),
        "probed": len(probe),
        "approximate": len(probe) < len(candidates),
    }
    if session_date and not payload["approximate"]:
        _save_cache(session_date, payload)
    log.info("previous ladder %s: %s limit-ups from %s probes", date, len(results), len(probe))
    return payload
