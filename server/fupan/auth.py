"""Single-user password gate.

The whole app — API and SPA — is behind one password. There is no user table: a
session is a signed cookie carrying its own expiry, so the server needs no
storage and a restart does not log anyone out.

Configuration (via .env or the environment):

    FUPAN_PASSWORD         required to turn the gate on; unset means open access
    FUPAN_SESSION_SECRET   optional; derived from the password when absent
    FUPAN_SESSION_DAYS     session lifetime, default 7

Failure throttling is per client IP and in memory: a restart clears it, which is
acceptable for a single-user tool and avoids another table.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from typing import Any

COOKIE_NAME = "fupan_sess"

# A forged cookie cannot extend its own expiry because the HMAC covers it.
_DEFAULT_DAYS = 7

# Login throttling: after MAX_FAILS within WINDOW seconds, the IP is locked.
MAX_FAILS = 5
WINDOW = 300.0
LOCK_SECONDS = 900.0

_lock = threading.Lock()
_fails: dict[str, list[float]] = {}
_locked_until: dict[str, float] = {}


def password() -> str:
    return (os.environ.get("FUPAN_PASSWORD") or "").strip()


def enabled() -> bool:
    """The gate is active only when a password is configured.

    Leaving it unset keeps an existing deployment reachable instead of locking the
    owner out on upgrade; setting it turns the gate on at the next restart.
    """
    return bool(password())


def session_days() -> int:
    try:
        return max(1, int(os.environ.get("FUPAN_SESSION_DAYS", str(_DEFAULT_DAYS))))
    except (TypeError, ValueError):
        return _DEFAULT_DAYS


def _secret() -> bytes:
    explicit = (os.environ.get("FUPAN_SESSION_SECRET") or "").strip()
    if explicit:
        return explicit.encode("utf-8")
    # Derive from the password so an operator only has to set one variable.
    # Changing the password therefore invalidates every existing session, which
    # is the desired behaviour.
    return hashlib.sha256(("fupan-session:" + password()).encode("utf-8")).digest()


def _sign(expiry: int) -> str:
    msg = str(expiry).encode("utf-8")
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()


def issue_token() -> str:
    expiry = int(time.time()) + session_days() * 86400
    return f"{expiry}.{_sign(expiry)}"


def verify_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    raw_exp, _, sig = token.partition(".")
    try:
        expiry = int(raw_exp)
    except ValueError:
        return False
    if expiry < time.time():
        return False
    return hmac.compare_digest(sig, _sign(expiry))


def check_password(candidate: str) -> bool:
    """Constant-time comparison so the response time leaks nothing."""
    expected = password()
    if not expected:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


def random_password(length: int = 16) -> str:
    """Readable-but-strong password for initial setup (no ambiguous characters)."""
    alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------
def client_ip(headers: dict[str, str], fallback: str) -> str:
    """Real client IP behind Cloudflare -> nginx -> uvicorn.

    nginx sets X-Real-IP from CF-Connecting-IP, so trusting it here is safe on
    this host; the fallback keeps local requests working.
    """
    for key in ("x-real-ip", "cf-connecting-ip", "x-forwarded-for"):
        v = headers.get(key)
        if v:
            return v.split(",")[0].strip()
    return fallback or "unknown"


def is_locked(ip: str) -> bool:
    with _lock:
        until = _locked_until.get(ip, 0.0)
        if until and until > time.time():
            return True
        if until:
            _locked_until.pop(ip, None)
            _fails.pop(ip, None)
        return False


def record_failure(ip: str) -> None:
    now = time.time()
    with _lock:
        hits = [t for t in _fails.get(ip, []) if now - t < WINDOW]
        hits.append(now)
        _fails[ip] = hits
        if len(hits) >= MAX_FAILS:
            _locked_until[ip] = now + LOCK_SECONDS
            _fails.pop(ip, None)


def clear_failures(ip: str) -> None:
    with _lock:
        _fails.pop(ip, None)
        _locked_until.pop(ip, None)


def status() -> dict[str, Any]:
    return {
        "enabled": enabled(),
        "sessionDays": session_days(),
    }
