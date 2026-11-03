"""HTTP API mirroring the reference tool's contract."""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .. import analysis, concepts, config as cfg, detail, fetch, indicators, llm, store

router = APIRouter(prefix="/api", tags=["fupan"])


@router.get("/health")
def api_health() -> dict[str, Any]:
    return {"ok": True, "db": str(cfg.DB_PATH)}


@router.get("/all")
def api_all(date: str = Query("", description="YYYYMMDD or YYYY-MM-DD; empty = latest")) -> dict[str, Any]:
    """Full daily review document (stats, leaders, ladder, hot, pools)."""
    ds = date.replace("-", "").strip()
    if ds:
        iso = f"{ds[:4]}-{ds[4:6]}-{ds[6:8]}" if len(ds) == 8 else date
        cached = store.load_snapshot(iso)
        if cached:
            cached["stale"] = True
            return cached
        # Unknown historical date: only today can be fetched live.
        raise HTTPException(status_code=404, detail=f"暂无 {iso} 的快照数据")
    return store.build_snapshot()


@router.post("/refresh")
def api_refresh() -> dict[str, Any]:
    """Force a live refetch, bypassing the TTL cache."""
    snap = store.build_snapshot(force=True)
    return {"ok": "error" not in snap, "ts": snap.get("ts"), "stats": snap.get("stats")}


@router.get("/market")
def api_market() -> dict[str, Any]:
    indices = fetch.fetch_indices()
    return {
        "ts": fetch.now_ts(),
        "status": _market_status(),
        "date": time.strftime("%Y-%m-%d"),
        "indices": indices,
    }


@router.get("/watch")
def api_watch(codes: str = Query("", description="comma-separated codes")) -> dict[str, Any]:
    """Quotes for the watchlist, or for an explicit code list."""
    if codes.strip():
        wanted = [c.strip() for c in codes.split(",") if c.strip()]
    else:
        with store._conn() as c:  # noqa: SLF001 - single-owner module
            wanted = [r["code"] for r in c.execute("SELECT code FROM watchlist ORDER BY added_at")]
    quotes = fetch.fetch_quotes(wanted) if wanted else {}
    return {"ts": fetch.now_ts(), "list": list(quotes.values())}


@router.post("/watch/{code}")
def api_watch_add(code: str) -> dict[str, Any]:
    if not code.strip():
        raise HTTPException(status_code=400, detail="code required")
    with store._conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO watchlist(code, added_at) VALUES (?,?)",
            (code.strip(), int(time.time())),
        )
    return {"ok": True, "code": code}


@router.delete("/watch/{code}")
def api_watch_remove(code: str) -> dict[str, Any]:
    with store._conn() as c:
        c.execute("DELETE FROM watchlist WHERE code=?", (code.strip(),))
    return {"ok": True, "code": code}


@router.get("/stock/{code}")
def api_stock(code: str, days: int = 600, refresh: bool = False, ai: bool = True) -> dict[str, Any]:
    """Per-stock detail: quote, intraday minutes, concept themes and board metadata.

    `days` defaults high enough that weekly/monthly/quarterly resampling still
    yields a readable chart and a valid indicator warm-up for MACD.

    AI attribution is returned when already cached. When it is missing and the
    model is configured, generation is queued in the background so the drawer
    still opens immediately; the client polls until the summary appears.
    """
    code = code.strip()
    payload = detail.build_detail(code, days=days, refresh=refresh)
    if not payload:
        raise HTTPException(status_code=404, detail=f"未找到 {code} 的行情")

    trade_date = time.strftime("%Y-%m-%d")
    summary = llm.get_cached(code, trade_date)
    generating = False
    if ai and summary is None and llm.configured():
        generating = llm.submit(lambda c: detail.build_detail(c, days=days), code, trade_date)

    state = "ready" if summary else ("generating" if generating or llm.pending(code, trade_date) else "unavailable")
    return {
        **payload,
        "ai": {
            "enabled": llm.configured(),
            "status": state,
            "summary": summary,
            "model": llm.status().get("model"),
        },
    }


@router.get("/ai/status")
def api_ai_status() -> dict[str, Any]:
    return llm.status()


@router.get("/dates")
def api_dates() -> dict[str, Any]:
    with store._conn() as c:
        rows = c.execute("SELECT date, ts FROM snapshots ORDER BY date DESC LIMIT 120").fetchall()
    return {"dates": [{"date": r["date"], "ts": r["ts"]} for r in rows]}


def _market_status() -> str:
    """Coarse A-share session state from the wall clock."""
    lt = time.localtime()
    if lt.tm_wday >= 5:
        return "休市"
    hm = lt.tm_hour * 100 + lt.tm_min
    if 915 <= hm < 925:
        return "集合竞价"
    if 930 <= hm <= 1130 or 1300 <= hm <= 1500:
        return "交易中"
    if 1130 < hm < 1300:
        return "午间休市"
    return "已收盘"
