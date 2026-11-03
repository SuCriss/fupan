"""Smoke-test the analysis layer with real but cached market data (no server)."""

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fupan import analysis, store  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def main() -> int:
    store.init_db()
    snap = store.build_snapshot(force=True)
    if snap.get("error"):
        print("BUILD ERROR:", snap["error"])
        return 1

    st = snap["stats"]
    print("\n===== STATS =====")
    for k in ("date", "upCount", "downCount", "zhaCount", "lianbanCount",
              "maxBoard", "sealRate", "brokenRate", "scanned"):
        print(f"  {k:14} {st.get(k)}")
    print("  sectors:", [(s["name"], s["n"]) for s in st.get("sectors", [])[:6]])

    print("\n===== TOP LEADERS =====")
    for i, r in enumerate(snap["leaders"][:8], 1):
        sc = r["score"]
        print(f"  #{i:<2} {r['code']} {r['name']:<8} {r['chg']:>7.2f}%  "
              f"{r.get('daysText',''):<8} {r.get('boardType',''):<6} "
              f"{sc['total']:>3}/100  {sc['grade']}")

    print("\n===== LADDER =====")
    for rung in snap["ladder"]:
        print(f"  {rung['board']}板 today={rung['todayCount']:<3} "
              f"prev={rung['prevCount']:<3} delta={rung['delta']:<3} gap={rung['gap']}")

    print("\n===== POOLS =====")
    for k, v in snap["pools"].items():
        print(f"  {k}: {len(v)}")

    print("\n===== SCORE BREAKDOWN (leader #1) =====")
    if snap["leaders"]:
        for p in snap["leaders"][0]["score"]["parts"]:
            print(f"  {p['k']:<5} {p['v']:>5}/{p['max']:<3}  {p['note']}")

    print("\n===== HOT (top 5) =====")
    for h in snap["hot"][:5]:
        print(f"  {h['rank']}. {h['code']} {h['name']:<8} {h['rise']:>6.2f}% "
              f"heat={h['heat']:<10} {h['board']}")

    out = Path(__file__).resolve().parent.parent / "data" / "snapshot_check.json"
    out.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nsnapshot written to {out}")

    # Sanity assertions
    assert st["upCount"] > 0, "expected at least one limit-up"
    assert snap["leaders"], "expected leaders"
    assert all(0 <= r["score"]["total"] <= 100 for r in snap["pools"]["up"]), "score out of range"
    assert snap["pools"]["up"] == sorted(
        snap["pools"]["up"], key=lambda r: -r["score"]["total"]
    ), "pool must be ordered by score"
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
