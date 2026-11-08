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
import re
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
    except Exception as exc:
        # A cache miss returns None quietly; a *failed read* means the database
        # is unavailable, which would otherwise look identical to "not generated".
        log.warning("attribution cache read failed for %s@%s: %s: %s",
                    code, trade_date, type(exc).__name__, exc)
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


# The model occasionally renames the three sections or numbers them. Normalising
# keeps the card's three rows consistent even when the label drifts.
_LABELS = {
    "核心逻辑": "核心逻辑",
    "今日表现": "核心逻辑",
    "驱动因素": "驱动因素",
    "异动归因": "驱动因素",
    "归因判断": "驱动因素",
    "风险提示": "风险提示",
    "风险因素": "风险提示",
    "风险点": "风险提示",
    "风险与关注": "风险提示",
    "结论与关注": "风险提示",
    "结论与提示": "风险提示",
    "注意事项": "风险提示",
}
_LABEL_RE = "|".join(sorted(_LABELS, key=len, reverse=True))
# Accept "1." / "2、" / "3)" style numbering in front of a label.
_NUM_PREFIX = r"(?:[0-9]{1,2}\s*[.、)）]\s*)?"


# Model chatter about the prompt itself ("I cannot see the format you mentioned")
# is never product content; drop those sentences before structuring the reply.
_META_RE = re.compile(
    r"本对话|你指的|请把原文|贴一下|我再对齐|我看不到|看不到你|上述三行|上述格式|"
    r"模板输出|以下按|作为(?:AI|人工智能)|我无法|请提供|如果你需要|请明确"
)


def _strip_meta(text: str) -> str:
    """Remove sentences where the model talks about the instruction instead."""
    import re as _re

    kept: list[str] = []
    for line in text.split("\n"):
        # Keep the label but drop a meta clause that follows it.
        label = ""
        body = line
        m = _re.match(rf"^{_NUM_PREFIX}({_LABEL_RE})\s*[:：]\s*(.*)$", line.strip())
        if m:
            label, body = m.group(1), m.group(2)
        if not body.strip():
            continue
        sentences = [s for s in _re.split(r"(?<=[。；;])", body) if s.strip()]
        clean = [s for s in sentences if not _META_RE.search(s)]
        if not clean:
            continue
        rebuilt = "".join(clean).strip()
        kept.append(f"{label}：{rebuilt}" if label else rebuilt)
    return "\n".join(kept)


def _structure(raw: str) -> str:
    """Normalise the reply into the three labelled lines the UI renders.

    The model is asked for 核心逻辑 / 驱动因素 / 风险提示. When it answers as prose
    instead, split on sentence boundaries so the card still reads consistently.
    """
    import re

    text = raw.strip()
    labelled = re.findall(rf"{_NUM_PREFIX}({_LABEL_RE})\s*[:：]\s*(.*)", text)
    if len(labelled) >= 2:
        found: dict[str, str] = {}
        for label, value in labelled:
            key = _LABELS.get(label, label)
            body = value.strip()
            if body and key not in found:
                found[key] = body
        lines = [f"{k}：{found[k]}" for k in ("核心逻辑", "驱动因素", "风险提示") if k in found]
        if lines:
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


