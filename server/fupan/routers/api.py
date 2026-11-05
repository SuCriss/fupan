"""HTTP API mirroring the reference tool's contract."""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .. import analysis, concepts, config as cfg, detail, fetch, indicators, llm, sentiment, store

router = APIRouter(prefix="/api", tags=["fupan"])


def _with_sentiment(doc: dict[str, Any]) -> dict[str, Any]:
    """Attach the composite sentiment reading computed from this document."""
    doc["sentiment"] = sentiment.score(
        doc.get("stats"), (doc.get("compare") or {}).get("promotionRate")
    )
    return doc


@router.get("/health")
def api_health() -> dict[str, Any]:
    return {"ok": True, "db": str(cfg.DB_PATH)}


@router.get("/all")
def api_all(date: str = Query("", description="YYYYMMDD or YYYY-MM-DD; empty = latest")) -> dict[str, Any]:
    """Full daily review document (stats, leaders, ladder, hot, pools).

    Never blocks on a full-market build: a cached document is returned at once
    and a refresh is started in the background. A cold cache (first ever run)
    has nothing to serve, so it waits for the build.
    """
    ds = date.replace("-", "").strip()
    if ds:
        iso = f"{ds[:4]}-{ds[4:6]}-{ds[6:8]}" if len(ds) == 8 else date
        cached = store.load_snapshot(iso)
        if cached:
            cached["stale"] = True
            return _with_sentiment(cached)
        # Unknown historical date: only today can be fetched live.
        raise HTTPException(status_code=404, detail=f"暂无 {iso} 的快照数据")

    snap = store.cached_snapshot()
    if snap:
        # Serve immediately. A rebuild is only kicked off when the served data is
        # genuinely old, nothing is already building, *and* the previous build
        # started more than one TTL ago. That cooldown is what stops a build from
        # chaining straight into the next one: a full-market build takes minutes,
        # so without it the worker would never be idle and the UI would sit on
        # "refreshing" indefinitely.
        age = store.snapshot_age(snap)
        stale = age > cfg.SNAPSHOT_TTL
        state = store.background_state()
        if (
            stale
            and not state["running"]
            and time.time() - (state["last_started"] or 0) > cfg.SNAPSHOT_TTL
        ):
            store.refresh_in_background()
            state = store.background_state()
        snap = dict(snap)
        snap["stale"] = stale
        snap["refreshing"] = state["running"]
        return _with_sentiment(snap)

    # Cold cache: the very first request has to wait for the build.
    store.refresh_in_background()
    deadline = time.time() + 240
    while time.time() < deadline:
        snap = store.cached_snapshot()
        if snap:
            snap = dict(snap)
            snap["stale"] = False
            snap["refreshing"] = store.background_state()["running"]
            return _with_sentiment(snap)
        time.sleep(1.5)
    raise HTTPException(status_code=503, detail="快照构建超时，请稍后重试")


@router.get("/sentiment")
def api_sentiment(days: int = Query(30, ge=1, le=120)) -> dict[str, Any]:
    """Daily sentiment score trend across recent stored snapshots."""
    series = []
    for row in store.snapshot_series(days):
        s = sentiment.score(row["stats"], row["promotionRate"])
        if s["score"] is None:
            continue
        series.append(
            {
                "date": row["date"],
                "score": s["score"],
                "label": s["label"],
                "tone": s["tone"],
                "upCount": row["stats"].get("upCount", 0),
                "downCount": row["stats"].get("downCount", 0),
                "sealRate": row["stats"].get("sealRate", 0),
                "brokenRate": row["stats"].get("brokenRate", 0),
                "maxBoard": row["stats"].get("maxBoard", 0),
                "lianbanCount": row["stats"].get("lianbanCount", 0),
            }
        )
    return {"list": series}



@router.post("/refresh")
def api_refresh() -> dict[str, Any]:
    """Start a live refetch in the background.

    A synchronous rebuild takes ~90s, which Cloudflare would cut off at its
    100s origin timeout, so the work is queued and progress is pollable.
    """
    started = store.refresh_in_background()
    return {"ok": True, "started": started, **store.background_state()}


@router.get("/refresh/status")
def api_refresh_status() -> dict[str, Any]:
    return store.background_state()


@router.get("/market")
def api_market() -> dict[str, Any]:
    indices = fetch.fetch_indices()
    return {
        "ts": fetch.now_ts(),
        "status": _market_status(),
        "date": cfg.cn_today(),
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


@router.get("/search")
def api_search(q: str = Query("", description="code or name fragment"), limit: int = 12) -> dict[str, Any]:
    """Fuzzy stock lookup over the full-market symbol list.

    Reads only local SQLite, so it answers instantly and never triggers a
    market fetch. Pool rows in the cached snapshot are merged in when present
    so the dropdown can also show today's change and board count.
    """
    term = q.strip()
    if not term:
        return {"q": "", "items": []}

    snap = store.cached_snapshot() or {}
    pool_rows: dict[str, dict[str, Any]] = {}
    for group in (snap.get("pools") or {}).values():
        for s in group or []:
            code = s.get("code")
            if code and code not in pool_rows:
                pool_rows[code] = s

    hits = store.search_universe(term, limit=limit)
    items = []
    for h in hits:
        code, name = h["code"], h["name"]
        live = pool_rows.get(code) or {}
        items.append(
            {
                "code": code,
                "name": name,
                "price": live.get("price"),
                "chg": live.get("chg"),
                "boards": live.get("boards", 0),
                "kind": live.get("kind"),
                "concepts": (live.get("concepts") or [])[:3],
            }
        )
    return {"q": term, "items": items, "universe": store.universe_size()}


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

    trade_date = cfg.cn_today()
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
    """Coarse A-share session state from the China-market wall clock.

    The host runs in UTC, so this must not use ``time.localtime()`` — that made
    a 10:58 Beijing session report "已收盘".
    """
    lt = cfg.cn_now()
    if lt.weekday() >= 5:
        return "休市"
    hm = lt.hour * 100 + lt.minute
    if 915 <= hm < 925:
        return "集合竞价"
    if 930 <= hm <= 1130 or 1300 <= hm <= 1500:
        return "交易中"
    if 1130 < hm < 1300:
        return "午间休市"
    return "已收盘"
