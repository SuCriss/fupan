"""HTTP API mirroring the reference tool's contract."""

from __future__ import annotations

import re
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from .. import analysis, auth, concepts, config as cfg, detail, extra, fetch, indicators, llm, sentiment, store

router = APIRouter(prefix="/api", tags=["fupan"])

# Any date reaching the notes table must be a plain YYYY-MM-DD, so a crafted
# value cannot become a key that never matches an archive day.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _with_sentiment(doc: dict[str, Any]) -> dict[str, Any]:
    """Attach the composite sentiment reading computed from this document."""
    doc["sentiment"] = sentiment.score(
        doc.get("stats"), (doc.get("compare") or {}).get("promotionRate")
    )
    return doc


@router.get("/health")
def api_health(response: Response) -> dict[str, Any]:
    """Liveness + readiness in one call, for an external uptime monitor.

    A bare ``{"ok": true}`` proves only that the process answers, which stays true
    even when the database is locked or the snapshot is hours stale. This reports
    the facts a monitor needs and returns 503 when any of them is unhealthy, so the
    probe fails instead of silently staying green.
    """
    now = time.time()
    issues: list[str] = []

    # The database must be readable, not merely present.
    try:
        with store._conn() as c:
            c.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception as exc:  # a locked/corrupt DB is exactly what we must catch
        db_ok = False
        issues.append(f"db_unreadable: {type(exc).__name__}")

    # How old is the data actually being served?
    try:
        snap = store.cached_snapshot()
    except Exception:
        snap = None
    age = store.snapshot_age(snap) if snap else None
    if snap is None:
        issues.append("no_snapshot")
    elif age is not None and age > cfg.SNAPSHOT_TTL * 4:
        issues.append(f"snapshot_stale: {int(age)}s")

    # A build that never finishes blocks every later refresh.
    st = store.background_state()
    build_secs = 0.0
    if st["running"] and st["last_started"]:
        build_secs = round(now - st["last_started"], 1)
        if build_secs > 1200:
            issues.append(f"build_stuck: {int(build_secs)}s")
    if st.get("error"):
        issues.append("last_build_failed")

    ok = db_ok and snap is not None and not any(
        i.startswith(("snapshot_stale", "build_stuck")) for i in issues
    )
    if not ok:
        response.status_code = 503

    return {
        "ok": ok,
        "ts": fetch.now_ts(),
        "db": db_ok,
        "snapshotAgeSec": None if age is None else round(age, 1),
        "snapshotDate": ((snap or {}).get("stats") or {}).get("date"),
        "buildRunning": st["running"],
        "buildSeconds": build_secs or None,
        "marketStatus": _market_status(),
        "issues": issues,
    }


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
        # Before the open (or on a quiet morning) today's snapshot has no limit-ups
        # yet. Serving that renders a page of zeros, so show the previous session
        # instead and say so.
        snap_stats = snap.get("stats") or {}
        if not snap_stats.get("upCount") and not snap_stats.get("downCount"):
            prev_day = store.latest_snapshot_before(snap_stats.get("date") or cfg.cn_today())
            if prev_day:
                prev_day = dict(prev_day)
                prev_day["stale"] = True
                prev_day["fallback"] = True
                prev_day["refreshing"] = store.background_state()["running"]
                return _with_sentiment(prev_day)

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

    # No snapshot for today yet (first load of the day, or a slow build).
    store.refresh_in_background()

    # Serve the last stored day straight away rather than making the reader wait
    # minutes for a build that may take several: the page would otherwise sit on
    # "loading" with nothing on screen. `fallback` tells the UI which day it is.
    prev = store.latest_snapshot()
    if prev:
        prev = dict(prev)
        prev["stale"] = True
        prev["fallback"] = True
        prev["refreshing"] = True
        return _with_sentiment(prev)

    # Nothing stored at all: this is the true cold start, so waiting is the only
    # option. Keep it shorter than the client's own timeout.
    deadline = time.time() + 120
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


@router.get("/auth/status")
def api_auth_status(request: Request) -> dict[str, Any]:
    """Whether a gate is configured, and whether this client is already past it.

    Always reachable so the SPA can decide between the login screen and the app.
    """
    return {
        **auth.status(),
        "authenticated": auth.verify_token(request.cookies.get(auth.COOKIE_NAME)),
    }


