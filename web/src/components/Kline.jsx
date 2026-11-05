import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const UP = '#ff4d5e'
const DN = '#2ec27e'
const FLAT = '#8494a8'

const MA_CONF = [
  ['ma5', '#f5b942', 'MA5'],
  ['ma10', '#4b8bff', 'MA10'],
  ['ma20', '#b46bff', 'MA20'],
  ['ma60', '#7d8ea3', 'MA60'],
]

const PAD = { l: 6, r: 66, t: 8, b: 16 }
const H1 = 232   // price pane
const H2 = 66    // volume pane
const H3 = 88    // MACD pane
const GAP = 14

/** Visible-bar bounds for the zoom interaction. */
const MIN_BARS = 20
const MAX_BARS = 600
const DEFAULT_BARS = 120

const fixed = (v, d = 2) => (v == null || !isFinite(v) ? '--' : Number(v).toFixed(d))

const volFmt = (v) => {
  if (v == null || !isFinite(v)) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿手'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万手'
  return Math.round(v) + '手'
}

function linePath(rows, field, x, y) {
  let out = ''
  let open = false
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][field]
    if (v == null || !isFinite(v)) {
      open = false
      continue
    }
    out += (open ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '
    open = true
  }
  return out.trim()
}

/**
 * Three panes on one x-axis: candlesticks with moving averages, volume, and
 * MACD. Supports wheel zoom, drag-to-pan and a hover crosshair.
 */
