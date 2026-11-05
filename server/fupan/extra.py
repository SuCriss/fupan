"""Supplementary per-stock data for the detail drawer.

Three independent additions, each from a source verified reachable from this
host:

* Money flow — Sina's ``MoneyFlow`` feed. Eastmoney's ``push2`` fund-flow API
  answers with a 302 from here, so Sina is the working source.
* Dragon-tiger list (龙虎榜) — Eastmoney's ``datacenter-web`` report API.
* Limit-up history — derived locally from the daily bars we already fetch, so
  it costs no extra request and never disagrees with the K-line chart.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import analysis, config, fetch

log = logging.getLogger(__name__)

_MF_TODAY = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "MoneyFlow.ssi_ssfx_flzjtj?daima={sym}"
)
_MF_HIST = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "MoneyFlow.ssl_qsfx_zjlrqs?page=1&num={n}&sort=opendate&asc=0&daima={sym}"
)
_LHB = (
    "https://datacenter-web.eastmoney.com/api/data/v1/get"
    "?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL"
    "&filter=(SECURITY_CODE%3D%22{code}%22)"
    "&pageNumber=1&pageSize={n}&sortColumns=TRADE_DATE&sortTypes=-1"
)

SINA_REFERER = "https://finance.sina.com.cn/"
EM_REFERER = "https://data.eastmoney.com/"

# The limit-up history looks back this many daily bars (roughly one year).
HISTORY_BARS = 250

# Supplementary panels must never stall the drawer, so they get a tighter
# deadline than the global HTTP timeout.
PANEL_TIMEOUT = 8.0


def _get_text(url: str, referer: str) -> str:
    return fetch._request(url, referer, timeout=PANEL_TIMEOUT).decode("utf-8", "replace")


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _loads(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def money_flow(code: str, days: int = 10) -> dict[str, Any] | None:
    """Today's order-size breakdown plus the recent net-flow history."""
    sym = fetch.to_symbol(code)
    try:
        today_doc = _loads(_get_text(_MF_TODAY.format(sym=sym), SINA_REFERER))
        hist_doc = _loads(_get_text(_MF_HIST.format(sym=sym, n=days), SINA_REFERER))
    except Exception as exc:  # a failed side panel must not break the drawer
        log.debug("money flow unavailable for %s: %s", code, exc)
        return None

    today = None
    if isinstance(today_doc, dict) and today_doc.get("name"):
        r0_in, r0_out = _f(today_doc.get("r0_in")), _f(today_doc.get("r0_out"))
        r1_in, r1_out = _f(today_doc.get("r1_in")), _f(today_doc.get("r1_out"))
        r2_in, r2_out = _f(today_doc.get("r2_in")), _f(today_doc.get("r2_out"))
        r3_in, r3_out = _f(today_doc.get("r3_in")), _f(today_doc.get("r3_out"))
        today = {
            "main": _f(today_doc.get("netamount")),  # 主力净额
            "super": r0_in - r0_out,  # 超大单净额
            "big": r1_in - r1_out,  # 大单净额
            "mid": r2_in - r2_out,  # 中单净额
            "small": r3_in - r3_out,  # 小单净额
            "turnover": _f(today_doc.get("turnover")),
        }

    history: list[dict[str, Any]] = []
    if isinstance(hist_doc, list):
        for row in hist_doc[:days]:
            if not isinstance(row, dict):
                continue
            history.append(
                {
                    "date": row.get("opendate"),
                    "main": _f(row.get("netamount")),
                    "super": _f(row.get("r0_net")),
                    "chg": round(_f(row.get("changeratio")) * 100, 2),
                }
            )

    if not today and not history:
        return None
    return {"today": today, "history": history}


def lhb(code: str, limit: int = 5) -> list[dict[str, Any]]:
    """Recent dragon-tiger list appearances for one stock."""
    try:
        doc = _loads(_get_text(_LHB.format(code=code, n=limit), EM_REFERER))
    except Exception as exc:
        log.debug("dragon-tiger unavailable for %s: %s", code, exc)
        return []

    rows = ((doc or {}).get("result") or {}).get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        nxt = row.get("D1_CLOSE_ADJCHRATE")
        out.append(
            {
                "date": (row.get("TRADE_DATE") or "")[:10],
                "reason": row.get("EXPLANATION") or "",
                "note": row.get("EXPLAIN") or "",
                "buy": _f(row.get("BILLBOARD_BUY_AMT")),
                "sell": _f(row.get("BILLBOARD_SELL_AMT")),
                "net": _f(row.get("BILLBOARD_NET_AMT")),
                "chg": _f(row.get("CHANGE_RATE")),
                "nextChg": round(_f(nxt), 2) if nxt is not None else None,
            }
        )
    return out


def limitup_history(
    bars: list[dict[str, Any]], code: str, name: str
) -> dict[str, Any] | None:
    """Limit-up record over the recent window, derived from daily bars.

    "Promotion" (晋级) means the day after a sealed limit-up was also a sealed
    limit-up — the event a 连板 trader actually cares about.
    """
    if len(bars) < 2:
        return None
    window = bars[-HISTORY_BARS:]
    limit = analysis.limit_pct(code, name)
    tol = config.SEALED_TOLERANCE

    sealed: list[int] = []
    broken = 0
    for i in range(1, len(window)):
        prev_close = _f(window[i - 1].get("close"))
        if prev_close <= 0:
            continue
        high_chg = (_f(window[i].get("high")) - prev_close) / prev_close * 100
        close_chg = (_f(window[i].get("close")) - prev_close) / prev_close * 100
        if close_chg >= limit - tol:
            sealed.append(i)
        elif high_chg >= limit - tol:
            broken += 1

    promoted = 0
    next_chgs: list[float] = []
    for i in sealed:
        if i + 1 >= len(window):
            continue
        base = _f(window[i].get("close"))
        if base <= 0:
            continue
        nxt_chg = (_f(window[i + 1].get("close")) - base) / base * 100
        next_chgs.append(nxt_chg)
        if nxt_chg >= limit - tol:
            promoted += 1

    ups = len(sealed)
    attempts = ups + broken
    return {
        "window": len(window),
        "limitUps": ups,
        "promoted": promoted,
        "promoteRate": round(promoted / ups * 100, 1) if ups else None,
        "broken": broken,
        "sealRate": round(ups / attempts * 100, 1) if attempts else None,
        "avgNextChg": round(sum(next_chgs) / len(next_chgs), 2) if next_chgs else None,
    }
