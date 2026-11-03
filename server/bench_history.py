"""Measure recall of a bounded previous-ladder scan against an exhaustive one.

The full scan is the default in production; this script exists to show what a
latency-capped `probe_budget` costs in recall, so the tradeoff stays measured
rather than assumed.
"""

import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fupan import fetch, history, klcache, store  # noqa: E402

logging.basicConfig(level=logging.WARNING)


def scan(rows, limit=None, workers=16):
    """Find names that sealed on the previous session."""
    bars_cache = {}

    def work(row):
        bars = fetch.fetch_kline(row["code"], history.HISTORY_DAYS)
        if len(bars) < 3:
            return None
        idx = len(bars) - 2
        if not history._is_limit_bar(bars, idx, row["name"], row["code"]):
            return None
        return row["code"]

    if limit:
        ranked = sorted(rows, key=lambda r: -abs(r.get("chg") or 0.0))[:limit]
    else:
        ranked = rows

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return {c for c in pool.map(work, ranked) if c}


def main():
    store.init_db()
    raw = fetch.fetch_snapshot()
    rows = [fetch.normalize(r) for r in raw]
    rows = [r for r in rows if r.get("price") and r.get("pre_close")]
    print(f"universe: {len(rows)}")

    t = time.time()
    full = scan(rows, limit=None)
    t_full = time.time() - t
    print(f"EXHAUSTIVE: {len(full)} limit-ups in {t_full:.0f}s")

    klcache.clear_memory()
    for budget in (900, 1500, 2200):
        t = time.time()
        part = scan(rows, limit=budget)
        dt = time.time() - t
        missing = full - part
        recall = len(part) / len(full) * 100 if full else 100
        print(
            f"BOUNDED {budget:>5}: {len(part):>3} found in {dt:>5.0f}s  "
            f"recall {recall:5.1f}%  missing {len(missing)}"
        )

    with open(Path(__file__).parent.parent / "data" / "prev_all.json", "w", encoding="utf-8") as f:
        json.dump(sorted(full), f)


if __name__ == "__main__":
    main()
