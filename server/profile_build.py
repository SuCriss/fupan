"""Profile each stage of a snapshot build to find the real bottleneck."""

import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fupan import analysis, concepts, fetch, history, klcache, store  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")


def main() -> None:
    store.init_db()
    klcache.clear_memory()

    t = time.time()
    raw = fetch.fetch_snapshot()
    print(f"1. full-market snapshot : {time.time()-t:7.1f}s  ({len(raw)} rows)")

    t = time.time()
    rows = [fetch.normalize(r) for r in raw]
    rows = [r for r in rows if not (r["name"].startswith(("N", "C")) and not r["name"].startswith("NST"))]
    pools = {"up": [], "zb": [], "dt": []}
    for r in rows:
        k = analysis.classify(r)
        if k in pools:
            pools[k].append(r)
    print(f"2. classify             : {time.time()-t:7.1f}s  (up {len(pools['up'])} zb {len(pools['zb'])} dt {len(pools['dt'])})")

    up = pools["up"]
    t = time.time()
    concepts.ensure([r["code"] for r in up])
    print(f"3. sector attribution   : {time.time()-t:7.1f}s  ({len(up)} codes)")

    t = time.time()
    kl = fetch.fetch_all_concurrently([r["code"] for r in up], 20)
    print(f"4. kline for up pool    : {time.time()-t:7.1f}s  ({len(kl)} codes)")

    t = time.time()
    h = history.build_previous_ladder(rows)
    print(f"5. previous ladder      : {time.time()-t:7.1f}s  ({h and h['total']} names)")


if __name__ == "__main__":
    main()
