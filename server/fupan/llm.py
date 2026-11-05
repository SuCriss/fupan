"""Generate a per-stock limit-up attribution summary with an LLM.

The reference tool shows an AI-written "涨停原因" paragraph that cites industry
news and company announcements. That text is not available from any public
endpoint, so it is generated here from the evidence we do have:

* today's quote, board height and seal details
* the stock's concept themes and each theme's disclosure-based membership reason
* the industry classification

Configuration is read from the environment (a `.env` file beside the server is
loaded automatically):

    FUPAN_LLM_BASE_URL   OpenAI-compatible base, e.g. https://api.deepseek.com/v1
    FUPAN_LLM_API_KEY    bearer token
    FUPAN_LLM_MODEL      model name, e.g. deepseek-chat
    FUPAN_LLM_TIMEOUT    seconds, default 45

Without a key the feature degrades to a disabled state and the UI says so
instead of failing.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import config as cfg

log = logging.getLogger("fupan.llm")

# Cached summaries are keyed by (code, trading date) and never regenerated for
# the same day unless forced.
MAX_WORKERS = 4
_queue: ThreadPoolExecutor | None = None
_inflight: set[str] = set()
_lock = threading.Lock()

SYSTEM_PROMPT_LIMITUP = (
    "你是A股涨停归因助手。只输出归因文本本身，不寒暄、不解释任务、不用表格、不用二级标题。\n"
    "严格按以下三行格式输出，每行以标签开头：\n"
    "核心逻辑：<一句话>\n"
    "驱动因素：<两到三个分点用分号隔开，只引用给定事实>\n"
    "风险提示：<一到两个客观风险，不涉及操作>\n"
    "硬性要求：\n"
    "1) 只引用给定结构中的事实，严禁编造新闻、研报、传闻或未给出的数字；\n"
    "2) 依据不足时写'暂无公开依据'，不要推测；\n"
    "3) 全文不超过180字；\n"
    "4) 严禁任何操作建议与预测性表述（追高、持有、兑现、买入、卖出、建议关注、"
    "明日重点、目标价、止盈止损、看涨看跌等），只做客观归因与风险描述。"
)

# Non-limit-up stocks are reachable through search. Asking for a "涨停归因" there
# made the model answer with meta-commentary instead of an attribution, so the
# framing follows the stock's actual state.
SYSTEM_PROMPT_MOVE = (
    "你是A股个股异动归因助手。只输出归因文本本身，不寒暄、不解释任务、不用表格、不用二级标题。\n"
    "重要前提：这只股票今日并未涨停，严禁出现「涨停」「封板」「连板」「晋级」等表述，"
    "也不要讨论涨停幅度或涨停价。\n"
    "严格按以下三行格式输出，每行以标签开头：\n"
    "核心逻辑：<一句话概括今日表现与主因>\n"
    "驱动因素：<两到三个分点用分号隔开，只引用给定事实>\n"
    "风险提示：<一到两个客观风险，不涉及操作>\n"
    "硬性要求：\n"
    "1) 只引用给定结构中的事实，严禁编造新闻、研报、传闻或未给出的数字；\n"
    "2) 依据不足时写'暂无公开依据'，不要推测；\n"
    "3) 全文不超过180字；\n"
    "4) 严禁任何操作建议与预测性表述（追高、持有、兑现、买入、卖出、建议关注、"
    "明日重点、目标价、止盈止损、看涨看跌等），只做客观归因与风险描述。"
)

# Kept for callers that still import the old name.
SYSTEM_PROMPT = SYSTEM_PROMPT_LIMITUP


def is_limit_up(payload: dict[str, Any]) -> bool:
    """Whether this stock is sealed at its daily limit right now.

    Derived from the quote against the board's own limit, so ST (5%) and the
    20%/30% boards are handled without a separate lookup.
    """
    quote = payload.get("quote") or {}
    try:
        chg = float(quote.get("chg") or 0)
        limit = float(payload.get("limitPct") or 10)
    except (TypeError, ValueError):
        return False
    return chg >= limit - cfg.SEALED_TOLERANCE


def cache_key(trade_date: str, limit_up: bool) -> str:
    """Summaries are cached per day *and* per framing.

    A stock can move from "not limit-up" to "limit-up" intraday; keying by mode
    keeps a morning 异动归因 from being shown as the closing 涨停归因.
    """
    return f"{trade_date}#{'lu' if limit_up else 'mv'}"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(cfg.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS attributions (
                   code TEXT NOT NULL,
                   trade_date TEXT NOT NULL,
                   summary TEXT NOT NULL,
                   model TEXT,
                   created_at INTEGER NOT NULL,
                   PRIMARY KEY (code, trade_date)
               )"""
        )


