"""Market analysis: limit-up detection, board ladder, scoring model.

The scoring model mirrors the observed shape of the reference tool: seven
weighted components (height / seal / board type / turnover / success rate /
sector / position) summing to 100, with a grade label derived from the total.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Iterable

from . import config as cfg

# ---------------------------------------------------------------------------
# Board classification
# ---------------------------------------------------------------------------
def limit_pct(code: str, name: str) -> float:
    """Daily price-limit percentage for this stock."""
    st = "ST" in (name or "").upper()
    c = str(code)
    if c.startswith(("300", "301")):
        return cfg.LIMIT_ST if st else cfg.LIMIT_CHINEXT
    if c.startswith("688"):
        return cfg.LIMIT_ST if st else cfg.LIMIT_STAR
    if c.startswith(("8", "4", "920")):
        return cfg.LIMIT_BSE
    return cfg.LIMIT_ST if st else cfg.LIMIT_MAIN


def board_of(code: str, name: str) -> str:
    c = str(code)
    if c.startswith(("300", "301")):
        return "创业板"
    if c.startswith("688"):
        return "科创板"
    if c.startswith(("8", "4", "920")):
        return "北交所"
    if c.startswith(("60", "68")):
        return "沪市"
    return "深市"


def classify(row: dict[str, Any]) -> str:
    """Return 'up' (sealed limit-up), 'zb' (broken), 'dt' (limit-down) or ''."""
    pct = row.get("chg") or 0.0
    lim = limit_pct(row["code"], row["name"])
    if pct >= lim - cfg.SEALED_TOLERANCE:
        return "up"
    if pct <= -(lim - cfg.SEALED_TOLERANCE):
        return "dt"
    if pct >= lim - cfg.BROKEN_WINDOW:
        return "zb"
    return ""


# ---------------------------------------------------------------------------
# Consecutive-board history
# ---------------------------------------------------------------------------
def board_series(klines: list[dict[str, Any]], name: str, code: str) -> list[bool]:
    """Boolean list: did each bar close at its limit?"""
    lim = limit_pct(code, name)
    out = []
    prev_close = None
    for bar in klines:
        close = bar.get("close")
        if prev_close and close and prev_close > 0:
            pct = (close - prev_close) / prev_close * 100
            out.append(pct >= lim - 0.35)
        else:
            out.append(False)
        prev_close = close
    return out


def count_boards(series: list[bool]) -> tuple[int, int]:
    """(consecutive boards ending today, boards within last 10 sessions)."""
    if not series:
        return 0, 0
    streak = 0
    for hit in reversed(series):
        if hit:
            streak += 1
        else:
            break
    window = sum(1 for h in series[-10:] if h)
    return streak, window


def days_text(streak: int, window: int) -> str:
    if streak <= 0:
        return "首板"
    if streak == 1 and window <= 1:
        return "首板"
    if streak == window:
        return f"{streak}连板"
    return f"{window}天{streak}板"


# ---------------------------------------------------------------------------
# Sector attribution
# ---------------------------------------------------------------------------
_GENERIC = re.compile(r"[+\-·,，、]")


def sector_from_reason(reason: str) -> str:
    """Pick the leading theme token from a concept-reason string."""
    if not reason:
        return ""
    head = re.split(r"[+＋]", reason)[0].strip()
    head = head.strip("“”\"' ")
    return head


def build_sectors(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Count limit-ups per concept theme.

    Every concept a stock carries is counted (not only its headline sector), so
    a chip's count always equals the number of limit-ups that concept appears on
    — and therefore equals what a concept filter will show.
    """
    counts: Counter[str] = Counter()
    for r in rows:
        themes = r.get("concepts") or []
        if themes:
            for t in themes:
                counts[t] += 1
        elif r.get("industry"):
            counts[r["industry"]] += 1
    return [
        {"name": k, "n": v}
        for k, v in counts.most_common(16)
        if v >= 2
    ]


