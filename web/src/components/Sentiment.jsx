import React, { useMemo } from 'react'

/**
 * Composite market-sentiment readout: a 0-100 score, the five weighted factors
 * that produced it, and a short trend line of recent sessions.
 */
export function SentimentPanel({ sentiment, series = [], date = '' }) {
  const trend = useMemo(() => {
    if (!series.length) return []
    const idx = date ? series.findIndex((x) => x.date === date) : 0
    const from = idx >= 0 ? idx : 0
    // series is newest-first; take that day and the 19 before it, then flip so
    // the line reads left (older) to right (newer).
    return series.slice(from, from + 20).slice().reverse()
  }, [series, date])

  if (!sentiment || sentiment.score == null) return null
  const { score, label, tone, parts } = sentiment
  const toneCls = tone === 'hot' ? 'u' : tone === 'cold' ? 'd' : 'g'

  return (
    <section className="sentiment">
      <div className="se-gauge">
        <div className={`se-score ${toneCls}`}>{score}</div>
        <div className="se-meta">
          <span className={`se-label ${toneCls}`}>{label}</span>
          <span className="se-sub">情绪温度</span>
        </div>
      </div>

      <div className="se-factors">
        {parts.map((p) => (
          <div className="se-f" key={p.key}>
            <span className="se-fk" title={p.note}>{p.k}</span>
            <span className="se-fb"><i style={{ width: `${p.v}%` }} /></span>
            <span className="se-fv">{p.v}</span>
          </div>
        ))}
      </div>

      <div className="se-trend">
        <Spark series={trend} tone={tone} />
        <span className="se-sub">{trend.length > 1 ? `近 ${trend.length} 日` : '趋势'}</span>
      </div>
    </section>
  )
}

function Spark({ series, tone }) {
  if (series.length < 2) {
    return <div className="se-spark-empty">数据不足</div>
  }
  const W = 240
  const H = 52
  const PAD = 4
  const x = (i) => PAD + (i / (series.length - 1)) * (W - PAD * 2)
  const y = (v) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - PAD * 2)
  const line = series.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`
  const color = tone === 'hot' ? '#f2545b' : tone === 'cold' ? '#3aa76d' : '#f5b942'
  const last = series[series.length - 1]

  return (
    <svg className="se-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`近${series.length}日情绪趋势，最新 ${last.score}`}>
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(series.length - 1)} cy={y(last.score)} r="2.6" fill={color} />
    </svg>
  )
}