def _chat(system: str, user: str, max_tokens: int = 3000, temperature: float = 0.3) -> str:
    """One OpenAI-compatible chat call. Raises on transport/HTTP failure.

    ``max_tokens`` must cover the model's *thinking* as well as its answer: the
    configured model emits a ``reasoning_content`` block first, and a budget sized
    for the answer alone gets consumed by that block, leaving a truncated reply
    with ``finish_reason: "length"``.
    """
    base = os.environ["FUPAN_LLM_BASE_URL"].rstrip("/")
    key = os.environ["FUPAN_LLM_API_KEY"]
    model = os.environ.get("FUPAN_LLM_MODEL", "gpt-4o-mini")
    timeout = float(os.environ.get("FUPAN_LLM_TIMEOUT", "45"))

    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
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

    choice = (payload.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content") or ""
    finish = choice.get("finish_reason")
    if finish == "length":
        usage = payload.get("usage") or {}
        log.warning(
            "LLM output truncated (finish_reason=length, max_tokens=%s, "
            "reasoning_tokens=%s) — raise the budget",
            max_tokens,
            (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
        )
    return content.strip()


def _call_llm(facts: str, limit_up: bool = True) -> str:
    system = SYSTEM_PROMPT_LIMITUP if limit_up else SYSTEM_PROMPT_MOVE
    # The format is repeated inline rather than referenced as "上述": some
    # OpenAI-compatible gateways drop or flatten the system role, and a model that
    # cannot see the system prompt then answers with meta-commentary instead of an
    # attribution.
    if limit_up:
        ask = (
            "请为下面这只今日涨停的股票写涨停归因。\n"
            "只输出下面三行，每行以标签开头，不要任何前言、说明或额外标题：\n"
            "核心逻辑：<一句话>\n"
            "驱动因素：<两到三个分点，用分号隔开，只引用给定事实>\n"
            "风险提示：<一到两个客观风险>\n\n"
            "【股票事实】\n"
        )
    else:
        ask = (
            "请为下面这只今日【未涨停】的股票写今日异动归因。\n"
            "严禁出现「涨停」「封板」「连板」「晋级」等表述，也不要讨论涨停价。\n"
            "只输出下面三行，每行以标签开头，不要任何前言、说明或额外标题：\n"
            "核心逻辑：<一句话概括今日表现与主因>\n"
            "驱动因素：<两到三个分点，用分号隔开，只引用给定事实>\n"
            "风险提示：<一到两个客观风险>\n\n"
            "【股票事实】\n"
        )
    return _chat(system, ask + facts)


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
    summary = _strip_meta(summary)
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


# ---------------------------------------------------------------------------
# Review-note draft
# ---------------------------------------------------------------------------
NOTE_SYSTEM = (
    "你是A股短线复盘助手。根据给定的当日市场数据，写一段复盘笔记草稿。\n"
    "硬性要求：\n"
    "1) 200-350 字，分 3 段，每段一个主题，段与段之间空一行；\n"
    "2) 用交易者写给自己的口吻客观记录，不要标题、不要 markdown 符号、不要项目符号；\n"
    "3) 只引用给定数据，严禁编造新闻、研报、传闻或未给出的数字；\n"
    "4) 数据不足以支撑判断时直接写明「暂无明确主线」，不要推测；\n"
    "5) 严禁任何操作建议与预测性表述（买入、卖出、持有、追高、抄底、止损、止盈、"
    "目标价、建议关注、明日必涨等），只做客观记录与观察项列举。\n"
    "内容顺序：今日情绪与赚钱效应 → 主线与龙头结构 → 明日需要盯的客观观察项。"
)

# Same chatter filter as the attribution path, plus note-specific phrases.
_NOTE_META = re.compile(
    r"本对话|你指的|请把原文|贴一下|我再对齐|我看不到|上述三行|上述格式|"
    r"作为(?:AI|人工智能)|我无法|请提供|如果你需要|以下是|根据您提供的"
)


def _build_note_facts(payload: dict[str, Any]) -> str:
    """Flatten one day's review data into the fact block the model may cite."""
    stats = payload.get("stats") or {}
    sent = payload.get("sentiment") or {}
    lines = [f"交易日：{payload.get('date') or stats.get('date') or '--'}"]

    lines.append(
        f"涨停 {stats.get('upCount', 0)} 家，跌停 {stats.get('downCount', 0)} 家；"
        f"封板率 {stats.get('sealRate', 0)}%，炸板率 {stats.get('brokenRate', 0)}%"
        f"（炸板 {stats.get('zhaCount', 0)} 家）"
    )
    lines.append(
        f"最高板 {stats.get('maxBoard', 0)} 板，连板 {stats.get('lianbanCount', 0)} 家"
    )

    if sent.get("score") is not None:
        parts = "，".join(f"{p['k']} {p['v']}" for p in (sent.get("parts") or []))
        lines.append(f"情绪温度 {sent.get('score')}（{sent.get('label')}）：{parts}")

    dist = payload.get("timedist") or {}
    if dist.get("total"):
        lines.append(
            f"涨停时间分布：竞价 {dist.get('auction', 0)} 家，"
            f"开盘30分 {dist.get('opening', 0)} 家，尾盘30分 {dist.get('closing', 0)} 家"
        )

    leaders = payload.get("leaders") or []
    if leaders:
        items = "，".join(
            f"{x.get('name')}（{x.get('daysText') or '首板'}，评分 {x.get('score') or '--'}）"
            for x in leaders[:5]
        )
        lines.append(f"龙头榜前五：{items}")

    sectors = payload.get("sectors") or []
    if sectors:
        items = "，".join(f"{s.get('name')} {s.get('n')}家" for s in sectors[:6])
        lines.append(f"板块涨停家数：{items}")

    return "\n".join(lines)


def _clean_note(text: str) -> str:
    """Strip markdown noise and any advisory sentence the prompt forbade."""
    out_lines: list[str] = []
    advice = re.compile(
        r"买入|卖出|持有|追高|抄底|加仓|减仓|建仓|清仓|止损|止盈|目标价|建议关注|"
        r"可考虑|介入|看涨|看跌|明日必涨|重点参与"
    )
    for raw in (text or "").split("\n"):
        line = raw.strip()
        if not line:
            if out_lines and out_lines[-1] != "":
                out_lines.append("")
            continue
        # Drop markdown bullets/headings and inline emphasis.
        line = re.sub(r"^[#>*\-•·]+\s*", "", line)
        line = line.replace("**", "").replace("`", "")
        # The model likes to open with a bracketed title even though the note is
        # already shown under its date; that line adds nothing.
        if re.fullmatch(r"【[^】]*】", line):
            continue
        if _NOTE_META.search(line):
            continue
        if advice.search(line):
            continue
        if line:
            out_lines.append(line)
    # Trim trailing blank lines.
    while out_lines and out_lines[-1] == "":
        out_lines.pop()
    return "\n".join(out_lines)


def generate_note(payload: dict[str, Any]) -> str | None:
    """Draft a review note from one day's data. None when the model is unset."""
    if not configured():
        return None
    facts = _build_note_facts(payload)
    try:
        raw = _chat(
            NOTE_SYSTEM,
            "请为下面这个交易日写一段复盘笔记草稿：\n\n" + facts,
            # Generous: the model spends most of the budget on its thinking block
            # before writing the note itself.
            max_tokens=4000,
            temperature=0.5,
        )
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:200].decode("utf-8", "replace")
        log.warning("note draft HTTP %s: %s", exc.code, detail)
        return None
    except Exception as exc:
        log.warning("note draft failed: %s", exc)
        return None

    cleaned = _clean_note(raw)
    # A note shorter than this means the reply was cut off or refused; returning
    # it would silently save a fragment as if it were a finished draft.
    if not cleaned or len(cleaned) < 80:
        log.warning("note draft too short after cleaning (%s chars)", len(cleaned or ""))
        return None
    return cleaned
