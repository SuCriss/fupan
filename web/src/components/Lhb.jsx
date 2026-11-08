import React, { useEffect, useMemo, useState } from 'react'
import { getLhb } from '../lib/api'
import { fmtAmt, pct, cls } from '../lib/format'

/**
 * Whole-market dragon-tiger list (龙虎榜) for one trading day.
 *
 * Two independent blocks: the billboard itself (ranked by net buy or net sell)
 * and the institutional-seat summary, which tells you whether the money behind a
 * name was institutions or hot money.
 */
export function LhbBoard({ date = '', onOpen }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [side, setSide] = useState('buy') // 'buy' | 'sell'
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    setData(null)
    setErr('')
    getLhb(date)
      .then((r) => { if (alive) setData(r) })
      .catch((e) => { if (alive) setErr(e.message || String(e)) })
    return () => { alive = false }
  }, [date])

  const rows = useMemo(() => {
    const list = data?.list || []
    const term = q.trim()
    const filtered = term
      ? list.filter((r) => r.code.includes(term) || r.name.includes(term))
      : list
    const sorted = [...filtered].sort((a, b) => (side === 'buy' ? b.net - a.net : a.net - b.net))
    return sorted.slice(0, 60)
  }, [data, side, q])

  if (err) return <div className="empty">{err}</div>
  if (!data) return <div className="empty">加载中…</div>
  if (!data.list?.length) return <div className="empty">当日无龙虎榜数据（非交易日或尚未发布）</div>

  const orgMap = new Map((data.orgs || []).map((o) => [o.code, o]))

  return (
    <div className="lhb-page">
      <div className="lhb-bar">
        <div className="lhb-tabs">
          <button className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>净买入榜</button>
          <button className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>净卖出榜</button>
        </div>
        <span className="lhb-meta">
          {data.date} · 共 {data.list.length} 只上榜
          {data.orgs?.length ? ` · 机构席位 ${data.orgs.length} 只` : ''}
        </span>
        <input
          className="inp lhb-q"
          placeholder="筛选代码 / 名称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="筛选龙虎榜"
        />
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="l">代码</th>
              <th scope="col" className="l">名称</th>
              <th scope="col">涨幅</th>
              <th scope="col">买入</th>
              <th scope="col">卖出</th>
              <th scope="col">净额</th>
              <th scope="col">换手</th>
              <th scope="col" className="l">上榜原因</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const org = orgMap.get(r.code)
              return (
                <tr key={`${r.code}-${r.reason}`} onClick={() => onOpen?.(r.code)}>
                  <td className="l"><span className="code">{r.code}</span></td>
                  <td className="l">
                    <b>{r.name}</b>
                    {org && (
                      <span className="org-tag" title={`机构买 ${org.buyTimes} 次 / 卖 ${org.sellTimes} 次`}>
                        机构{org.net >= 0 ? '净买' : '净卖'}
                      </span>
                    )}
                  </td>
                  <td className={cls(r.chg)}>{pct(r.chg)}</td>
                  <td>{fmtAmt(r.buy)}</td>
                  <td>{fmtAmt(r.sell)}</td>
                  <td className={cls(r.net)}>{fmtAmt(r.net)}</td>
                  <td>{Number(r.turnover || 0).toFixed(1)}%</td>
                  <td className="l reason-cell">{r.reason}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.orgs?.length > 0 && (
        <>
          <div className="sec-t">
            机构席位
            <span className="sec-note">净买入前 {Math.min(20, data.orgs.length)} 名</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="l">代码</th>
                  <th scope="col" className="l">名称</th>
                  <th scope="col">涨幅</th>
                  <th scope="col">买/卖次数</th>
                  <th scope="col">买入</th>
                  <th scope="col">卖出</th>
                  <th scope="col">净额</th>
                </tr>
              </thead>
              <tbody>
                {[...data.orgs].slice(0, 20).map((o) => (
                  <tr key={o.code} onClick={() => onOpen?.(o.code)}>
                    <td className="l"><span className="code">{o.code}</span></td>
                    <td className="l"><b>{o.name}</b></td>
                    <td className={cls(o.chg)}>{pct(o.chg)}</td>
                    <td>{o.buyTimes} / {o.sellTimes}</td>
                    <td>{fmtAmt(o.buy)}</td>
                    <td>{fmtAmt(o.sell)}</td>
                    <td className={cls(o.net)}>{fmtAmt(o.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