@router.post("/login")
def api_login(request: Request, payload: dict = Body(...)):
    if not auth.enabled():
        raise HTTPException(status_code=400, detail="未启用登录：服务端未设置 FUPAN_PASSWORD")

    ip = auth.client_ip(
        dict(request.headers),
        request.client.host if request.client else "",
    )
    if auth.is_locked(ip):
        raise HTTPException(status_code=429, detail="尝试次数过多，请 15 分钟后再试")

    if not auth.check_password(str(payload.get("password") or "")):
        auth.record_failure(ip)
        raise HTTPException(status_code=401, detail="密码错误")

    auth.clear_failures(ip)
    token = auth.issue_token()
    resp = JSONResponse({"ok": True, "days": auth.session_days()})
    # Secure only when the request actually arrived over TLS: a local http probe
    # would otherwise never receive the cookie.
    secure = (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto") == "https"
    )
    resp.set_cookie(
        auth.COOKIE_NAME,
        token,
        max_age=auth.session_days() * 86400,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    return resp


@router.post("/logout")
def api_logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE_NAME, path="/")
    return resp


@router.get("/note")
def api_get_note(date: str = Query("", description="YYYY-MM-DD; empty = today")) -> dict[str, Any]:
    """One trading day's review note (empty when none written)."""
    day = date.strip() or cfg.cn_today()
    if not _DATE_RE.fullmatch(day):
        raise HTTPException(status_code=400, detail="date 必须是 YYYY-MM-DD")
    return store.get_note(day)


@router.put("/note")
def api_save_note(payload: dict = Body(...)) -> dict[str, Any]:
    """Save a day's note; blank content clears it."""
    day = str(payload.get("date") or "").strip()
    content = str(payload.get("content") or "")
    if not _DATE_RE.fullmatch(day):
        raise HTTPException(status_code=400, detail="date 必须是 YYYY-MM-DD")
    return store.save_note(day, content)


@router.post("/note/draft")
def api_note_draft(payload: dict = Body(...)) -> dict[str, Any]:
    """Draft a review note for one day from that day's review data.

    Reads the snapshot (live or archived) rather than trusting the client to send
    numbers, so the draft can only cite data the server actually holds.
    """
    if not llm.configured():
        raise HTTPException(status_code=400, detail="未配置 AI 模型，无法生成")

    day = str(payload.get("date") or "").strip()
    snap = store.cached_snapshot() or {}
    current = (snap.get("stats") or {}).get("date") or ""
    if day and day != current:
        doc = store.load_snapshot(day)
        if not doc:
            raise HTTPException(status_code=404, detail=f"暂无 {day} 的快照数据")
    else:
        doc = snap
    if not doc:
        raise HTTPException(status_code=503, detail="快照尚未就绪，请稍后重试")

    stats = doc.get("stats") or {}
    rows = (doc.get("pools") or {}).get("up") or []

    # Bucket first-seal times the same way the UI chart does.
    dist = {"total": 0, "auction": 0, "opening": 0, "closing": 0}
    for r in rows:
        t = (r.get("firstTime") or "").strip()
        if not t or t == "--:--":
            continue
        dist["total"] += 1
        if t <= "09:30:00":
            dist["auction"] += 1
        elif t <= "10:00:00":
            dist["opening"] += 1
        elif t >= "14:30:00":
            dist["closing"] += 1

    payload_in = {
        "date": stats.get("date") or day,
        "stats": stats,
        "sentiment": sentiment.score(stats, (doc.get("compare") or {}).get("promotionRate")),
        "leaders": doc.get("leaders") or [],
        "sectors": stats.get("sectors") or [],
        "timedist": dist,
    }

    text = llm.generate_note(payload_in)
    if not text:
        raise HTTPException(status_code=502, detail="AI 生成失败，请稍后重试")
    return {"date": payload_in["date"], "content": text}


@router.get("/note/dates")
def api_note_dates() -> dict[str, Any]:
    """Dates that already have a note, newest first."""
    return {"dates": store.note_dates(400)}


@router.get("/lhb")
def api_lhb(date: str = Query("", description="YYYY-MM-DD; empty = snapshot date")) -> dict[str, Any]:
    """Whole-market dragon-tiger list for one trading day.

    Reads the snapshot only to pick a default date; the rows themselves come from
    the exchange feed, which publishes a finished day once and never revises it.
    """
    snap = store.cached_snapshot() or {}
    day = date.strip() or ((snap.get("stats") or {}).get("date") or "")
    if not day:
        raise HTTPException(status_code=503, detail="尚无快照日期，请先刷新")
    return extra.market_lhb(day)


