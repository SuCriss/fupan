"""Upstream market-data fetching (Sina full-market snapshot + Tencent K-line/minute)."""

from __future__ import annotations

import json
import logging
import re
import ssl
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Iterable

from . import config, klcache

log = logging.getLogger("fupan.fetch")

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


def _request(url: str, referer: str, timeout: float | None = None) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": config.USER_AGENT, "Referer": referer}
    )
    with urllib.request.urlopen(req, timeout=timeout or config.HTTP_TIMEOUT, context=_SSL) as r:
        return r.read()


def _get_text(url: str, referer: str, timeout: float | None = None) -> str:
    return _request(url, referer, timeout=timeout).decode("utf-8", "replace")


def to_symbol(code: str) -> str:
    """Convert a bare 6-digit code to the exchange-prefixed symbol used upstream."""
    code = str(code).strip()
    if code[:2] in ("sh", "sz", "bj"):
        return code
    if code.startswith(("60", "68", "51", "58", "11", "5")):
        return "sh" + code
    if code.startswith(("8", "4", "920")):
        return "bj" + code
    return "sz" + code


# ---------------------------------------------------------------------------
# Full-market snapshot (Sina Market_Center)
# ---------------------------------------------------------------------------
def fetch_snapshot() -> list[dict[str, Any]]:
    """Fetch every A-share row currently listed by Sina, paginated until exhausted.

    Upstream occasionally returns a short page under load. A short page is only
    treated as end-of-data after a retry, otherwise the scan would silently stop
    early and under-report the market.
    """
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    page = 1
    empty_streak = 0
    while page <= 90:
        url = (
            f"{config.SINA_CENTER}?page={page}&num={config.FETCH_PAGE_SIZE}"
            f"&sort=changepercent&asc=0&node=hs_a"
        )
        batch: list[dict[str, Any]] = []
        for attempt in range(3):
            try:
                txt = _get_text(url, "https://vip.stock.finance.sina.com.cn/").strip()
                batch = json.loads(txt) if txt and txt != "null" else []
                if batch:
                    break
            except Exception as exc:
                log.debug("snapshot page %s attempt %s: %s", page, attempt + 1, exc)
            time.sleep(0.5 * (attempt + 1))

        # Blank pages happen intermittently under load; only a run of them means
        # the range is exhausted. Stopping at the first one truncates the scan.
        if not batch:
            empty_streak += 1
            if empty_streak >= 2:
                break
            page += 1
            continue
        empty_streak = 0

        new = 0
        for row in batch:
            code = str(row.get("code", "")).strip()
            if code and code not in seen:
                seen.add(code)
                rows.append(row)
                new += 1
        # A full page of already-seen rows means the listing has wrapped around.
        if new == 0 and len(batch) >= config.FETCH_PAGE_SIZE:
            break
        page += 1
    log.info("snapshot: %s stocks over %s pages", len(rows), page)
    return rows


def normalize(row: dict[str, Any]) -> dict[str, Any]:
    """Flatten one Sina row into the numeric shape used by the analysers."""

    def num(key: str, default: float = 0.0) -> float:
        v = row.get(key)
        if v in (None, "", "null"):
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    nmc = num("nmc")           # circulating market cap, 10k CNY
    mktcap = num("mktcap")     # total market cap, 10k CNY
    return {
        "code": str(row.get("code", "")).strip(),
        "name": str(row.get("name", "")).strip(),
        "symbol": str(row.get("symbol", "")).strip() or to_symbol(row.get("code", "")),
        "price": num("trade"),
        "pre_close": num("settlement"),
        "open": num("open"),
        "high": num("high"),
        "low": num("low"),
        "chg": num("changepercent"),          # percent
        "diff": num("pricechange"),
        "volume": num("volume"),              # shares
        "amount": num("amount"),              # CNY
        "turnover": num("turnoverratio"),     # percent
        "float_cap": nmc * 1e4,               # CNY
        "total_cap": mktcap * 1e4,            # CNY
        "pe": num("per"),
        "pb": num("pb"),
        "ticktime": str(row.get("ticktime", "")),
    }


