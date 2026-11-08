import React, { useEffect, useRef, useState } from 'react'
import { login } from '../lib/api'

/**
 * Password gate. One password for the whole app; there are no accounts.
 *
 * The form focuses the input on mount so a phone keyboard opens immediately, and
 * surfaces the server's throttle message verbatim when too many attempts fail.
 */
export function Login({ onSuccess }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !pw) return
    setBusy(true)
    setErr('')
    try {
      await login(pw)
      onSuccess?.()
    } catch (ex) {
      setErr(ex.message || '登录失败')
      setPw('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">复</div>
        <h1>A股涨停复盘</h1>
        <p className="login-sub">请输入访问密码</p>

        <input
          ref={input}
          className="inp login-input"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="密码"
          autoComplete="current-password"
          aria-label="访问密码"
          disabled={busy}
        />

        {err && <div className="login-err" role="alert">{err}</div>}

        <button className="btn primary login-btn" type="submit" disabled={busy || !pw}>
          {busy ? '验证中…' : '进入'}
        </button>

        <p className="login-foot">仅限本人使用</p>
      </form>
    </div>
  )
}