export function KlineChart({ bars = [], analysis = null, period = 'day', width = 1040 }) {
  const [hover, setHover] = useState(null)
  // `view` is [startIndex, endIndex) into bars; null means "latest window".
  const [view, setView] = useState(null)
  const [dragging, setDragging] = useState(null)
  const svgRef = useRef(null)

  const total = bars.length

  // Reset the window whenever the series identity changes (period switch / stock).
  useEffect(() => {
    setView(null)
    setHover(null)
  }, [period, total])

  const win = useMemo(() => {
    if (total <= 0) return [0, 0]
    if (!view) {
      const size = Math.min(total, DEFAULT_BARS)
      return [total - size, total]
    }
    let [a, b] = view
    a = Math.max(0, Math.min(a, total - MIN_BARS))
    b = Math.min(total, Math.max(b, a + MIN_BARS))
    return [a, b]
  }, [view, total])

  // Any window change invalidates the hovered index; clear it before it can be
  // used against a shorter `rows`.
  useEffect(() => {
    setHover(null)
  }, [win])

  const rows = useMemo(() => bars.slice(win[0], win[1]), [bars, win])

  const geo = useMemo(() => {
    const n = rows.length
    if (n < 2) return null

    const W = Math.max(660, Math.round(width))
    const plotW = W - PAD.l - PAD.r
    const yTop = PAD.t
    const yBot = yTop + H1
    const vTop = yBot + GAP
    const vBot = vTop + H2
    const mTop = vBot + GAP
    const mBot = mTop + H3
    const H = mBot + PAD.b

    const bw = plotW / n
    const bwd = Math.max(1.2, Math.min(14, bw * 0.66))
    const cx = (i) => PAD.l + (i + 0.5) * bw

    // Scale to the visible window, including the moving averages drawn in it.
    let lo = Infinity
    let hi = -Infinity
    for (const b of rows) {
      if (b.l < lo) lo = b.l
      if (b.h > hi) hi = b.h
      for (const [k] of MA_CONF) {
        const mv = b[k]
        if (mv != null && isFinite(mv)) {
          if (mv < lo) lo = mv
          if (mv > hi) hi = mv
        }
      }
    }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
      lo -= 1
      hi += 1
    }
    const padP = (hi - lo) * 0.05
    lo -= padP
    hi += padP
    const yP = (v) => yBot - ((v - lo) / (hi - lo)) * H1

    let vmax = 0
    for (const b of rows) if (b.v > vmax) vmax = b.v
    vmax = vmax || 1
    const yV = (v) => vBot - (v / vmax) * H2

    let mlo = 0
    let mhi = 0
    for (const b of rows) {
      for (const key of ['dif', 'dea', 'macd']) {
        const x = b[key]
        if (x == null || !isFinite(x)) continue
        if (x < mlo) mlo = x
        if (x > mhi) mhi = x
      }
    }
    if (mhi <= mlo) {
      mhi = 1
      mlo = -1
    }
    const padM = (mhi - mlo) * 0.08
    mlo -= padM
    mhi += padM
    const yM = (v) => mBot - ((v - mlo) / (mhi - mlo)) * H3
    const zeroY = yM(0)

    return { W, H, plotW, yTop, yBot, vTop, vBot, mTop, mBot, bw, bwd, cx, lo, hi, yP, yV, yM, vmax, zeroY, mhi }
  }, [rows, width])

  /** Zoom around the pointer's bar, keeping it under the cursor. */
  const onWheel = useCallback(
    (e) => {
      if (!geo || total < MIN_BARS) return
      e.preventDefault()
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const [a, b] = win
      const size = b - a
      const anchor = a + ratio * size
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18
      const nextSize = Math.round(Math.min(total, Math.max(MIN_BARS, size * factor)))
      let nextA = Math.round(anchor - ratio * nextSize)
      nextA = Math.max(0, Math.min(nextA, total - nextSize))
      setView(nextSize >= total ? null : [nextA, nextA + nextSize])
      setHover(null)
    },
    [geo, total, win]
  )

  // Wheel events must be non-passive to allow preventDefault; React's onWheel is
  // passive in some browsers, so bind natively.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  /** Drag horizontally to pan through history. */
  const onPointerDown = (e) => {
    if (!geo) return
    setDragging({ x: e.clientX, win: [...win] })
  }
  const onPointerMove = (e) => {
    if (!dragging || !geo) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const barsPerPx = (dragging.win[1] - dragging.win[0]) / rect.width
    const shift = Math.round((dragging.x - e.clientX) * barsPerPx)
    const size = dragging.win[1] - dragging.win[0]
    let a = dragging.win[0] + shift
    a = Math.max(0, Math.min(a, total - size))
    setView([a, a + size])
  }
  const onPointerUp = () => setDragging(null)

  const zoomBy = (factor) => {
    const [a, b] = win
    const size = b - a
    const nextSize = Math.round(Math.min(total, Math.max(MIN_BARS, size * factor)))
    const centre = (a + b) / 2
    let nextA = Math.round(Math.max(0, Math.min(centre - nextSize / 2, total - nextSize)))
    setView(nextSize >= total ? null : [nextA, nextA + nextSize])
    setHover(null)
  }

  const resetZoom = () => {
    const size = Math.min(total, DEFAULT_BARS)
    setView(size >= total ? null : [total - size, total])
    setHover(null)
  }

  if (total < 2) return <div className="kl-empty">K 线数据不足</div>
  if (!geo) return <div className="kl-empty">K 线数据不足</div>

  const { W, H, plotW, yTop, yBot, vTop, vBot, mTop, mBot, bwd, cx, lo, hi, yP, yV, yM, vmax, zeroY, mhi } = geo
  const n = rows.length

  const priceLabels = []
  for (let i = 0; i <= 4; i++) {
    const gv = lo + ((hi - lo) * i) / 4
    priceLabels.push({ y: yP(gv), v: gv })
  }

  // `hover` can outlive the window it was set in: zooming shrinks `rows`, so the
  // index must be re-validated on every render or `rows[hover].c` throws and the
  // whole page unmounts.
  const hoverBar = hover != null && hover >= 0 && hover < n ? rows[hover] : null
  const hoverPrev = hoverBar
    ? (hover > 0 ? rows[hover - 1]?.c ?? hoverBar.o : hoverBar.o)
    : null
  const hoverChg = hoverBar && hoverPrev ? ((hoverBar.c - hoverPrev) / hoverPrev) * 100 : 0

  const isZoomed = win[1] - win[0] < total || win[0] > 0

  return (
    <div className="kl-wrap-inner">
      <div className="kl-zoom">
        <button onClick={() => zoomBy(1 / 1.3)} title="放大">＋</button>
        <button onClick={() => zoomBy(1.3)} title="缩小">－</button>
        <button onClick={resetZoom} title="重置视图">重置</button>
        <span className="kl-zoom-txt">
          {win[0] + 1}–{win[1]} / {total}
          {isZoomed ? '' : ' （最近' + (win[1] - win[0]) + '根）'}
        </span>
        <span className="kl-zoom-hint">滚轮缩放 · 拖动平移</span>
      </div>

      <div className="kl-chart">
        <svg
          ref={svgRef}
          className="kl-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
          onMouseLeave={() => setHover(null)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <rect x={PAD.l} y={yTop} width={plotW} height={H1} fill="#0c121c" />
          <rect x={PAD.l} y={vTop} width={plotW} height={H2} fill="#0c121c" />
          <rect x={PAD.l} y={mTop} width={plotW} height={H3} fill="#0c121c" />

          {priceLabels.map((p, i) => (
            <g key={i}>
              <line x1={PAD.l} y1={p.y} x2={PAD.l + plotW} y2={p.y} stroke="rgba(255,255,255,.06)" />
              <text x={PAD.l + plotW + 6} y={p.y + 3} fill="#5d6b80" fontSize="9.5">
                {p.v.toFixed(2)}
              </text>
            </g>
          ))}

          {[0, 1, 2].map((i) => {
            const gy = vBot - (H2 * i) / 2
            return <line key={i} x1={PAD.l} y1={gy} x2={PAD.l + plotW} y2={gy} stroke="rgba(255,255,255,.05)" />
          })}
          <text x={PAD.l + plotW + 6} y={vTop + 10} fill="#5d6b80" fontSize="9.5">{volFmt(vmax)}</text>

          <line x1={PAD.l} y1={zeroY} x2={PAD.l + plotW} y2={zeroY} stroke="rgba(255,255,255,.16)" strokeDasharray="3 3" />
          <text x={PAD.l + plotW + 6} y={zeroY + 3} fill="#5d6b80" fontSize="9.5">0.00</text>
          <text x={PAD.l + plotW + 6} y={mTop + 9} fill="#5d6b80" fontSize="9">{fixed(mhi, 3)}</text>

          {rows.map((b, i) => {
            const hV = Math.max(0.6, (b.v / vmax) * H2)
            return (
              <rect key={'v' + i} x={cx(i) - bwd / 2} y={vBot - hV} width={bwd} height={hV}
                fill={b.c >= b.o ? UP : DN} opacity=".72" />
            )
          })}

          {rows.map((b, i) => {
            if (b.macd == null || !isFinite(b.macd)) return null
            const my = yM(b.macd)
            const top = Math.min(my, zeroY)
            const hh = Math.max(0.7, Math.abs(my - zeroY))
            return (
              <rect key={'m' + i} x={cx(i) - bwd / 2} y={top} width={bwd} height={hh}
                fill={b.macd >= 0 ? UP : DN} opacity=".85" />
            )
          })}

          {rows.map((b, i) => {
            const rising = b.c >= b.o
            const col = rising ? UP : DN
            const yo = yP(b.o)
            const yc = yP(b.c)
            const top = Math.min(yo, yc)
            const hgt = Math.max(1.2, Math.abs(yo - yc))
            return (
              <g key={'k' + i}>
                <line x1={cx(i)} y1={yP(b.h)} x2={cx(i)} y2={yP(b.l)} stroke={col} strokeWidth="1" opacity=".85" />
                {rising ? (
                  <rect x={cx(i) - bwd / 2} y={top} width={bwd} height={hgt} fill="none" stroke={col} strokeWidth="1.2" />
                ) : (
                  <rect x={cx(i) - bwd / 2} y={top} width={bwd} height={hgt} fill={col} opacity=".9" />
                )}
              </g>
            )
          })}

          {MA_CONF.map(([field, color]) => (
            <path key={field} d={linePath(rows, field, cx, yP)} fill="none" stroke={color} strokeWidth="1.1" opacity=".9" />
          ))}
          <path d={linePath(rows, 'dif', cx, yM)} fill="none" stroke="#f5b942" strokeWidth="1" />
          <path d={linePath(rows, 'dea', cx, yM)} fill="none" stroke="#4b8bff" strokeWidth="1" />

          {hoverBar && (
            <g>
              <line x1={cx(hover)} y1={yTop} x2={cx(hover)} y2={mBot} stroke="#7d8ea3" strokeWidth="1" strokeDasharray="3 2" />
              <line x1={PAD.l} y1={yP(hoverBar.c)} x2={PAD.l + plotW} y2={yP(hoverBar.c)}
                stroke="#7d8ea3" strokeWidth="1" strokeDasharray="3 2" />
            </g>
          )}

          {rows.map((b, i) => (
            <rect key={'h' + i} x={cx(i) - geo.bw / 2} y={yTop} width={geo.bw} height={mBot - yTop}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>

        {hoverBar && (
          <div className="kl-tip" style={{ left: `${(cx(hover) / W) * 100}%` }}>
            <div className="kl-tip-h">
              {hoverBar.d}
              <i style={{ color: hoverBar.c >= hoverBar.o ? UP : DN }}>
                {hoverChg > 0 ? '+' : ''}{hoverChg.toFixed(2)}%
              </i>
            </div>
            <div className="kl-tip-g">
              <div><span>开</span><b>{fixed(hoverBar.o)}</b></div>
              <div><span>高</span><b>{fixed(hoverBar.h)}</b></div>
              <div><span>收</span><b style={{ color: hoverBar.c >= hoverBar.o ? UP : DN }}>{fixed(hoverBar.c)}</b></div>
              <div><span>低</span><b>{fixed(hoverBar.l)}</b></div>
              <div><span>量</span><b>{volFmt(hoverBar.v)}</b></div>
              <div><span>振幅</span><b>{fixed(((hoverBar.h - hoverBar.l) / (hoverPrev || 1)) * 100)}%</b></div>
            </div>
            <div className="kl-tip-g">
              <div><span>MA5</span><b>{fixed(hoverBar.ma5)}</b></div>
              <div><span>MA10</span><b>{fixed(hoverBar.ma10)}</b></div>
              <div><span>MA20</span><b>{fixed(hoverBar.ma20)}</b></div>
              <div><span>MA60</span><b>{fixed(hoverBar.ma60)}</b></div>
              <div><span>DIF</span><b>{fixed(hoverBar.dif, 3)}</b></div>
              <div><span>DEA</span><b>{fixed(hoverBar.dea, 3)}</b></div>
            </div>
          </div>
        )}
      </div>

      <div className="kl-an">
        {analysis ? <AnalysisBlock a={analysis} count={total} period={period} /> : null}
      </div>
    </div>
  )
}

function AnalysisBlock({ a, count, period }) {
  const toneStyle =
    a.tone === 'up'
      ? { background: '#e0343f', color: '#fff', boxShadow: '0 2px 10px rgba(224,52,63,.35)' }
      : a.tone === 'down'
        ? { background: '#12a15a', color: '#fff', boxShadow: '0 2px 10px rgba(18,161,90,.32)' }
        : { background: '#000', color: '#e8eef7', boxShadow: 'inset 0 0 0 1px #46566b' }
  const toneWord = a.tone === 'up' ? '偏多' : a.tone === 'down' ? '偏空' : '中性'
  const toneColor = a.tone === 'up' ? UP : a.tone === 'down' ? DN : FLAT
  const pos = Math.max(0, Math.min(100, a.pos ?? 50))

  return (
    <>
      <div className="kl-an-head">
        <span className="kl-tone" style={toneStyle}>{toneWord}</span>
        <b>{a.title}</b>
        <em>多空评分 {a.score > 0 ? '+' : ''}{a.score}</em>
      </div>
      <div className="kl-tags">
        {(a.tags || []).length ? a.tags.map((t, i) => <i key={i}>{t}</i>) : <i>无明显特征</i>}
      </div>
      <div className="kl-notes">
        {(a.notes || []).map((x, i) => (
          <div className="kl-n" key={i}>
            <span className="k">{x.k}</span>
            <span className="v">{x.v}</span>
          </div>
        ))}
      </div>
      <div className="kl-pos">
        <span>区间位置</span>
        <div className="kl-pos-bar"><i style={{ left: `${pos}%`, background: toneColor }} /></div>
        <b>{pos}%</b>
      </div>
      <div className="kl-warn">
        说明：以上判断基于最近 {count} 根{periodLabel(period)}的收盘价、成交量与 MACD 指标自动生成，仅作技术面参考，不构成投资建议。
      </div>
    </>
  )
}

function periodLabel(p) {
  return { day: '日线', week: '周线', month: '月线', quarter: '季线' }[p] || '日线'
}

/** Placeholder used while the drawer's bars are still loading. */
export function KlineSkeleton({ text = '正在拉取 K 线…' }) {
  return <div className="kl-empty">{text}</div>
}
