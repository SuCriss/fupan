import React from 'react'
import { fmtAmt, pct, cls, badgeCls } from '../lib/format'

/** Headline market breadth counters for the selected trading day. */
export function Kpis({ stats }) {
  if (!stats || (!stats.upCount && !stats.date)) return null
  const items = [
    { k: '涨停家数', v: stats.upCount ?? 0, c: 'u', s: stats.date || '' },
    { k: '跌停家数', v: stats.downCount ?? 0, c: 'd', s: '含ST' },
    { k: '封板率', v: `${stats.sealRate ?? 0}%`, c: stats.sealRate >= 70 ? 'u' : 'g', s: `炸板 ${stats.zhaCount ?? 0} 家` },
    { k: '最高板', v: stats.maxBoard ?? 0, c: 'g', s: '市场高度' },
    { k: '连板家数', v: stats.lianbanCount ?? 0, c: 'u', s: '2板及以上' },
    { k: '炸板率', v: `${stats.brokenRate ?? 0}%`, c: stats.brokenRate >= 35 ? 'd' : 'g', s: '情绪温度' },
    { k: '赚钱效应', v: (stats.upCount ?? 0) > (stats.downCount ?? 0) * 3 ? '强' : (stats.upCount ?? 0) > (stats.downCount ?? 0) ? '中性' : '弱', c: (stats.upCount ?? 0) > (stats.downCount ?? 0) ? 'u' : 'd', s: `${stats.upCount ?? 0} : ${stats.downCount ?? 0}` },
    { k: '扫描个股', v: stats.scanned ?? 0, c: 'g', s: '全市场' },
  ]
  return (
    <section className="kpis">
      {items.map((i) => (
        <div key={i.k} className={`kpi ${i.c}`}>
          <div className="k">{i.k}</div>
          <div className={`v ${i.c}`}>{i.v}</div>
          <div className="s">{i.s}</div>
        </div>
      ))}
    </section>
  )
}

/** Four benchmark index quotes, polled independently of the archive day. */
export function IndexBar({ market }) {
  if (!market?.indices?.length) return null
  return (
    <section className="idxbar">
      {market.indices.map((x) => (
        <div className="idx" key={x.code}>
          <div className="n"><span>{x.name}</span><b>{x.code}</b></div>
          <div className={`p ${cls(x.chg)}`}>{x.price.toFixed(2)}</div>
          <div className={`c ${cls(x.chg)}`}>
            {pct(x.chg)}
            <span style={{ marginLeft: 6 }}>{x.diff > 0 ? '+' : ''}{x.diff.toFixed(2)}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

/** Top-ranked limit-up names, one card each. */
export function LeaderCards({ list, onOpen }) {
  if (!list?.length) return <div className="empty">当前无涨停数据</div>
  return (
    <div className="cards">
      {list.map((s, i) => {
        const sc = s.score || { total: 0, grade: '--', cls: 'flat', parts: [] }
        return (
          <div className="card" key={s.code} onClick={() => onOpen(s.code)}>
            <div className="rk">#{i + 1}</div>
            <div className="nm"><h3>{s.name}</h3><span>{s.code}</span></div>
            <div className="px">
              <b className={cls(s.chg)}>{Number(s.latest || 0).toFixed(2)}</b>
              <em className={cls(s.chg)}>{pct(s.chg)}</em>
            </div>
            <div className="meta">
              <span>{s.daysText}</span>
              {s.boardType && <span>{s.boardType}</span>}
              {s.sealAmt > 0 && <span>封单 {fmtAmt(s.sealAmt)}</span>}
              <span>换手 {Number(s.turnover || 0).toFixed(1)}%</span>
              {s.sector && <span className="g">{s.sector}×{s.sectorN}</span>}
            </div>
            {s.concepts?.length > 0 ? (
              <div className="card-concepts">
                {s.concepts.slice(0, 4).map((c, ci) => <i key={ci}>{c}</i>)}
              </div>
            ) : (
              s.reason && <div className="reason">{s.reason}</div>
            )}
            <div className="foot">
              <span className={`tag-badge ${badgeCls(sc.cls)}`}>{sc.grade}</span>
              <div className="bar"><i style={{ width: `${sc.total}%` }} /></div>
              <div className="sc">{sc.total}<small>/100</small></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
