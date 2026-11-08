"""Eastmoney limit-up / limit-down pool feed.

Our own classification derives the pools from the full-market snapshot, but it
cannot know three things the exchange publishes directly:

* the time a stock first sealed the limit (``fbt``)
* the real sealed-order value (``fund``) — we can only estimate from turnover
* how many times it broke the limit and resealed (``zbc``)

This module fetches those and returns them keyed by code so the snapshot builder
can enrich its rows in place. A failure here degrades to the old estimates; it
must never break the snapshot.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import config, fetch

log = logging.getLogger(__name__)

_UT = "7eea3edcaed734bea9cbfc24409ed989"
_ZT = (
    "https://push2ex.eastmoney.com/getTopicZTPool"
    f"?ut={_UT}&dpt=wz.ztzt&Pageindex=0&pagesize={{size}}&sort=fbt%3Aasc&date={{day}}"
)
_DT = (
    "https://push2ex.eastmoney.com/getTopicDTPool"
    f"?ut={_UT}&dpt=wz.ztzt&Pageindex=0&pagesize={{size}}&sort=fund%3Aasc&date={{day}}"
)
REFERER = "https://quote.eastmoney.com/"

# A limit-up pool is a few hundred names at most; one page covers it.
PAGE_SIZE = 300
# The side panels must not stall the snapshot build.
TIMEOUT = 8.0


def _hhmmss(v: Any) -> str:
    """Convert Eastmoney's HHMMSS integer (92500) to '09:25:00'."""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return "--:--"
    if n <= 0:
        return "--:--"
    hh, rest = divmod(n, 10000)
    mm, ss = divmod(rest, 100)
    return f"{hh:02d}:{mm:02d}:{ss:02d}"


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _get(url: str) -> dict[str, Any] | None:
    try:
        text = fetch._request(url, REFERER, timeout=TIMEOUT).decode("utf-8", "replace")
        return json.loads(text)
    except Exception as exc:
        log.debug("eastmoney pool fetch failed: %s", exc)
        return None


def _parse(doc: dict[str, Any] | None) -> tuple[dict[str, dict[str, Any]], str]:
    """Return ({code: facts}, quote_date)."""
    out: dict[str, dict[str, Any]] = {}
    data = (doc or {}).get("data") or {}
    for row in data.get("pool") or []:
        code = str(row.get("c") or "").strip()
        if not code:
            continue
        stats = row.get("zttj") or {}
        out[code] = {
            "firstTime": _hhmmss(row.get("fbt")),
            "lastTime": _hhmmss(row.get("lbt")),
            # Real sealed-order value in yuan, not an estimate.
            "sealAmt": _num(row.get("fund")),
            "openNum": int(_num(row.get("zbc"))),
            "lbc": int(_num(row.get("lbc"))),
            "industry": (row.get("hybk") or "").strip(),
            "statDays": int(_num(stats.get("days"))),
            "statBoards": int(_num(stats.get("ct"))),
        }
    return out, str(data.get("qdate") or "")


def fetch_pools(day: str) -> dict[str, dict[str, dict[str, Any]]]:
    """Fetch both pools for ``day`` (YYYYMMDD).

    Returns ``{"up": {code: facts}, "down": {code: facts}, "date": ...}``; any
    section that fails comes back empty rather than raising.
    """
    result: dict[str, Any] = {"up": {}, "down": {}, "date": ""}
    for key, template in (("up", _ZT), ("down", _DT)):
        doc = _get(template.format(size=PAGE_SIZE, day=day))
        if not doc or doc.get("rc") not in (0, None):
            continue
        rows, qdate = _parse(doc)
        result[key] = rows
        if qdate and not result["date"]:
            result["date"] = qdate
    return result


def apply(rows: list[dict[str, Any]], facts: dict[str, dict[str, Any]]) -> int:
    """Enrich snapshot rows in place; returns how many matched.

    Board count is deliberately *not* overwritten: our streak calculation and
    Eastmoney's ``lbc`` count different things (consecutive limit-ups vs boards
    within a window), and mixing them would make the ladder inconsistent with the
    ladder page. Only fields we cannot derive ourselves are taken.
    """
    hit = 0
    for r in rows:
        info = facts.get(str(r.get("code") or ""))
        if not info:
            continue
        hit += 1
        if info["firstTime"] != "--:--":
            r["firstTime"] = info["firstTime"]
        if info["lastTime"] != "--:--":
            r["lastTime"] = info["lastTime"]
        if info["sealAmt"] > 0:
            r["sealAmt"] = info["sealAmt"]
            cap = float(r.get("float_cap") or 0)
            r["sealRatio"] = round(info["sealAmt"] / cap * 100, 2) if cap else 0.0
        r["openNum"] = info["openNum"]
        if info["industry"]:
            r["industryBoard"] = info["industry"]
        if info["statDays"] and info["statBoards"]:
            r["statText"] = f"{info['statDays']}天{info['statBoards']}板"
    return hit
