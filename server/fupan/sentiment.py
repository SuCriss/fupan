"""Composite market-sentiment score for a single trading day.

The score is a weighted blend of five observable review metrics so a reader can
see *why* the market felt hot or cold, not just a single opaque number. Every
component is normalised to 0-100 and the weights sum to 1.0.
"""

from __future__ import annotations

from typing import Any

# (key, weight, human note). Weights are intentionally stable so the score is
# comparable across days.
WEIGHTS = {
    "breadth": 0.30,  # 赚钱效应：涨停 vs 跌停
    "seal": 0.22,  # 封板率
    "anti_broken": 0.13,  # 炸板抗性
    "promotion": 0.20,  # 连板晋级率
    "height": 0.15,  # 市场高度（最高板）
}

# A 7-board market is treated as "full heat" for the height component.
HEIGHT_FULL_BOARD = 7


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _label(score: float) -> tuple[str, str]:
    """Return (label, tone) for a 0-100 score."""
    if score < 20:
        return "冰点", "cold"
    if score < 40:
        return "偏冷", "cold"
    if score < 60:
        return "中性", "mild"
    if score < 80:
        return "偏热", "hot"
    return "过热", "hot"


def score(stats: dict[str, Any] | None, promotion_rate: float | None = None) -> dict[str, Any]:
    """Blend the daily review metrics into a 0-100 sentiment reading.

    ``promotion_rate`` comes from the day's yesterday-vs-today ladder; when it
    is unavailable the component falls back to a neutral 50.
    """
    stats = stats or {}
    up = int(stats.get("upCount") or 0)
    down = int(stats.get("downCount") or 0)
    seal = float(stats.get("sealRate") or 0.0)
    broken = float(stats.get("brokenRate") or 0.0)
    max_board = int(stats.get("maxBoard") or 0)

    # A day with no observed activity has no meaningful reading; say so rather
    # than letting the "0% broken" default masquerade as a cold-but-real score.
    if not up and not down and not seal and not max_board:
        return {"score": None, "label": "—", "tone": "mild", "parts": []}

    attempts = up + down
    breadth = (up / attempts * 100.0) if attempts else 50.0
    anti_broken = 100.0 - broken
    promotion = float(promotion_rate) if promotion_rate is not None else 50.0
    height = min(max_board / HEIGHT_FULL_BOARD * 100.0, 100.0)

    parts = [
        {
            "k": "赚钱效应",
            "key": "breadth",
            "v": round(_clamp(breadth), 1),
            "w": WEIGHTS["breadth"],
            "note": f"{up} 涨 / {down} 跌",
        },
        {
            "k": "封板率",
            "key": "seal",
            "v": round(_clamp(seal), 1),
            "w": WEIGHTS["seal"],
            "note": f"封住 {seal:g}%",
        },
        {
            "k": "炸板抗性",
            "key": "anti_broken",
            "v": round(_clamp(anti_broken), 1),
            "w": WEIGHTS["anti_broken"],
            "note": f"炸板 {broken:g}%",
        },
        {
            "k": "连板晋级",
            "key": "promotion",
            "v": round(_clamp(promotion), 1),
            "w": WEIGHTS["promotion"],
            "note": "今日 / 昨日" if promotion_rate is not None else "数据不足",
        },
        {
            "k": "市场高度",
            "key": "height",
            "v": round(_clamp(height), 1),
            "w": WEIGHTS["height"],
            "note": f"最高 {max_board} 板",
        },
    ]

    total = round(sum(p["v"] * p["w"] for p in parts), 1)
    label, tone = _label(total)
    return {"score": total, "label": label, "tone": tone, "parts": parts}