# ---------------------------------------------------------------------------
# Intraday + history (Tencent)
# ---------------------------------------------------------------------------
def fetch_minute(code: str) -> list[dict[str, Any]]:
    """Intraday minute ticks as [{time, price, avg, volume}]."""
    sym = to_symbol(code)
    url = f"{config.TENCENT_MINUTE}?code={sym}"
    try:
        j = json.loads(_get_text(url, "https://gu.qq.com/"))
        data = ((j.get("data") or {}).get(sym) or {}).get("data") or {}
        out = []
        for line in data.get("data") or []:
            parts = str(line).split()
            if len(parts) < 2:
                continue
            out.append(
                {
                    "time": parts[0],
                    "price": float(parts[1]),
                    "volume": float(parts[2]) if len(parts) > 2 else 0.0,
                    "amount": float(parts[3]) if len(parts) > 3 else 0.0,
                }
            )
        prev = data.get("date") or ""
        return [{"date": prev, **p} for p in out] if prev else out
    except Exception as exc:
        log.debug("minute fetch failed for %s: %s", code, exc)
        return []


def _em_secid(code: str) -> str:
    """Eastmoney secid: 1.<code> for Shanghai, 0.<code> for Shenzhen/Beijing."""
    sym = to_symbol(code)
    return f"{'1' if sym.startswith('sh') else '0'}.{sym[2:]}"


# A single bar request gets a short deadline. The snapshot build fetches bars for
# every limit-up name, so a 20s global timeout on a dead source cost 20s *per
# stock*; 6s is enough for a healthy response and bounds the damage when not.
KLINE_TIMEOUT = 6.0

# Sources that keep failing are skipped for a while. Retrying a 501/refused host
# for every stock is what turned one outage into a multi-minute build.
_SRC_COOLDOWN = 90.0
_SRC_FAIL_LIMIT = 4
_src_lock = threading.Lock()
_src_fails: dict[str, int] = {}
_src_dead_until: dict[str, float] = {}


def _source_available(name: str) -> bool:
    with _src_lock:
        until = _src_dead_until.get(name, 0.0)
        if until and until > time.time():
            return False
        if until:
            _src_dead_until.pop(name, None)
            _src_fails.pop(name, None)
        return True


def _record_source_failure(name: str) -> None:
    with _src_lock:
        n = _src_fails.get(name, 0) + 1
        _src_fails[name] = n
        if n >= _SRC_FAIL_LIMIT:
            _src_dead_until[name] = time.time() + _SRC_COOLDOWN
            _src_fails[name] = 0
            log.warning("kline source %s cooling down for %ss after %s failures",
                        name, int(_SRC_COOLDOWN), _SRC_FAIL_LIMIT)


def _clear_source_failure(name: str) -> None:
    with _src_lock:
        _src_fails.pop(name, None)
        _src_dead_until.pop(name, None)


def _parse_tencent(text: str, sym: str) -> list[dict[str, Any]]:
    j = json.loads(text)
    if j.get("code") != 0:
        return []
    block = (j.get("data") or {}).get(sym) or {}
    return _rows_from(bars=block.get("qfqday") or block.get("day") or [], off=0)


def _parse_eastmoney(text: str) -> list[dict[str, Any]]:
    """Eastmoney kline rows are 'date,open,close,high,low,volume,amount,...'."""
    j = json.loads(text)
    block = (j.get("data") or {})
    out: list[dict[str, Any]] = []
    for line in block.get("klines") or []:
        f = str(line).split(",")
        if len(f) < 6:
            continue
        try:
            out.append({
                "date": f[0],
                "open": float(f[1]),
                "close": float(f[2]),
                "high": float(f[3]),
                "low": float(f[4]),
                "volume": float(f[5]),
            })
        except (TypeError, ValueError):
            continue
    return out


