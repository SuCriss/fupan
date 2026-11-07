import React, { useCallback, useEffect, useState } from 'react'
import { getWatch, removeWatch } from '../lib/api'
import { fmtAmt, pct, cls } from '../lib/format'

/** User's watchlist with live quotes; rows open the stock drawer. */
export function WatchList({ onOpen }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    getWatch()
      .then((r) => { setRows(r.list || []); setErr('') })
      .catch((e) => setErr(e.message || String(e)))
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (code) => {
    try {
      await removeWatch(code)
      setRows((prev) => (prev || []).filter((x) => x.code !== code))
    } catch (e) {
      setErr(e.message || String(e))
    }
  }

  if (err) return <div className="empty">{err}</div>
  if (!rows) return <div className="empty">加载中…</div>
  if (!rows.length) {
    return (
      <div className="empty">
        自选股为空。
        <br /><br />
        打开任意个股详情，点右上角 ★ 即可加入自选，方便日后盯盘。
      </div>
    )
  }

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th className="l">代码</th><th className="l">名称</th>
            <th>现价</th><th>涨幅</th><th>成交额</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)}>
              <td className="l"><span className="code">{r.code}</span></td>
              <td className="l"><b>{r.name || r.code}</b></td>
              <td>{Number(r.price || 0).toFixed(2)}</td>
              <td className={cls(r.chg)}>{pct(r.chg)}</td>
              <td>{fmtAmt(r.amount)}</td>
              <td>
                <button
                  className="star on"
                  title="移出自选"
                  onClick={(e) => { e.stopPropagation(); remove(r.code) }}
                >
                  ★
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
