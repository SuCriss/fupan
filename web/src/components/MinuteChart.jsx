import React, { useMemo, useState } from 'react'

const W = 640
const H = 190
const PAD = { l: 6, r: 6, t: 10, b: 18 }

/** Intraday price line against the previous close, with a hover readout. */
export function MinuteChart({ points = [], preClose = 0 }) {
  const [hover, setHover] = useState(null)

  const geo = useMemo(() => {
    const pts = (points || []).filter((p) => p && p.price > 0)
    if (pts.length < 2) return null
    const prices = pts.map((p) => p.price)
    const ref = preClose || prices[0]
    const dev = Math.max(...prices.map((p) => Math.abs(p - ref)), ref * 0.005)
    const lo = ref - dev * 1.05
    const hi = ref + dev * 1.05
    const iw = W - PAD.l - PAD.r
    const ih = H - PAD.t - PAD.b
    const x = (i) => PAD.l + (i / Math.max(1, pts.length - 1)) * iw
    const y = (v) => PAD.t + ((hi - v) / (hi - lo || 1)) * ih
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')
    const area = `${PAD.l},${PAD.t + ih} ${line} ${PAD.l + iw},${PAD.t + ih}`
    return { pts, ref, lo, hi, x, y, line, area, iw, ih }
  }, [points, preClose])

  if (!geo) return <div className="kl-empty">无分时数据</div>

  const last = geo.pts[geo.pts.length - 1].price
  const up = last >= geo.ref
  const color = up ? 'var(--up)' : 'var(--down)'

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="minute-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? '#ff4d5e' : '#22c55e'} stopOpacity="0.22" />
            <stop offset="100%" stopColor={up ? '#ff4d5e' : '#22c55e'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={PAD.l} y={PAD.t} width={geo.iw} height={geo.ih} fill="#0c121c" />
        <polygon points={geo.area} fill="url(#minute-area)" />
        <line
          x1={PAD.l} x2={W - PAD.r}
          y1={geo.y(geo.ref)} y2={geo.y(geo.ref)}
          stroke="#3a4a60" strokeDasharray="3 3"
        />
        <polyline points={geo.line} fill="none" stroke={color} strokeWidth="1.4" />
        {hover != null && (
          <>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.t} y2={PAD.t + geo.ih} stroke="#4a5d78" />
            <circle cx={geo.x(hover)} cy={geo.y(geo.pts[hover].price)} r="3" fill={color} />
          </>
        )}
        {geo.pts.map((p, i) => (
          <rect
            key={i}
            x={geo.x(i) - 2} y={PAD.t} width="5" height={geo.ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        <text x={PAD.l} y={H - 4} fill="#5d6b80" fontSize="9">09:30</text>
        <text x={W / 2 - 14} y={H - 4} fill="#5d6b80" fontSize="9">11:30/13:00</text>
        <text x={W - PAD.r - 32} y={H - 4} fill="#5d6b80" fontSize="9">15:00</text>
      </svg>
      <div style={{ fontSize: 11.5, textAlign: 'center', color: '#9aabc0', minHeight: 16 }}>
        {hover != null
          ? `${geo.pts[hover].time} · ${geo.pts[hover].price.toFixed(2)}`
          : `昨收 ${geo.ref.toFixed(2)} · 最新 ${last.toFixed(2)}`}
      </div>
    </div>
  )
}