def build_sector_detail(rows: list[dict[str, Any]], limit: int = 24) -> list[dict[str, Any]]:
    """Aggregate the limit-up pool into ranked sector dossiers.

    Membership follows :func:`build_sectors`: a stock counts toward *every*
    concept it carries, so a sector's 涨停家数 always equals what the matching
    concept filter shows. Each dossier carries the leaders, the board ladder and
    the member rows so the UI needs a single request.
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        themes = [t for t in (r.get("concepts") or [])[:8] if t]
        if not themes and r.get("industry"):
            themes = [r["industry"]]
        for t in themes:
            groups.setdefault(t, []).append(r)

    out: list[dict[str, Any]] = []
    for name, members in groups.items():
        if len(members) < 2:
            continue

        # A limit-up is at least a first board; normalise the occasional 0 so a
        # sector cannot show "首板" and "1板" as two different rungs.
        def boards_of(m: dict[str, Any]) -> int:
            return max(1, int(m.get("boards") or 0))

        boards = [boards_of(m) for m in members]
        max_board = max(boards)
        lianban = sum(1 for b in boards if b >= 2)
        chgs = [float(m.get("chg") or 0) for m in members]
        avg_chg = round(sum(chgs) / len(chgs), 2) if chgs else 0.0
        seal_amt = sum(float(m.get("sealAmt") or 0) for m in members)

        def score_of(m: dict[str, Any]) -> float:
            sc = m.get("score") or {}
            return float(sc.get("total") or 0) if isinstance(sc, dict) else 0.0

        ordered = sorted(
            members, key=lambda m: (-boards_of(m), -score_of(m))
        )

        # Heat blends breadth, market height, follow-through and momentum, so a
        # one-stock fluke cannot outrank a broad, tall sector.
        heat = round(
            min(40.0, len(members) * 4.0)
            + min(32.0, max_board * 8.0)
            + min(15.0, lianban * 3.0)
            + min(13.0, max(0.0, avg_chg) * 2.0),
            1,
        )

        ladder: dict[int, list[dict[str, Any]]] = {}
        for m in ordered:
            ladder.setdefault(boards_of(m), []).append(m)

        out.append(
            {
                "name": name,
                "n": len(members),
                "maxBoard": max_board,
                "lianban": lianban,
                "avgChg": avg_chg,
                "sealAmt": seal_amt,
                "heat": heat,
                "leaders": [
                    {
                        "code": m.get("code"),
                        "name": m.get("name"),
                        "boards": boards_of(m),
                        "chg": m.get("chg"),
                        "score": score_of(m),
                    }
                    for m in ordered[:3]
                ],
                "ladder": [
                    {
                        "board": b,
                        "label": "首板" if b <= 1 else f"{b}板",
                        "list": [
                            {
                                "code": m.get("code"),
                                "name": m.get("name"),
                                "chg": m.get("chg"),
                                "score": score_of(m),
                            }
                            for m in ladder[b]
                        ],
                    }
                    for b in sorted(ladder, reverse=True)
                ],
                "members": [
                    {
                        "code": m.get("code"),
                        "name": m.get("name"),
                        "boards": boards_of(m),
                        "chg": m.get("chg"),
                        "sealAmt": m.get("sealAmt"),
                        "boardType": m.get("boardType") or "",
                        "score": score_of(m),
                    }
                    for m in ordered
                ],
            }
        )

    out.sort(key=lambda s: (-s["heat"], -s["n"], -s["maxBoard"]))
    return out[:limit]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
PART_WEIGHTS = {
    "高度": 35,
    "封单": 18,
    "板型": 14,
    "换手": 8,
    "成功率": 8,
    "板块": 17,
    "身位": 4,
}


def _grade(total: float) -> tuple[str, str]:
    if total >= 80:
        return "龙头 · 主攻", "up"
    if total >= 60:
        return "强势 · 接力", "mild"
    if total >= 40:
        return "跟风 · 观察", "flat"
    return "薄弱 · 回避", "down"


def score_stock(row: dict[str, Any], max_board: int) -> dict[str, Any]:
    """Weighted 0-100 score with a per-component breakdown."""
    parts: list[dict[str, Any]] = []

    # 1. Height: consecutive boards dominate, "N天M板" adds partial credit.
    streak = int(row.get("boards") or 0)
    window = int(row.get("days") or 0)
    height = 0.0
    if streak > 0:
        height = min(PART_WEIGHTS["高度"], 7 * streak + (2 * (window - streak)))
    parts.append({
        "k": "高度", "v": round(height, 1), "max": PART_WEIGHTS["高度"],
        "note": row.get("daysText") or "首板",
    })

    # 2. Seal amount: log-scaled so 亿-level seals saturate.
    seal = float(row.get("sealAmt") or 0)
    seal_pts = 0.0
    if seal > 0:
        seal_pts = min(PART_WEIGHTS["封单"], 3.0 * (seal ** 0.33))
    parts.append({
        "k": "封单", "v": round(seal_pts, 1), "max": PART_WEIGHTS["封单"],
        "note": fmt_amount(seal) if seal else "--",
    })

    # 3. Board type: T-board and fast seals are better quality than repeated opens.
    btype = row.get("boardType") or ""
    opens = int(row.get("openNum") or 0)
    bt = {"一字板": 14, "T字板": 13, "换手板": 11, "烂板": 5}.get(btype, 9)
    bt -= min(6, opens * 1.5)
    parts.append({
        "k": "板型", "v": round(max(0.0, bt), 1), "max": PART_WEIGHTS["板型"],
        "note": btype or "—",
    })

    # 4. Turnover: sweet spot 5-15%.
    turn = float(row.get("turnover") or 0)
    if turn <= 0:
        turn_pts = 0.0
    elif turn < 5:
        turn_pts = 4 + turn * 0.6
    elif turn <= 15:
        turn_pts = 8.0
    elif turn <= 25:
        turn_pts = 8 - (turn - 15) * 0.35
    else:
        turn_pts = max(1.0, 8 - (turn - 15) * 0.2)
    parts.append({
        "k": "换手", "v": round(max(0.0, turn_pts), 1), "max": PART_WEIGHTS["换手"],
        "note": f"{turn:.1f}%",
    })

    # 5. Historical follow-through success rate.
    suc = row.get("sucRate")
    suc_pts = 0.0 if suc is None else 8.0 * float(suc) / 100.0
    parts.append({
        "k": "成功率", "v": round(suc_pts, 1), "max": PART_WEIGHTS["成功率"],
        "note": "--" if suc is None else f"{suc}%",
    })

    # 6. Sector strength: sibling count.
    sec = row.get("_sector") or ""
    secn = int(row.get("_sectorN") or 0)
    sec_pts = 0.0
    if sec and secn >= 2:
        sec_pts = min(PART_WEIGHTS["板块"], 5 + secn * 1.4)
    parts.append({
        "k": "板块", "v": round(sec_pts, 1), "max": PART_WEIGHTS["板块"],
        "note": f"{sec} ×{secn}" if sec else "孤立",
    })

    # 7. Position: is this the highest board in the market?
    pos_pts = 0.0
    if streak > 0 and max_board > 0:
        if streak >= max_board:
            pos_pts = 4.0
        elif streak == max_board - 1:
            pos_pts = 2.0
        else:
            pos_pts = 1.0
    parts.append({
        "k": "身位", "v": round(pos_pts, 1), "max": PART_WEIGHTS["身位"],
        "note": "市场最高板" if pos_pts == 4.0 else ("次高板" if pos_pts == 2.0 else "—"),
    })

    total = round(sum(p["v"] for p in parts))
    grade, cls = _grade(total)
    return {"total": total, "grade": grade, "cls": cls, "parts": parts}


def fmt_amount(n: float | None) -> str:
    if not n:
        return "--"
    if n >= 1e8:
        return f"{n / 1e8:.2f}亿"
    if n >= 1e4:
        return f"{n / 1e4:.0f}万"
    return str(int(n))


# ---------------------------------------------------------------------------
# Aggregate builders
# ---------------------------------------------------------------------------
def build_ladder(up_rows: list[dict[str, Any]], prev_board_map: dict[str, int]) -> list[dict[str, Any]]:
    """Build the consecutive-board ladder, highest first, marking gaps.

    For rung N, `prevCount` is how many stocks were on N-1 boards in the previous
    session: those are the names eligible to promote into rung N today. The
    difference is therefore today's promotional count for that rung, not a
    same-rung day-over-day comparison.
    """
    buckets: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in up_rows:
        b = int(r.get("boards") or 0)
        if b >= 1:
            buckets[b].append(r)
    if not buckets:
        return []
    top = max(buckets)
    ladder = []
    for b in range(top, 1, -1):
        lst = buckets.get(b, [])
        prev_count = sum(1 for c, pb in prev_board_map.items() if pb == b - 1)
        ladder.append({
            "board": b,
            "prev": b - 1,
            "todayCount": len(lst),
            "prevCount": prev_count,
            "promoted": len(lst),
            "delta": len(lst) - prev_count,
            "gap": len(lst) == 0,
            "list": [
                {"code": s["code"], "name": s["name"], "chg": s["chg"]}
                for s in sorted(lst, key=lambda x: -x["chg"])
            ],
        })
    return ladder


def build_hot(up_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Heat ranking by traded value, carrying the stock's real concept tags."""
    ranked = sorted(up_rows, key=lambda r: -(r.get("amount") or 0))
    out = []
    for i, r in enumerate(ranked[:40], 1):
        # Heat: traded value scaled to an intuitive integer, plus a turnover weight.
        heat = int((r.get("amount") or 0) / 1000 + (r.get("turnover") or 0) * 1000)
        out.append({
            "code": r["code"],
            "name": r["name"],
            "rank": i,
            "rise": r["chg"],
            "heat": heat,
            "chgRank": 0,
            "title": r.get("reason") or "",
            "concepts": (r.get("concepts") or [])[:6],
            "board": r.get("daysText") or "",
        })
    return out


