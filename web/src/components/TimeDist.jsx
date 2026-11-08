import React, { useMemo } from 'react'

/**
 * Distribution of first-seal times across the trading session.
 *
 * The snapshot alone cannot answer "when did the money arrive"; the exchange's
 * first-seal timestamp can. A front-loaded profile (many 09:25 bars) means the
 * theme opened with conviction, while a tail-heavy one means late chasing.
 */

// Half-hour buckets. The opening auction is its own bucket because a 09:25 seal
// is a categorically different event from a 09:30 open.
const BUCKETS = [
  { key: 'auction', label: '竞价', short: '9:25', from: 0, to: 93000 },
  { key: 'a1', label: '09:30-10:00', short: '9:30', from: 93000, to: 100000 },
  { key: 'a2', label: '10:00-10:30', short: '10:00', from: 100000, to: 103000 },
  { key: 'a3', label: '10:30-11:00', short: '10:30', from: 103000, to: 110000 },
  { key: 'a4', label: '11:00-11:30', short: '11:00', from: 110000, to: 113001 },
  { key: 'p1', label: '13:00-13:30', short: '13:00', from: 130000, to: 133000 },
  { key: 'p2', label: '13:30-14:00', short: '13:30', from: 133000, to: 140000 },
  { key: 'p3', label: '14:00-14:30', short: '14:00', from: 140000, to: 143000 },
  { key: 'p4', label: '14:30-15:00', short: '14:30', from: 143000, to: 150001 },
]

/** '09:25:00' -> 92500 */
function toNum(t) {
  if (!t || t === '--:--') return -1
  const [h, m, s] = String(t).split(':')
  const hh = Number(h)
  const mm = Number(m)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return -1
  return hh * 10000 + mm * 100 + (Number(s) || 0)
}

export function TimeDist({ rows }) {
  const data = useMemo(() => {
    const counts = new Array(BUCKETS.length).fill(0)
    let unknown = 0
    for (const r of rows || []) {
      const n = toNum(r.firstTime)
      if (n < 0) { unknown += 1; continue }
      const idx = BUCKETS.findIndex((b) => n >= b.from && n < b.to)
      if (idx >= 0) counts[idx] += 1
      else unknown += 1
    }
    return { counts, unknown }
  }, [rows])

  const total = data.counts.reduce((a, b) => a + b, 0)
  if (!total) return null

  const peak = Math.max(...data.counts)
  const auction = data.counts[0]
  const opening = data.counts[1]
  const closing = data.counts[data.counts.length - 1]

  return (
    <section className="timedist">
      <div className="td-head">
        <span className="td-title">涨停时间分布</span>
        <span className="td-sub">
          竞价 <b>{auction}</b> · 开盘30分 <b>{opening}</b> · 尾盘30分 <b>{closing}</b>
          {data.unknown > 0 && <i className="td-unk">（{data.unknown} 只无首封时间）</i>}
        </span>
      </div>
      <div className="td-bars" role="img"
        aria-label={`涨停时间分布：竞价${auction}家，开盘半小时${opening}家，尾盘半小时${closing}家`}>
        {BUCKETS.map((b, i) => {
          const n = data.counts[i]
          const h = peak ? Math.max(n ? 6 : 2, (n / peak) * 100) : 2
          return (
            <div className="td-col" key={b.key} title={`${b.label}  ${n} 家`}>
              <span className="td-n">{n || ''}</span>
              <span className={`td-bar${n ? '' : ' empty'}`} style={{ height: `${h}%` }} />
              <span className="td-x">{b.short}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
