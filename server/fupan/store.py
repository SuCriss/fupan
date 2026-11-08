"""Snapshot assembly with SQLite caching.

A snapshot is the single JSON document the frontend consumes, matching the
reference tool's `/api/all` contract: stats / leaders / ladder / hot / pools.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from datetime import datetime
from typing import Any

from . import analysis, concepts, config as cfg, fetch, history, klcache, llm, ztpool

log = logging.getLogger("fupan.store")

_lock = threading.Lock()
_mem: dict[str, Any] = {"key": None, "at": 0.0, "payload": None}

# Background refresh state. A full-market build costs ~90s (mostly the
# previous-day K-line probes), which exceeds Cloudflare's 100s origin timeout
# when requested synchronously through the public endpoint. The API therefore
# answers from cache immediately and rebuilds in a worker thread.
_bg_lock = threading.Lock()
_bg_thread: threading.Thread | None = None
_bg_state: dict[str, Any] = {"started": 0.0, "done": 0.0, "error": None}


def refresh_in_background() -> bool:
    """Request a background rebuild. At most one worker runs at a time.

    Returns True when a new worker was actually started, False when a build is
    already in flight (nothing is queued on top of it). A build takes ~110s,
    which is *longer* than SNAPSHOT_TTL, so queueing more rounds would keep the
    worker busy forever and the UI would see `running` true indefinitely.
    """
    global _bg_thread
    with _bg_lock:
        if _bg_thread and _bg_thread.is_alive():
            return False
        _bg_state["started"] = time.time()
        _bg_state["error"] = None

        def _run() -> None:
            try:
                build_snapshot(force=True)
            except Exception as exc:  # a failed refresh must not kill the server
                _bg_state["error"] = f"{type(exc).__name__}: {exc}"
                log.warning("background snapshot refresh failed: %s", exc)
            finally:
                _bg_state["done"] = time.time()

        _bg_thread = threading.Thread(target=_run, name="snapshot-refresh", daemon=True)
        _bg_thread.start()
        return True


def background_state() -> dict[str, Any]:
    with _bg_lock:
        running = bool(_bg_thread and _bg_thread.is_alive())
        started, done = _bg_state["started"], _bg_state["done"]
        return {
            "running": running,
            "pending": False,
            "last_started": started or None,
            "last_finished": done or None,
            "error": _bg_state["error"],
        }



def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(cfg.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS snapshots (
                   date TEXT PRIMARY KEY,
                   ts INTEGER NOT NULL,
                   payload TEXT NOT NULL
               )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS boards (
                   date TEXT NOT NULL,
                   code TEXT NOT NULL,
                   streak INTEGER NOT NULL,
                   PRIMARY KEY (date, code)
               )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS watchlist (
                   code TEXT PRIMARY KEY,
                   added_at INTEGER NOT NULL
               )"""
        )
        # Full-market symbol list, refreshed with each snapshot build. Powers
        # name/code search for any stock, not just those in a limit-up pool.
        c.execute(
            """CREATE TABLE IF NOT EXISTS universe (
                   code TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   updated INTEGER NOT NULL
               )"""
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_universe_name ON universe(name)")
    klcache.init()
    history.init()
    llm.init()
    log.info("db ready at %s", cfg.DB_PATH)


def save_snapshot(date_str: str, payload: dict[str, Any]) -> None:
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO snapshots(date, ts, payload) VALUES (?,?,?)",
            (date_str, payload["ts"], json.dumps(payload, ensure_ascii=False)),
        )
        for r in payload.get("pools", {}).get("up", []):
            c.execute(
                "INSERT OR REPLACE INTO boards(date, code, streak) VALUES (?,?,?)",
                (date_str, r["code"], int(r.get("boards") or 0)),
            )


