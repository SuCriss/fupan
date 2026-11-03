"""Resolve real concept themes (概念题材) for stocks.

Two distinct taxonomies are needed and they must not be confused:

* **Industry** (行业) — 农林牧渔 / 农产品加工. Used for the sector-cluster count
  in the scoring model.
* **Concept theme** (概念题材) — 水产概念 / 预制菜概念 / 幽门螺杆菌概念. These are
  the news-driven tags traders actually read and the ones shown as badges.

Eastmoney's datacenter `RPT_F10_CORETHEME_BOARDTYPE` report returns both plus
listing-attribute rows (融资融券, 深股通, 题材股 …). `IS_PRECISE == "1"` marks the
genuine concept-theme rows; everything else is an industry board, a region or a
statistical screen and is kept out of the theme list.

Rows also carry `SELECTED_BOARD_REASON`, the disclosure-based justification for
membership, surfaced as the stock's "涨停原因" context.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import ssl
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import config as cfg

log = logging.getLogger("fupan.concepts")

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE

DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get"
REPORT = "RPT_F10_CORETHEME_BOARDTYPE"

# Securities per datacenter request.
BATCH = 40


def _secu(code: str) -> str:
    return f"{code}.SH" if code.startswith(("6", "9")) else f"{code}.SZ"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(cfg.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS stock_concepts (
                   code TEXT PRIMARY KEY,
                   themes TEXT NOT NULL,
                   industries TEXT NOT NULL,
                   reasons TEXT NOT NULL,
                   fetched_at INTEGER NOT NULL
               )"""
        )


def _fetch_batch(codes: list[str]) -> dict[str, dict[str, Any]]:
    """One datacenter request covering several securities."""
    flt = "(SECUCODE in (" + ",".join(f'"{_secu(c)}"' for c in codes) + "))"
    params = {
        "reportName": REPORT,
        "columns": "SECUCODE,SECURITY_CODE,BOARD_NAME,IS_PRECISE,SELECTED_BOARD_REASON",
        "filter": flt,
        "pageNumber": "1",
        "pageSize": "1000",
        "sortColumns": "BOARD_RANK",
        "sortTypes": "1",
        "source": "HSF10",
        "client": "PC",
    }
    url = DATACENTER + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={"User-Agent": cfg.USER_AGENT, "Referer": "https://data.eastmoney.com/"}
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.HTTP_TIMEOUT, context=_SSL) as r:
            payload = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as exc:
        log.warning("concept batch failed (%s codes): %s", len(codes), exc)
        return {}

    rows = (payload.get("result") or {}).get("data") or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = row.get("SECURITY_CODE")
        if not code:
            continue
        bucket = out.setdefault(code, {"themes": [], "industries": [], "reasons": {}})
        name = (row.get("BOARD_NAME") or "").strip()
        if not name:
            continue
        if str(row.get("IS_PRECISE")) == "1":
            if name not in bucket["themes"]:
                bucket["themes"].append(name)
            reason = (row.get("SELECTED_BOARD_REASON") or "").strip()
            if reason:
                bucket["reasons"].setdefault(name, reason)
        else:
            if name not in bucket["industries"]:
                bucket["industries"].append(name)
    return out


def ensure(codes: list[str], max_workers: int = 6, refresh_days: int = 30) -> dict[str, dict[str, Any]]:
    """Return {code: {themes, industries, reasons}} fetching only stale entries."""
    if not codes:
        return {}
    init()
    have: dict[str, dict[str, Any]] = {}
    cutoff = int(time.time()) - refresh_days * 86400
    with _conn() as c:
        for r in c.execute(
            "SELECT code, themes, industries, reasons, fetched_at FROM stock_concepts"
        ):
            if r["fetched_at"] < cutoff:
                continue
            have[r["code"]] = {
                "themes": json.loads(r["themes"]),
                "industries": json.loads(r["industries"]),
                "reasons": json.loads(r["reasons"]),
            }

    missing = [c for c in codes if c not in have]
    if missing:
        chunks = [missing[i : i + BATCH] for i in range(0, len(missing), BATCH)]
        log.info("fetching concept themes for %s stocks (%s batches)", len(missing), len(chunks))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            results = list(pool.map(_fetch_batch, chunks))

        now = int(time.time())
        with _conn() as c:
            for batch_result in results:
                for code, payload in batch_result.items():
                    c.execute(
                        "INSERT OR REPLACE INTO stock_concepts"
                        "(code, themes, industries, reasons, fetched_at) VALUES (?,?,?,?,?)",
                        (
                            code,
                            json.dumps(payload["themes"], ensure_ascii=False),
                            json.dumps(payload["industries"], ensure_ascii=False),
                            json.dumps(payload["reasons"], ensure_ascii=False),
                            now,
                        ),
                    )
                    have[code] = payload

    return {c: have.get(c) or {"themes": [], "industries": [], "reasons": {}} for c in codes}


def build_clusters(rows: list[dict[str, Any]], top: int = 12) -> list[dict[str, Any]]:
    """Count limit-ups sharing each concept theme, strongest cluster first."""
    counts: dict[str, int] = {}
    for r in rows:
        for t in r.get("concepts") or []:
            counts[t] = counts.get(t, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"name": k, "n": v} for k, v in ranked if v >= 2][:top]