def configured() -> bool:
    return bool(os.environ.get("FUPAN_LLM_API_KEY") and os.environ.get("FUPAN_LLM_BASE_URL"))


def status() -> dict[str, Any]:
    base = os.environ.get("FUPAN_LLM_BASE_URL", "")
    model = os.environ.get("FUPAN_LLM_MODEL", "")
    return {
        "enabled": configured(),
        "model": model or None,
        # Host only: the key and full path are never returned to the client.
        "endpoint": (base.split("//")[-1].split("/")[0] if base else None),
    }


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
def get_cached(code: str, trade_date: str) -> str | None:
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT summary FROM attributions WHERE code=? AND trade_date=?",
                (code, trade_date),
            ).fetchone()
        return row["summary"] if row else None
    except Exception:
        return None


def get_cached_for(code: str, trade_date: str) -> str | None:
    """Look up a summary for this day regardless of which framing produced it.

    The HTTP layer does not know the stock's limit-up state without paying for a
    quote, so it asks for either mode and takes whichever exists.
    """
    for limit_up in (True, False):
        hit = get_cached(code, cache_key(trade_date, limit_up))
        if hit:
            return hit
    return None


def _save(code: str, trade_date: str, summary: str, model: str) -> None:
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO attributions(code, trade_date, summary, model, created_at)"
                " VALUES (?,?,?,?,?)",
                (code, trade_date, summary, model, int(time.time())),
            )
    except Exception as exc:
        log.debug("attribution cache write failed: %s", exc)


# ---------------------------------------------------------------------------
# Prompt + call
# ---------------------------------------------------------------------------
def _build_facts(payload: dict[str, Any]) -> str:
    snap = payload.get("snapshot") or {}
    quote = payload.get("quote") or {}
    limit_up = is_limit_up(payload)
    lines = [
        f"股票：{payload.get('name')}({payload.get('code')})",
        f"今日涨幅：{quote.get('chg')}%  现价：{quote.get('price')}",
        f"市场：{payload.get('board')}  涨跌停幅度：±{payload.get('limitPct')}%",
        # State the fact explicitly so the model cannot invent (or deny) it.
        "今日状态：" + ("涨停（已封板）" if limit_up else "未涨停"),
    ]
    if snap:
        lines += [
            f"连板情况：{snap.get('daysText')}  板型：{snap.get('boardType')}",
            f"换手率：{round(float(snap.get('turnover') or 0), 1)}%  封单额(估算)：{snap.get('sealAmt')}",
            f"流通市值：{snap.get('floatCap')}",
        ]
    concepts = payload.get("concepts") or []
    if concepts:
        lines.append("所属概念题材：" + "、".join(concepts))
    industries = payload.get("industries") or []
    if industries:
        lines.append("所属行业：" + "、".join(industries[:4]))

    reasons = payload.get("conceptReasons") or {}
    if reasons:
        lines.append("概念入选依据（来自公司公告/定期报告）：")
        for theme, why in list(reasons.items())[:6]:
            text = (why or "").strip()
            if text:
                lines.append(f"- {theme}：{text[:180]}")
    return "\n".join(lines)


def _structure(raw: str) -> str:
    """Normalise the reply into the three labelled lines the UI renders.

    The model is asked for 核心逻辑 / 驱动因素 / 风险提示. When it answers as prose
    instead, split on sentence boundaries so the card still reads consistently.
    """
    import re

    text = raw.strip()
    labelled = re.findall(r"(核心逻辑|驱动因素|风险提示)\s*[:：]\s*(.*)", text)
    if len(labelled) >= 2:
        found = {k: v.strip() for k, v in labelled if v.strip()}
        lines = []
        for key in ("核心逻辑", "驱动因素", "风险提示"):
            if key in found:
                lines.append(f"{key}：{found[key]}")
        # Preserve any trailing unlabelled content that framed a real point.
        return "\n".join(lines)

    sentences = [s for s in re.split(r"(?<=[。；])", text) if s.strip()]
    if not sentences:
        return text
    core = sentences[0].strip()
    rest = "".join(sentences[1:]).strip()
    lines = [f"核心逻辑：{core}"]
    if rest:
        lines.append(f"驱动因素：{rest}")
    return "\n".join(lines)