@router.get("/sectors")
def api_sectors(limit: int = Query(24, ge=1, le=60)) -> dict[str, Any]:
    """Ranked sector dossiers derived from the cached limit-up pool.

    Reads only the in-memory/SQLite snapshot, so opening the sector board never
    triggers a market rebuild.
    """
    snap = store.cached_snapshot() or {}
    rows = (snap.get("pools") or {}).get("up") or []
    return {
        "date": (snap.get("stats") or {}).get("date"),
        "list": analysis.build_sector_detail(rows, limit),
    }


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


# Index quotes cost ~1s upstream and every open tab polls them, so a short TTL
# collapses concurrent clients onto a single fetch. The last good value keeps
# being served if the upstream hiccups.
_MARKET_TTL = 20.0
_market_cache: dict[str, Any] = {"at": 0.0, "indices": []}


@router.get("/market")
def api_market() -> dict[str, Any]:
    now = time.time()
    if not _market_cache["indices"] or now - _market_cache["at"] > _MARKET_TTL:
        indices = fetch.fetch_indices()
        if indices:
            _market_cache["indices"] = indices
            _market_cache["at"] = now
    return {
        "ts": fetch.now_ts(),
        "status": _market_status(),
        "date": cfg.cn_today(),
        "indices": _market_cache["indices"],
    }


@router.get("/watch")
def api_watch(codes: str = Query("", description="comma-separated codes")) -> dict[str, Any]:
    """Quotes for the watchlist, or for an explicit code list.

    Each row carries its limit state (limitUp / limitDown / broken / normal) so the
    client can raise an alert on a transition without re-deriving the board's own
    limit — ST is 5% while ChiNext/STAR are 20%.
    """
    if codes.strip():
        wanted = [c.strip() for c in codes.split(",") if c.strip()]
    else:
        with store._conn() as c:  # noqa: SLF001 - single-owner module
            wanted = [r["code"] for r in c.execute("SELECT code FROM watchlist ORDER BY added_at")]
    quotes = fetch.fetch_quotes(wanted) if wanted else {}

    # Pool rows supply the board count for names that are currently limit-up.
    snap = store.cached_snapshot() or {}
    pool_rows: dict[str, dict[str, Any]] = {}
    for group in (snap.get("pools") or {}).values():
        for r in group or []:
            pool_rows.setdefault(r.get("code"), r)

    tol = cfg.SEALED_TOLERANCE
    out: list[dict[str, Any]] = []
    for q in quotes.values():
        limit = analysis.limit_pct(q["code"], q["name"])
        chg = float(q.get("chg") or 0)
        high = float(q.get("high") or 0)
        pre = float(q.get("pre_close") or 0)
        high_chg = ((high - pre) / pre * 100) if pre else 0.0

        if chg >= limit - tol:
            status = "limitUp"
        elif chg <= -(limit - tol):
            status = "limitDown"
        elif high_chg >= limit - tol:
            # Touched the ceiling but is not sealed now.
            status = "broken"
        else:
            status = "normal"

        row = dict(q)
        row["limitPct"] = limit
        row["status"] = status
        hit = pool_rows.get(q["code"])
        if hit:
            row["boards"] = hit.get("boards", 0)
            row["daysText"] = hit.get("daysText")
        out.append(row)
    return {"ts": fetch.now_ts(), "list": out}


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


@router.get("/stock/{code}/ai")
def api_stock_ai(code: str) -> dict[str, Any]:
    """Just the AI attribution block for one stock.

    The drawer polls this while a summary is being generated. Polling the full
    detail instead would re-run the six upstream fetches behind every tick.
    """
    code = code.strip()
    trade_date = cfg.cn_today()
    summary = llm.get_cached_for(code, trade_date)
    state = (
        "ready"
        if summary
        else ("generating" if llm.pending(code, trade_date) else "unavailable")
    )
    return {
        "enabled": llm.configured(),
        "status": state,
        "summary": summary,
        "model": llm.status().get("model"),
    }


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
    summary = llm.get_cached_for(code, trade_date)
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
    if hm < 915:
        # Before the auction there is no session to report; calling it "已收盘"
        # was wrong at 9am and confused the freshness readout.
        return "未开盘"
    if 915 <= hm < 925:
        return "集合竞价"
    if 930 <= hm <= 1130 or 1300 <= hm <= 1500:
        return "交易中"
    if 1130 < hm < 1300:
        return "午间休市"
    return "已收盘"
