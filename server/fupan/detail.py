"""Per-stock detail assembly, tuned for drawer latency.

The drawer is opened interactively, so this path avoids re-deriving the whole
market snapshot and parallelises the independent upstream calls. A short-lived
in-process cache handles repeated opens of the same stock.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import analysis, concepts, extra, fetch, indicators, store

log = logging.getLogger(__name__)

# code -> (built_at, payload); the drawer is re-openable within a session.
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_TTL = 45.0
_MAX = 120


def _quote_and_minute(code: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    return fetch.fetch_quotes([code]).get(code), fetch.fetch_minute(code)


def _snapshot_row(code: str) -> dict[str, Any] | None:
    """Find this stock's entry in the most recent snapshot without rebuilding it."""
    try:
        snap = store.cached_snapshot()
    except Exception as exc:
        # A missing snapshot is normal (returns None); raising here means the
        # store itself failed, which is worth surfacing.
        log.warning("snapshot lookup failed for %s: %s: %s", code, type(exc).__name__, exc)
        return None
    if not snap:
        return None
    for pool in (snap.get("pools") or {}).values():
        for row in pool:
            if row.get("code") == code:
                return row
    return None


def build_detail(code: str, days: int = 600, refresh: bool = False) -> dict[str, Any] | None:
    """Return the drawer payload for one stock, or None when the code is unknown."""
    now = time.time()
    if not refresh:
        hit = _CACHE.get(code)
        if hit and now - hit[0] < _TTL:
            return hit[1]

    # Independent work goes out together: quotes, intraday ticks, daily bars,
    # concept taxonomy, money flow and the dragon-tiger list all hit different
    # upstream services.
    with ThreadPoolExecutor(max_workers=6) as pool:
        f_qm = pool.submit(_quote_and_minute, code)
        f_daily = pool.submit(fetch.fetch_kline, code, days)
        f_info = pool.submit(concepts.ensure, [code])
        f_snap = pool.submit(_snapshot_row, code)
        f_money = pool.submit(extra.money_flow, code)
        f_lhb = pool.submit(extra.lhb, code)

        quote, minutes = f_qm.result()
        if not quote:
            return None
        daily = f_daily.result()
        info = (f_info.result() or {}).get(code) or {"themes": [], "industries": [], "reasons": {}}
        snap_row = f_snap.result()
        money = f_money.result()
        dragon = f_lhb.result()

    lim = analysis.limit_pct(code, quote["name"])

    klines: dict[str, Any] = {}
    for period in indicators.PERIODS:
        bars = indicators.resample(daily, period)
        klines[period] = {
            "label": indicators.PERIOD_LABEL[period],
            "bars": indicators.enrich(bars, period),
            "analysis": indicators.analyse(bars, period, code, quote["name"]),
            "total": len(bars),
        }

    payload = {
        "ts": fetch.now_ts(),
        "code": code,
        "name": quote["name"],
        "quote": quote,
        "limitPct": lim,
        "board": analysis.board_of(code, quote["name"]),
        "minute": minutes,
        "concepts": info["themes"],
        "industries": info["industries"][:6],
        "conceptReasons": info["reasons"],
        "snapshot": snap_row,
        "klines": klines,
        "moneyFlow": money,
        "lhb": dragon,
        "limitStats": extra.limitup_history(daily, code, quote["name"]),
    }

    if len(_CACHE) > _MAX:
        _CACHE.clear()
    _CACHE[code] = (now, payload)
    return payload


def invalidate() -> None:
    _CACHE.clear()