def _parse_sina(text: str) -> list[dict[str, Any]]:
    """Sina rows are day/open/high/low/close/volume objects (unadjusted)."""
    rows = json.loads(text)
    out: list[dict[str, Any]] = []
    for r in rows if isinstance(rows, list) else []:
        try:
            out.append({
                "date": r["day"],
                "open": float(r["open"]),
                "close": float(r["close"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "volume": float(r["volume"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _rows_from(bars: list[Any], off: int = 0) -> list[dict[str, Any]]:
    """Tencent-style positional rows: date,open,close,high,low,volume."""
    out: list[dict[str, Any]] = []
    for b in bars:
        if not isinstance(b, list) or len(b) < 6:
            continue
        try:
            out.append({
                "date": b[0],
                "open": float(b[1]),
                "close": float(b[2]),
                "high": float(b[3]),
                "low": float(b[4]),
                "volume": float(b[5]),
            })
        except (TypeError, ValueError):
            continue
    return out


def _fetch_kline_remote(code: str, days: int) -> list[dict[str, Any]]:
    """Network-only daily-bar fetch with source failover.

    Tencent is tried first because it returns forward-adjusted (qfq) bars, which
    every indicator downstream assumes. It started answering HTTP 501 with an
    anti-bot JS challenge from this host, so Eastmoney (also qfq) is the fallback.
    Sina is last: its endpoint is unadjusted, so a split would distort MA/MACD —
    it is only used when both adjusted sources are down, and that is logged.
    """
    sym = to_symbol(code)
    secid = _em_secid(code)

    # Forward-adjusted sources first: every indicator downstream assumes qfq, so
    # an unadjusted series must never win just because it answered last time.
    adjusted: list[tuple[str, str, str, Any]] = [
        (
            "tencent",
            f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,{days},qfq",
            "https://gu.qq.com/",
            lambda t: _parse_tencent(t, sym),
        ),
        (
            "tencent-alt",
            f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,{days},qfq",
            "https://gu.qq.com/",
            lambda t: _parse_tencent(t, sym),
        ),
        (
            "eastmoney",
            "https://push2his.eastmoney.com/api/qt/stock/kline/get"
            f"?secid={secid}&fields1=f1,f2,f3,f4,f5"
            "&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101"
            f"&lmt={days}",
            "https://quote.eastmoney.com/",
            _parse_eastmoney,
        ),
    ]
    unadjusted: list[tuple[str, str, str, Any]] = [
        (
            "sina",
            "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            f"CN_MarketData.getKLineData?symbol={sym}&scale=240&ma=no&datalen={days}",
            "https://finance.sina.com.cn/",
            _parse_sina,
        ),
    ]

    # Within the adjusted group, prefer whichever source last worked; the
    # unadjusted fallback is always tried last.
    hint = config.kline_host_hint()
    if hint:
        adjusted.sort(key=lambda s: 0 if s[0] == hint else 1)
    sources = adjusted + unadjusted

    for name, url, referer, parse in sources:
        if not _source_available(name):
            continue
        try:
            # A short per-source deadline matters far more here than for a single
            # request: the snapshot build fetches bars for every limit-up name, and
            # the global 20s timeout made one dead source cost 20s per stock.
            out = parse(_get_text(url, referer, timeout=KLINE_TIMEOUT))
        except Exception as exc:
            log.debug("kline source %s failed for %s: %s", name, code, exc)
            _record_source_failure(name)
            continue
        if out:
            _clear_source_failure(name)
            if name == "sina":
                log.warning(
                    "kline for %s served by sina (unadjusted): MA/MACD may be "
                    "distorted around splits", code,
                )
            config.set_kline_host_hint(name)
            return out
    log.warning("kline unavailable for %s from every source", code)
    return []


def fetch_kline(code: str, days: int = 120, use_cache: bool = True) -> list[dict[str, Any]]:
    """Forward-adjusted daily bars, served from the local cache when fresh.

    A cached series shorter than the caller's request (e.g. 120 bars when 600 are
    needed for monthly resampling) triggers a refetch instead of being reused.
    """
    if use_cache:
        try:
            cached = klcache.load(code, min_bars=min(days, 250))
            if cached:
                return cached[-days:] if days and len(cached) > days else cached
        except Exception as exc:  # cache must never break the build
            log.debug("kline cache read failed for %s: %s", code, exc)

    bars = _fetch_kline_remote(code, days)
    if bars and use_cache:
        try:
            klcache.save(code, bars)
        except Exception as exc:
            log.debug("kline cache write failed for %s: %s", code, exc)
    return bars


def fetch_indices() -> list[dict[str, Any]]:
    """Index quotes via Sina's single-line endpoint (GBK response)."""
    syms = [c for c, _ in config.INDEX_CODES]
    raw = _request(config.SINA_QUOTE + ",".join(syms), "https://finance.sina.com.cn/")
    text = raw.decode("gbk", "replace")
    by_sym: dict[str, list[str]] = {}
    for line in text.split("\n"):
        m = re.match(r'var hq_str_(\w+)="(.*)";', line.strip())
        if m:
            by_sym[m.group(1)] = m.group(2).split(",")
    out = []
    for sym, label in config.INDEX_CODES:
        f = by_sym.get(sym)
        if not f or len(f) < 32:
            continue
        try:
            price = float(f[3] or 0)
            pre = float(f[2] or 0)
            out.append(
                {
                    "code": sym[2:],
                    "name": label,
                    "price": price,
                    "pre_close": pre,
                    "open": float(f[1] or 0),
                    "high": float(f[4] or 0),
                    "low": float(f[5] or 0),
                    "diff": round(price - pre, 2),
                    "chg": round((price - pre) / pre * 100, 2) if pre else 0.0,
                    "amount": float(f[9] or 0),
                }
            )
        except (TypeError, ValueError, IndexError):
            continue
    return out


def fetch_quotes(codes: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Batch quote lookup for an explicit code list (100 per request).

    Sina serves these lines as GBK. They are decoded from raw bytes because
    round-tripping through a UTF-8 string corrupts the Chinese names.
    """
    codes = [str(c).strip() for c in codes if str(c).strip()]
    result: dict[str, dict[str, Any]] = {}
    for i in range(0, len(codes), 100):
        chunk = codes[i : i + 100]
        syms = [to_symbol(c) for c in chunk]
        try:
            raw = _request(
                config.SINA_QUOTE + ",".join(syms), "https://finance.sina.com.cn/"
            )
            text = raw.decode("gbk", "replace")
        except Exception as exc:
            log.warning("quote fetch failed: %s", exc)
            continue
        for line in text.split("\n"):
            m = re.match(r'var hq_str_(\w+)="(.*)";', line.strip())
            if not m:
                continue
            sym, payload = m.group(1), m.group(2)
            f = payload.split(",")
            if len(f) < 32:
                continue
            try:
                price = float(f[3] or 0)
                pre = float(f[2] or 0)
            except ValueError:
                continue
            result[sym[2:]] = {
                "code": sym[2:],
                "name": f[0],
                "price": price,
                "pre_close": pre,
                "open": float(f[1] or 0),
                "high": float(f[4] or 0),
                "low": float(f[5] or 0),
                "chg": round((price - pre) / pre * 100, 2) if pre else 0.0,
                "turnover": 0.0,
                "amount": float(f[9] or 0),
            }
    return result


def fetch_all_concurrently(codes: list[str], days: int) -> dict[str, list[dict[str, Any]]]:
    """K-line for several codes with a bounded thread pool."""
    if not codes:
        return {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(lambda c: fetch_kline(c, days), codes))
    return dict(zip(codes, results))


def now_ts() -> int:
    return int(datetime.now().timestamp() * 1000)
