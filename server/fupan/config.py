"""Project-wide configuration and A-share market rules."""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent
DATA_DIR = Path(os.environ.get("FUPAN_DATA_DIR", ROOT_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "fupan.db"


def _load_dotenv() -> None:
    """Load `.env` from the server directory without overriding real env vars."""
    for path in (BASE_DIR / ".env", ROOT_DIR / ".env"):
        if not path.exists():
            continue
        try:
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        except Exception:
            continue


_load_dotenv()

# --- upstream data sources -------------------------------------------------
# NOTE: Eastmoney push2 endpoints are unreachable from some networks; Sina's
# Market_Center feed gives a full-market snapshot and is the verified source.
SINA_CENTER = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeData"
)
SINA_QUOTE = "https://hq.sinajs.cn/list="
# NOTE: web.ifzq.gtimg.cn answers the fqkline path with an anti-bot JS challenge
# (HTTP 501). The sibling host serves the same payload without it.
TENCENT_KLINE = "https://ifzq.gtimg.cn/appstock/app/fqkline/get"
TENCENT_MINUTE = "https://web.ifzq.gtimg.cn/appstock/app/minute/query"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
HTTP_TIMEOUT = 20.0
FETCH_PAGE_SIZE = 100

# Snapshot is cached this many seconds before a live refetch is attempted.
SNAPSHOT_TTL = int(os.environ.get("FUPAN_SNAPSHOT_TTL", "60"))

# --- market rules ----------------------------------------------------------
# Daily price-limit percentage by board / risk flag.
LIMIT_CHINEXT = 20.0
LIMIT_STAR = 20.0
LIMIT_BSE = 30.0
LIMIT_MAIN = 10.0
LIMIT_ST = 5.0

# A close within this many percentage points of the limit counts as sealed.
SEALED_TOLERANCE = 0.15
# A stock that touched the limit band but closed below it (by up to this much)
# is classified as a broken board (炸板).
BROKEN_WINDOW = 2.0

INDEX_CODES = [
    ("sh000001", "上证指数"),
    ("sz399001", "深证成指"),
    ("sz399006", "创业板指"),
    ("sh000688", "科创50"),
]
