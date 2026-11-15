import React, { useState } from 'react'

/**
 * Shown when the initial data load fails.
 *
 * The previous copy told the reader to check "http://127.0.0.1:8000", which on a
 * phone means the phone itself and sent people looking in the wrong place. This
 * version reports the address the request actually went to and can probe the
 * health endpoint on demand, so the failure can be classified without reading
 * server logs: no reply at all means the network/DNS path is broken, a reply with
 * a 5xx means the backend is unhappy.
 */
export function ErrorPanel({ error, onRetry }) {
  const [probe, setProbe] = useState(null) // null | 'running' | {ok, detail}
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const check = async () => {
    setProbe('running')
    const started = Date.now()
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      const ms = Date.now() - started
      let body = ''
      try {
        body = JSON.stringify(await res.json())
      } catch {
        body = '(非 JSON 响应)'
      }
      setProbe({
        ok: res.ok,
        detail: `HTTP ${res.status} · ${ms}ms · ${body.slice(0, 220)}`,
      })
    } catch (e) {
      setProbe({
        ok: false,
        detail: `${e.message}（请求根本没到服务器：域名解析或网络不通）`,
      })
    }
  }

  return (
    <div className="err-panel">
      <div className="err-title">数据加载失败</div>
      <div className="err-msg">{String(error || '未知错误')}</div>

      <div className="err-facts">
        <div className="err-row">
          <span>当前页面</span>
          <code>{origin || '(未知)'}</code>
        </div>
        <div className="err-row">
          <span>请求接口</span>
          <code>{origin}/api/all</code>
        </div>
      </div>

      <div className="err-actions">
        <button className="btn sm" onClick={check} disabled={probe === 'running'}>
          {probe === 'running' ? '检测中…' : '检查连接'}
        </button>
        <button className="btn sm primary" onClick={onRetry}>重试</button>
      </div>

      {probe && probe !== 'running' && (
        <div className={`err-probe ${probe.ok ? 'ok' : 'bad'}`}>
          <b>{probe.ok ? '服务器可达' : '服务器不可达'}</b>
          <div>{probe.detail}</div>
        </div>
      )}

      <div className="err-hint">
        若「检查连接」也没有响应，说明这台设备的网络到本站不通 —— 可换用
        <code> http://192.3.13.21 </code>
        访问同一套服务。
      </div>
    </div>
  )
}
