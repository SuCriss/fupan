"""Daily-bar indicator computation: moving averages, MACD, and period resampling.

Everything here is derived arithmetic over the bars the caller already fetched;
no network access and no third-party dependencies.
"""

from __future__ import annotations

from typing import Any

PERIODS = ("day", "week", "month", "quarter")


# ---------------------------------------------------------------------------
# Indicator primitives
# ---------------------------------------------------------------------------
def sma(values: list[float | None], window: int) -> list[float | None]:
    """Simple moving average; None until the window is full."""
    out: list[float | None] = []
    total = 0.0
    for i, v in enumerate(values):
        if v is None:
            out.append(None)
            continue
        total += v
        if i >= window:
            prev = values[i - window]
            total -= prev if prev is not None else 0.0
        out.append(round(total / window, 3) if i >= window - 1 else None)
    return out


def ema(values: list[float], window: int) -> list[float]:
    """Exponential moving average seeded with the first value."""
    if not values:
        return []
    k = 2.0 / (window + 1.0)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def macd(
    closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[list[float], list[float], list[float]]:
    """Return (DIF, DEA, MACD histogram) using the standard A-share convention."""
    if not closes:
        return [], [], []
    ef = ema(closes, fast)
    es = ema(closes, slow)
    dif = [a - b for a, b in zip(ef, es)]
    dea = ema(dif, signal)
    hist = [(d - e) * 2 for d, e in zip(dif, dea)]
    return (
        [round(x, 4) for x in dif],
        [round(x, 4) for x in dea],
        [round(x, 4) for x in hist],
    )


# ---------------------------------------------------------------------------
# Period resampling
# ---------------------------------------------------------------------------
def _bucket_key(date_str: str, period: str) -> str:
    y = int(date_str[0:4])
    m = int(date_str[5:7])
    if period == "month":
        return f"{y}-{m:02d}"
    if period == "quarter":
        return f"{y}-Q{(m - 1) // 3 + 1}"
    if period == "week":
        # ISO-ish week bucket keyed by the Monday of that week.
        import datetime as dt

        d = dt.date.fromisoformat(date_str)
        monday = d - dt.timedelta(days=d.weekday())
        return monday.isoformat()
    return date_str


def resample(bars: list[dict[str, Any]], period: str) -> list[dict[str, Any]]:
    """Aggregate daily bars into week/month/quarter bars (day passes through)."""
    if period == "day" or period not in PERIODS:
        return list(bars)

    out: list[dict[str, Any]] = []
    current_key: str | None = None
    cur: dict[str, Any] | None = None
    for b in bars:
        key = _bucket_key(b["date"], period)
        if key != current_key:
            if cur:
                out.append(cur)
            current_key = key
            cur = {
                "date": b["date"],
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b["volume"],
            }
        else:
            cur["date"] = b["date"]
            cur["high"] = max(cur["high"], b["high"])
            cur["low"] = min(cur["low"], b["low"])
            cur["close"] = b["close"]
            cur["volume"] += b["volume"]
    if cur:
        out.append(cur)
    return out


# ---------------------------------------------------------------------------
# Analysis conclusion
# ---------------------------------------------------------------------------
def analyse(
    bars: list[dict[str, Any]], period: str, code: str = "", name: str = ""
) -> dict[str, Any] | None:
    """Derive a volume/price read: tone, score, position in range and features.

    Quarterly resampling of a few years yields only ~10 bars, so the minimum is
    kept low; indicators that need more history simply render as unavailable.
    """
    if len(bars) < 8:
        return None

    closes = [b["close"] for b in bars]
    vols = [b["volume"] for b in bars]
    last = bars[-1]
    ma5 = sma(closes, 5)[-1]
    ma10 = sma(closes, 10)[-1]
    ma20 = sma(closes, 20)[-1]
    dif, dea, hist = macd(closes)
    d_now, e_now, h_now = dif[-1], dea[-1], hist[-1]
    d_prev, e_prev = dif[-2], dea[-2]

    score = 0
    tags: list[str] = []
    notes: list[dict[str, str]] = []

    # Moving-average alignment.
    if ma5 and ma10 and ma20:
        if ma5 > ma10 > ma20:
            score += 2
            tags.append("均线多头")
        elif ma5 < ma10 < ma20:
            score -= 2
            tags.append("均线空头")
        notes.append({
            "k": "均线",
            "v": f"MA5 {ma5:.2f} / MA10 {ma10:.2f} / MA20 {ma20:.2f}",
        })

    # Price versus MA20.
    if ma20:
        if last["close"] > ma20:
            score += 1
            tags.append("站上MA20")
        else:
            score -= 1
            tags.append("跌破MA20")

    # MACD state and crossover.
    if d_now > e_now:
        score += 1
        if d_prev <= e_prev:
            score += 1
            tags.append("MACD金叉")
    else:
        score -= 1
        if d_prev >= e_prev:
            score -= 1
            tags.append("MACD死叉")
    notes.append({"k": "MACD", "v": f"DIF {d_now:.3f} / DEA {e_now:.3f} / 柱 {h_now:+.3f}"})

    # Volume trend versus recent average.
    recent = vols[-1]
    avg5 = sum(vols[-6:-1]) / 5 if len(vols) >= 6 else 0
    if avg5:
        ratio = recent / avg5
        if ratio >= 1.5:
            score += 1
            tags.append(f"放量 {ratio:.1f}倍")
        elif ratio <= 0.6:
            score -= 1
            tags.append(f"缩量 {ratio:.2f}倍")
        notes.append({"k": "量能", "v": f"较前5日均量 {ratio:.2f}倍"})

    # Position within the observed range.
    lo = min(b["low"] for b in bars)
    hi = max(b["high"] for b in bars)
    pos = int(round((last["close"] - lo) / (hi - lo) * 100)) if hi > lo else 50
    if pos >= 85:
        tags.append("近区间高位")
    elif pos <= 15:
        tags.append("近区间低位")
    notes.append({"k": "区间", "v": f"{lo:.2f} – {hi:.2f}（{len(bars)}根）"})

    # Consecutive limit-up run, useful context for A-share readers.
    from . import analysis

    limit = analysis.limit_pct(code or "000000", name or "")
    streak = 0
    for i in range(len(bars) - 1, 0, -1):
        prev_c, cur_c = bars[i - 1]["close"], bars[i]["close"]
        if prev_c > 0 and (cur_c - prev_c) / prev_c * 100 >= limit - 0.35:
            streak += 1
        else:
            break
    if streak >= 1:
        notes.append({"k": "涨停", "v": f"最近连续 {streak} 个{PERIOD_LABEL.get(period, '日')}封板"})

    tone = "up" if score >= 2 else "down" if score <= -2 else "flat"
    title = {
        "up": "量价配合，趋势偏强",
        "down": "量价背离，趋势偏弱",
        "flat": "多空僵持，等待方向",
    }[tone]

    return {
        "tone": tone,
        "title": title,
        "score": score,
        "pos": pos,
        "tags": tags or ["无明显特征"],
        "notes": notes,
        "period": period,
    }


PERIOD_LABEL = {
    "day": "日线",
    "week": "周线",
    "month": "月线",
    "quarter": "季线",
}


def enrich(bars: list[dict[str, Any]], period: str = "day") -> list[dict[str, Any]]:
    """Attach MA and MACD fields to each bar for rendering."""
    if not bars:
        return []
    closes = [b["close"] for b in bars]
    ma = {w: sma(closes, w) for w in (5, 10, 20, 60)}
    dif, dea, hist = macd(closes)
    out = []
    for i, b in enumerate(bars):
        out.append({
            "d": b["date"],
            "o": round(b["open"], 2),
            "h": round(b["high"], 2),
            "l": round(b["low"], 2),
            "c": round(b["close"], 2),
            "v": b["volume"],
            "ma5": ma[5][i],
            "ma10": ma[10][i],
            "ma20": ma[20][i],
            "ma60": ma[60][i],
            "dif": dif[i],
            "dea": dea[i],
            "macd": hist[i],
        })
    return out