def _sanitize(text: str) -> str:
    """Normalise the model's output and drop anything the prompt disallowed.

    The prompt asks for three labelled lines, but a model can still drift into
    tables, bold headings or advisory sections. Filtering here keeps the product
    clean even when the model misbehaves.
    """
    import re

    # Cut advisory sections entirely.
    text = re.split(
        r"\n\s*[#*\s]*(?:操作参考|操作建议|交易建议|买卖建议|投资建议|操作策略|明日重点).*",
        text,
    )[0]

    advice = re.compile(
        r"追高|加仓|减仓|抄底|买入|卖出|建仓|清仓|持有者|建议关注|可考虑|目标价|止盈|止损|介入|看涨|看跌"
    )
    keep: list[str] = []
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        # Drop table rows and separator lines.
        if line.startswith("|") or re.fullmatch(r"[\s|:\-]+", line):
            continue
        if advice.search(line):
            continue
        # Strip markdown emphasis and heading markers.
        line = re.sub(r"^[#>\-\*\s]+", "", line)
        line = line.replace("**", "").replace("`", "")
        if line:
            keep.append(line)

    out = "\n".join(keep).strip()
    # A reply cut off mid-sentence ends without terminal punctuation. Trim back to
    # the last complete clause, but only when that still leaves a substantial
    # text — otherwise keep the fragment rather than dropping most of the answer.
    if out and out[-1] not in "。！？.!?；;）)”\"":
        cut = max(out.rfind("。"), out.rfind("；"), out.rfind("\n"))
        if cut >= len(out) * 0.6:
            out = out[: cut + 1]
    return out


def _call_llm(facts: str, limit_up: bool = True) -> str:
    base = os.environ["FUPAN_LLM_BASE_URL"].rstrip("/")
    key = os.environ["FUPAN_LLM_API_KEY"]
    model = os.environ.get("FUPAN_LLM_MODEL", "gpt-4o-mini")
    timeout = float(os.environ.get("FUPAN_LLM_TIMEOUT", "45"))

    system = SYSTEM_PROMPT_LIMITUP if limit_up else SYSTEM_PROMPT_MOVE
    ask = (
        "请按上述三行格式，为下面这只股票写涨停归因：\n\n"
        if limit_up
        else "请按上述三行格式，为下面这只股票写今日异动归因（它今日并未涨停）：\n\n"
    )

    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": ask + facts},
        ],
        "temperature": 0.3,
        "max_tokens": 1200,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            # Some OpenAI-compatible gateways sit behind Cloudflare, which rejects
            # the default Python-urllib user agent with HTTP 403 (error 1010).
            "User-Agent": cfg.USER_AGENT,
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.loads(r.read().decode("utf-8", "replace"))
    return (payload.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


def generate_sync(payload: dict[str, Any], trade_date: str, force: bool = False) -> str | None:
    """Generate (and cache) one attribution summary."""
    if not configured():
        return None
    code = payload["code"]
    limit_up = is_limit_up(payload)
    key = cache_key(trade_date, limit_up)
    if not force:
        cached = get_cached(code, key)
        if cached:
            return cached

    facts = _build_facts(payload)
    try:
        summary = _call_llm(facts, limit_up)
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:200].decode("utf-8", "replace")
        log.warning("LLM HTTP %s for %s: %s", exc.code, code, detail)
        return None
    except Exception as exc:
        log.warning("LLM call failed for %s: %s", code, exc)
        return None

    if not summary:
        return None
    summary = _sanitize(summary)
    if not summary:
        return None
    summary = _structure(summary)
    _save(code, key, summary, os.environ.get("FUPAN_LLM_MODEL", ""))
    return summary


# ---------------------------------------------------------------------------
# Background generation
# ---------------------------------------------------------------------------
def _worker_init() -> None:
    global _queue
    with _lock:
        if _queue is None:
            _queue = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="fupan-llm")


def submit(code_payload_provider, code: str, trade_date: str) -> bool:
    """Queue a background generation. Returns True when it will run."""
    if not configured():
        return False
    key = f"{code}:{trade_date}"
    with _lock:
        if key in _inflight:
            return False
        if get_cached_for(code, trade_date):
            return False
        _inflight.add(key)
    _worker_init()

    def task() -> None:
        try:
            payload = code_payload_provider(code)
            if payload:
                generate_sync(payload, trade_date)
        except Exception as exc:
            log.debug("background attribution failed for %s: %s", code, exc)
        finally:
            with _lock:
                _inflight.discard(key)

    _queue.submit(task)  # type: ignore[union-attr]
    return True


def pending(code: str, trade_date: str) -> bool:
    with _lock:
        return f"{code}:{trade_date}" in _inflight