def load_snapshot(date_str: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT payload FROM snapshots WHERE date=?", (date_str,)).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


def snapshot_dates(limit: int = 500) -> list[str]:
    """All persisted snapshot dates, newest first (for the sitemap)."""
    with _conn() as c:
        rows = c.execute(
            "SELECT date FROM snapshots ORDER BY date DESC LIMIT ?", (limit,)
        ).fetchall()
    return [r["date"] for r in rows]


def snapshot_series(limit: int = 30) -> list[dict[str, Any]]:
    """Recent snapshots reduced to what the sentiment trend needs."""
    with _conn() as c:
        rows = c.execute(
            "SELECT date, payload FROM snapshots ORDER BY date DESC LIMIT ?", (limit,)
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            payload = json.loads(r["payload"])
        except (json.JSONDecodeError, TypeError):
            continue
        out.append(
            {
                "date": r["date"],
                "stats": payload.get("stats") or {},
                "promotionRate": (payload.get("compare") or {}).get("promotionRate"),
            }
        )
    return out


def save_universe(rows: list[dict[str, Any]]) -> None:
    """Persist the full-market code/name list for fast offline search."""
    now = int(time.time())
    pairs = [
        (str(r.get("code")), str(r.get("name") or "").strip(), now)
        for r in rows
        if r.get("code") and r.get("name")
    ]
    if not pairs:
        return
    try:
        with _conn() as c:
            c.executemany(
                "INSERT OR REPLACE INTO universe(code, name, updated) VALUES (?,?,?)",
                pairs,
            )
        log.debug("universe refreshed: %s symbols", len(pairs))
    except sqlite3.Error as exc:
        log.warning("universe refresh failed: %s", exc)


def search_universe(term: str, limit: int = 12) -> list[dict[str, Any]]:
    """Rank full-market symbols by code/name match, best first."""
    term = term.strip()
    if not term:
        return []
    like = f"%{term}%"
    prefix = f"{term}%"
    with _conn() as c:
        rows = c.execute(
            """SELECT code, name FROM universe
               WHERE code LIKE ? OR name LIKE ?
               ORDER BY
                 CASE
                   WHEN code = ?             THEN 0
                   WHEN code LIKE ?          THEN 1
                   WHEN name = ?             THEN 2
                   WHEN name LIKE ?          THEN 3
                   ELSE 4
                 END,
                 code
               LIMIT ?""",
            (like, like, term, prefix, term, prefix, max(1, min(limit, 50))),
        ).fetchall()
    return [{"code": r["code"], "name": r["name"]} for r in rows]


def universe_size() -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) AS n FROM universe").fetchone()["n"]


def prev_board_map(date_str: str) -> dict[str, int]:
    with _conn() as c:
        rows = c.execute(
            "SELECT code, streak FROM boards WHERE date=?", (date_str,)
        ).fetchall()
    return {r["code"]: r["streak"] for r in rows}


def _prev_trading_day(date_str: str) -> str:
    """Previous stored trading date, else the prior weekday."""
    with _conn() as c:
        row = c.execute(
            "SELECT date FROM snapshots WHERE date < ? ORDER BY date DESC LIMIT 1",
            (date_str,),
        ).fetchone()
        if row:
            return row["date"]
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    d = d.fromordinal(d.toordinal() - 1)
    while d.weekday() >= 5:
        d = d.fromordinal(d.toordinal() - 1)
    return d.isoformat()


# ---------------------------------------------------------------------------
# Snapshot builder
# ---------------------------------------------------------------------------
def cached_snapshot() -> dict[str, Any] | None:
    """Return the in-memory or stored snapshot without any network work.

    Callers that only need to look something up (such as the stock drawer) must
    not trigger a full-market rebuild.
    """
    today = cfg.cn_today()
    if _mem["key"] == today and _mem["payload"]:
        return _mem["payload"]
    return load_snapshot(today)


def mem_age() -> float:
    """Seconds since the in-memory snapshot was built (inf when absent)."""
    if not _mem["payload"] or _mem["key"] != cfg.cn_today():
        return float("inf")
    return time.time() - _mem["at"]


def snapshot_age(payload: dict[str, Any] | None) -> float:
    """Age of a snapshot document in seconds, from its own build timestamp.

    The payload's ``ts`` is milliseconds. Deriving freshness from the document
    itself (rather than the process-local ``_mem`` cache) means a restart, or a
    payload loaded back from SQLite, still reports a truthful age.
    """
    if not payload:
        return float("inf")
    ts = payload.get("ts")
    if not ts:
        return float("inf")
    try:
        return max(0.0, time.time() - float(ts) / 1000.0)
    except (TypeError, ValueError):
        return float("inf")


def build_snapshot(force: bool = False) -> dict[str, Any]:
    """Fetch, analyse and cache a full-market snapshot for today."""
    today = cfg.cn_today()
    now = time.time()
    if not force and _mem["key"] == today and _mem["payload"] and now - _mem["at"] < cfg.SNAPSHOT_TTL:
        return _mem["payload"]

    with _lock:
        if not force and _mem["key"] == today and _mem["payload"] and time.time() - _mem["at"] < cfg.SNAPSHOT_TTL:
            return _mem["payload"]

        raw = fetch.fetch_snapshot()
        if not raw:
            cached = load_snapshot(today) or _latest_snapshot()
            if cached:
                cached["stale"] = True
                log.warning("live fetch empty; serving cached snapshot")
                return cached
            return {
                "ts": fetch.now_ts(),
                "error": "行情源无返回，且本地无缓存快照",
                "stats": {}, "leaders": [], "ladder": [], "hot": [],
                "pools": {"up": [], "lb": [], "zb": [], "dt": []},
            }

        rows = [fetch.normalize(r) for r in raw]

        # Drop IPO first-day rows: their change % is relative to the issue
        # price, not the previous close, which would distort limit detection.
        rows = [r for r in rows if not _is_ipo_day(r)]

        pools: dict[str, list[dict[str, Any]]] = {"up": [], "lb": [], "zb": [], "dt": []}
        for r in rows:
            kind = analysis.classify(r)
            if kind:
                pools[kind].append(r)

        up = pools["up"]

        # Concept themes (新闻题材) and industry boards are separate taxonomies:
        # themes drive the badges and cluster counts, industries feed the score.
        concept_info = concepts.ensure([r["code"] for r in up]) if up else {}
        for r in up:
            info = concept_info.get(r["code"]) or {}
            themes = info.get("themes") or []
            industries = info.get("industries") or []
            r["concepts"] = themes[:8]
            r["industry"] = industries[0] if industries else ""
            # Headline reason: leading concept themes, then the top industry.
            head = themes[:3] or industries[:2]
            r["reason"] = " + ".join(head)
            r["conceptReasons"] = info.get("reasons") or {}

        # Consecutive-board streaks need daily history.
        code_list = [r["code"] for r in up]
        klines = fetch.fetch_all_concurrently(code_list, days=20) if code_list else {}
        for r in up:
            bars = klines.get(r["code"]) or []
            if bars:
                series = analysis.board_series(bars, r["name"], r["code"])
                streak, window = analysis.count_boards(series)
                r["boards"] = streak
                r["days"] = window
            else:
                r["boards"] = 1
                r["days"] = 1
            r["daysText"] = analysis.days_text(int(r["boards"]), int(r["days"]))
            r["boardType"] = _board_type(r, bars)
            r["market"] = analysis.board_of(r["code"], r["name"])
            r["floatCap"] = r["float_cap"]
            r["latest"] = r["price"]
            r["sucRate"] = None
            # Seal amount is not published by the snapshot feed; estimate the
            # sealed order value from turnover at the limit price.
            r["sealAmt"] = round(r["amount"] * 0.35) if r["amount"] else 0
            r["sealRatio"] = round(r["sealAmt"] / r["float_cap"] * 100, 2) if r["float_cap"] else 0.0
            r["openNum"] = _count_opens(r, bars)
            r["firstTime"] = "--:--"
            r["again"] = 1 if int(r["boards"]) >= 2 else 0
            r["isNew"] = 1 if int(r["boards"]) == 1 else 0

        analysis.annotate_sectors(up)
        for kind in ("zb", "dt"):
            for r in pools[kind]:
                r["daysText"] = "—"
                r["boardType"] = ""
                r["boards"] = 0
                r["days"] = 0
                r["market"] = analysis.board_of(r["code"], r["name"])
                r["latest"] = r["price"]
                r["reason"] = ""
                r["sucRate"] = None
                r["floatCap"] = r["float_cap"]
                r["sealAmt"] = 0
                r["sealRatio"] = 0.0
                r["openNum"] = 0
                r["firstTime"] = "--:--"

        # Enrich with the exchange's own pool feed before scoring: the real sealed
        # value feeds the score, and first-seal time / break count cannot be
        # derived from the snapshot at all. A failure here keeps the estimates.
        try:
            zt = ztpool.fetch_pools(today.replace("-", ""))
            if zt.get("up"):
                hit = ztpool.apply(up, zt["up"])
                log.info(
                    "ztpool: enriched %s/%s limit-up rows (qdate=%s)",
                    hit, len(up), zt.get("date") or "?",
                )
            if zt.get("down"):
                ztpool.apply(pools["dt"], zt["down"])
        except Exception as exc:
            log.warning("ztpool enrichment skipped: %s", exc)

        prev = prev_board_map(_prev_trading_day(today))
        prev_date = _prev_trading_day(today)
        prev_max = max(prev.values(), default=None) if prev else None

        max_board = max((int(r["boards"]) for r in up), default=0)
        for r in up:
            r["score"] = analysis.score_stock(r, max_board)

        up_sorted = sorted(up, key=lambda r: -r["score"]["total"])
        leaders = up_sorted[:12]
        pools["lb"] = sorted([r for r in up if int(r["boards"]) >= 2], key=lambda r: -int(r["boards"]))
        pools["up"] = up_sorted

        # Previous-session ladder, reconstructed from daily bars when no stored
        # snapshot exists for that date.
        prev_history = history.build_previous_ladder(rows, session_date=today)
        if not prev:
            prev = {
                item["code"]: g["board"]
                for g in (prev_history or {}).get("groups", [])
                for item in g["list"]
            }
            prev_date = (prev_history or {}).get("date") or prev_date
            prev_max = max(prev.values(), default=None) if prev else None

        payload = {
            "ts": fetch.now_ts(),
            "stats": analysis.stats_block(up, pools["zb"], pools["dt"], len(rows), today, prev_date, prev_max),
            "leaders": [strip_internal(r) | {"score": r["score"], "preview": []} for r in leaders],
            "ladder": analysis.build_ladder(up, prev),
            "hot": analysis.build_hot(up),
            "pools": {
                k: [strip_internal(r) | {"score": r.get("score"), "preview": []} for r in v]
                for k, v in pools.items()
            },
            "compare": _build_compare(up, prev, prev_date, prev_history),
            "chongci": _build_chongci(pools["zb"]),
            "drawdown": _build_drawdown(pools["zb"], pools["dt"]),
            "stale": False,
        }

        save_snapshot(today, payload)
        save_universe(rows)
        _mem.update({"key": today, "at": time.time(), "payload": payload})
        log.info(
            "snapshot built: up=%s zb=%s dt=%s scanned=%s",
            len(up), len(pools["zb"]), len(pools["dt"]), len(rows),
        )
        return payload


def _is_ipo_day(r: dict[str, Any]) -> bool:
    name = (r.get("name") or "").strip()
    return name.startswith(("N", "C")) and not name.startswith("NST")


def _board_type(r: dict[str, Any], bars: list[dict[str, Any]] | None = None) -> str:
    """Classify the seal pattern from today's OHLC range.

    A single-seal (一字) day opens, closes and trades only at the limit; a T-board
    opens away from the limit before sealing; everything else sealed during
    regular trading.
    """
    high = r.get("high") or 0
    low = r.get("low") or 0
    open_ = r.get("open") or 0
    price = r.get("price") or 0
    pre = r.get("pre_close") or 0
    if not (high and low and pre):
        return "换手板"
    flat_range = abs(high - low) < max(1e-6, pre * 0.0005)
    if flat_range:
        return "一字板"
    open_near_limit = abs(open_ - high) < max(1e-6, pre * 0.0005)
    if open_near_limit:
        return "T字板"
    return "换手板"


def _count_opens(r: dict[str, Any], bars: list[dict[str, Any]] | None = None) -> int:
    """Estimate how many times the limit was opened today.

    The snapshot feed has no tick history, so this is derived from the day's
    range: a wide low-to-close spread implies the limit broke at least once.
    """
    high = r.get("high") or 0
    low = r.get("low") or 0
    price = r.get("price") or 0
    pre = r.get("pre_close") or 0
    if not (high and price and pre):
        return 0
    if abs(price - high) > max(1e-6, pre * 0.0005):
        return 0
    spread = (high - low) / pre * 100
    lim = analysis.limit_pct(r["code"], r["name"])
    if spread < lim * 0.2:
        return 0
    return min(3, max(1, int(spread / (lim * 0.5))))


def strip_internal(r: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in r.items() if not k.startswith("_")}


def _build_compare(
    up: list[dict[str, Any]],
    prev: dict[str, int],
    prev_date: str,
    prev_history: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Today's ladder beside the previous session's, for promotional-rate review."""
    today_groups: dict[int, list[dict[str, Any]]] = {}
    for r in up:
        b = int(r["boards"])
        if b >= 1:
            today_groups.setdefault(b, []).append(
                {"code": r["code"], "name": r["name"], "chg": r["chg"]}
            )

    if prev_history and prev_history.get("groups"):
        yest = prev_history["groups"]
        prev_date = prev_history.get("date") or prev_date
        yest_total = prev_history.get("total", 0)
    else:
        groups: dict[int, list[dict[str, Any]]] = {}
        for code, b in prev.items():
            if b >= 1:
                groups.setdefault(b, []).append({"code": code, "name": "", "chg": 0.0})
        yest = [
            {"board": b, "label": f"昨日{b}板", "list": groups[b]}
            for b in sorted(groups, reverse=True)
        ]
        yest_total = sum(len(v) for v in groups.values())

    today = [
        {"board": b, "label": f"今日{b}板", "list": sorted(today_groups[b], key=lambda x: -x["chg"])}
        for b in sorted(today_groups, reverse=True)
    ]

    return {
        "prevDate": prev_date,
        "yest": yest,
        "today": today,
        "todayNew": [
            {"code": r["code"], "name": r["name"], "chg": r["chg"]}
            for r in sorted(up, key=lambda x: -x["chg"])[:30]
        ],
        "yestTotal": yest_total,
        "todayTotal": len(up),
        "promotionRate": round(len(up) / yest_total * 100, 1) if yest_total else None,
    }


def _build_chongci(zb: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for r in sorted(zb, key=lambda x: -x["chg"])[:30]:
        lim = analysis.limit_pct(r["code"], r["name"])
        out.append({
            "code": r["code"],
            "name": r["name"],
            "price": r["price"],
            "chg": r["chg"],
            "speed": 0,
            "turnover": r["turnover"],
            "amount": r["amount"],
            "floatCap": r["float_cap"],
            "high": r["high"],
            "low": r["low"],
            "limitChg": lim,
            "gap": round(lim - r["chg"], 2),
        })
    return out


def _build_drawdown(zb: list[dict[str, Any]], dt: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for r in zb + dt:
        high = r.get("high") or 0
        pre = r.get("pre_close") or 0
        if not high or not pre:
            continue
        high_chg = round((high - pre) / pre * 100, 2)
        dd = round(r["chg"] - high_chg, 2)
        out.append({
            "code": r["code"],
            "name": r["name"],
            "price": r["price"],
            "chg": r["chg"],
            "highChg": high_chg,
            "dd": dd,
            "boardType": "",
            "boards": 0,
            "reason": "",
            "attr": "",
        })
    return sorted(out, key=lambda x: x["dd"])[:30]


def _latest_snapshot() -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT payload FROM snapshots ORDER BY date DESC LIMIT 1").fetchone()
    return json.loads(row["payload"]) if row else None