def stats_block(
    up_rows: list[dict[str, Any]],
    zb_rows: list[dict[str, Any]],
    dt_rows: list[dict[str, Any]],
    total_scanned: int,
    date_str: str,
    prev_date: str,
    prev_max_board: int | None,
) -> dict[str, Any]:
    max_board = max((int(r.get("boards") or 0) for r in up_rows), default=0)
    lianban = sum(1 for r in up_rows if int(r.get("boards") or 0) >= 2)
    attempts = len(up_rows) + len(zb_rows)
    seal_rate = round(len(up_rows) / attempts * 100, 1) if attempts else 0.0
    broken_rate = round(len(zb_rows) / attempts * 100, 1) if attempts else 0.0
    return {
        "date": date_str,
        "prevDate": prev_date,
        "upCount": len(up_rows),
        "downCount": len(dt_rows),
        "zhaCount": len(zb_rows),
        "lianbanCount": lianban,
        "maxBoard": max_board,
        "prevMaxBoard": prev_max_board,
        "yMaxBoard": prev_max_board,
        "sealRate": seal_rate,
        "brokenRate": broken_rate,
        "scanned": total_scanned,
        "sectors": build_sectors(up_rows),
    }


def board_map(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
    return {r["code"]: int(r.get("boards") or 0) for r in rows}


def annotate_sectors(rows: list[dict[str, Any]]) -> None:
    """Attach each row's dominant concept cluster and same-cluster count in place.

    A stock can carry several themes; the strongest cluster it belongs to becomes
    its headline sector, which is what the "板块" score component rewards.
    """
    counts: Counter[str] = Counter()
    for r in rows:
        for t in (r.get("concepts") or [])[:6]:
            counts[t] += 1

    for r in rows:
        best, best_n = "", 0
        for t in (r.get("concepts") or [])[:6]:
            n = counts.get(t, 0)
            if n >= 2 and n > best_n:
                best, best_n = t, n
        if not best and r.get("industry") and counts.get(r["industry"], 0) >= 2:
            best, best_n = r["industry"], counts[r["industry"]]
        r["_sector"] = best
        r["_sectorN"] = best_n
        r["sector"] = best
        r["sectorN"] = best_n
