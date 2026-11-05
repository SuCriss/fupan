import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getStock, getWatch, addWatch, removeWatch } from '../lib/api'
import { KlineChart, KlineSkeleton } from './Kline'
import { MinuteChart } from './MinuteChart'
import { fmtAmt, pct, cls, badgeCls } from '../lib/format'

const PERIODS = [
  ['day', '日线'],
  ['week', '周线'],
  ['month', '月线'],
  ['quarter', '季线'],
]

export function DetailDrawer({ code, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('day')
  const [showMinute, setShowMinute] = useState(false)
  const [width, setWidth] = useState(760)
  const [starred, setStarred] = useState(false)
  const [starBusy, setStarBusy] = useState(false)
  const chartRef = useRef(null)
  const pollRef = useRef(null)

  // Reflect the current watchlist membership for this code.
  useEffect(() => {
    let alive = true
    getWatch()
      .then((r) => {
        if (alive) setStarred((r.list || []).some((x) => x.code === code))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [code])

  const toggleStar = async () => {
    if (starBusy) return
    setStarBusy(true)
    try {
      if (starred) {
        await removeWatch(code)
        setStarred(false)
      } else {
        await addWatch(code)
        setStarred(true)
      }
    } catch {
      /* leave the previous state on failure */
    } finally {
      setStarBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    setPeriod('day')
    setShowMinute(false)

    // `refresh` bypasses the server's short-lived detail cache so a polled
    // request can pick up a freshly generated AI summary.
    const load = async (refresh = false) => {
      try {
        const d = await getStock(code, refresh)
        if (!alive) return
        setData(d)
        if (d.ai?.status === 'generating') {
          clearTimeout(pollRef.current)
          pollRef.current = setTimeout(() => load(true), 2500)
        }
      } catch (e) {
        if (alive) setError(e.message || String(e))
      }
    }
    load()
    return () => {
      alive = false
      clearTimeout(pollRef.current)
    }
  }, [code])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Keep the SVG crisp at the drawer's actual width.
  useEffect(() => {
    const el = chartRef.current
    if (!el || !window.ResizeObserver) return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])

  const q = data?.quote
  const snap = data?.snapshot
  const score = snap?.score
  const kl = data?.klines?.[period]

  const keyRows = useMemo(() => {
    if (!snap) return []
    return [
      ['现价', Number(snap.latest || 0).toFixed(2)],
      ['涨幅', <span className={cls(snap.chg)}>{pct(snap.chg)}</span>],
      ['连板', snap.daysText || '--'],
      ['板型', snap.boardType || '--'],
      ['封单额', fmtAmt(snap.sealAmt)],
      ['封单比', snap.sealRatio ? `${snap.sealRatio}%` : '--'],
      ['换手率', `${Number(snap.turnover || 0).toFixed(1)}%`],
      ['流通市值', fmtAmt(snap.floatCap)],
      ['首封时间', snap.firstTime || '--'],
      ['开板次数', snap.openNum ?? 0],
      ['封板成功率', snap.sucRate == null ? '--' : `${snap.sucRate}%`],
      ['板块家数', snap.sector ? `${snap.sector} ×${snap.sectorN}` : '--'],
    ]
  }, [snap])

  return (
    <>
      <div className="mask" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{q ? `${q.name}  ${q.code}` : code}</h2>
            <p>
              {q ? (
                <>
                  <span className={cls(q.chg)}>{pct(q.chg)}</span>
                  {'  ·  '}
                  {data.board} · 涨跌停 ±{data.limitPct}%
                </>
              ) : '加载中…'}
            </p>
          </div>
          <button
            className={`star${starred ? ' on' : ''}`}
            onClick={toggleStar}
            disabled={starBusy}
            title={starred ? '移出自选' : '加入自选'}
            aria-label={starred ? '移出自选' : '加入自选'}
            aria-pressed={starred}
          >
            {starred ? '★' : '☆'}
          </button>
          <button className="close" onClick={onClose} title="关闭">✕</button>
        </div>

        <div className="drawer-body">
          {error && <div className="empty">{error}</div>}

          {q && (
            <>
              {score && (
                <div className="score-banner">
                  <span
                    className={`tag-badge ${badgeCls(score.cls)}`}
                    style={{ fontSize: 12.5, padding: '5px 12px' }}
                  >
                    {score.grade}
                  </span>
                  <div className="bar" style={{ maxWidth: 200 }}>
                    <i style={{ width: `${score.total}%` }} />
                  </div>
                  <span className="sc">{score.total}<small>/100</small></span>
                </div>
              )}

              {data.concepts?.length > 0 && (
                <div className="concept-row">
                  <span className="lbl">概念</span>
                  {data.concepts.map((c, i) => <i key={i}>{c}</i>)}
                </div>
              )}

              <div className="kl-panel" ref={chartRef}>
                <div className="kl-head">
                  <div className="kl-tabs">
                    {PERIODS.map(([k, label]) => (
                      <button
                        key={k}
                        className={!showMinute && period === k ? 'on' : ''}
                        onClick={() => { setShowMinute(false); setPeriod(k) }}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      className={showMinute ? 'on' : ''}
                      onClick={() => setShowMinute(true)}
                    >
                      分时
                    </button>
                  </div>
                  <div className="kl-legend">
                    {!showMinute && (
                      <>
                        <span style={{ color: '#f5b942' }}><i />MA5</span>
                        <span style={{ color: '#4b8bff' }}><i />MA10</span>
                        <span style={{ color: '#b46bff' }}><i />MA20</span>
                        <span style={{ color: '#7d8ea3' }}><i />MA60</span>
                      </>
                    )}
                    <span className="kl-src">{showMinute ? '分时' : `${kl?.total ?? 0} 根`}</span>
                  </div>
                </div>

                {showMinute ? (
                  <MinuteChart points={data.minute} preClose={q.pre_close} />
                ) : kl?.bars?.length ? (
                  <KlineChart
                    bars={kl.bars}
                    analysis={kl.analysis}
                    period={period}
                    width={width}
                  />
                ) : (
                  <KlineSkeleton />
                )}
              </div>

              {score && (
                <>
                  <div className="sec-t">评分拆解</div>
                  {score.parts.map((p) => (
                    <div className="srow" key={p.k}>
                      <span className="n">{p.k}</span>
                      <span className="b"><i style={{ width: `${(p.v / p.max) * 100}%` }} /></span>
                      <span className="v">
                        {p.v}/{p.max}
                        <span style={{ color: '#5d6b80', marginLeft: 5 }}>{p.note}</span>
                      </span>
                    </div>
                  ))}
                </>
              )}

              {keyRows.length > 0 ? (
                <>
                  <div className="sec-t">关键数据</div>
                  <div className="mgrid">
                    {keyRows.map(([k, v]) => (
                      <div key={k}>
                        <div className="k">{k}</div>
                        <div className="v">{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="sec-t">行情</div>
                  <div className="mgrid">
                    {[
                      ['现价', q.price?.toFixed(2)],
                      ['涨幅', <span className={cls(q.chg)}>{pct(q.chg)}</span>],
                      ['昨收', q.pre_close?.toFixed(2)],
                      ['今开', q.open?.toFixed(2)],
                      ['最高', q.high?.toFixed(2)],
                      ['最低', q.low?.toFixed(2)],
                      ['成交额', fmtAmt(q.amount)],
                      ['涨停价', (q.pre_close * (1 + data.limitPct / 100)).toFixed(2)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="k">{k}</div>
                        <div className="v">{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* AI attribution summary */}
              {data.ai?.enabled && (
                <>
                  <div className="sec-t">
                    AI 归因摘要
                    {data.ai.model && <span className="ai-model">{data.ai.model}</span>}
                  </div>
                  <div className="reason-box ai-box">
                    {data.ai.status === 'ready' && data.ai.summary ? (
                      data.ai.summary.split('\n').filter(Boolean).map((line, i) => (
                        <div key={i} className="reason-line">{line}</div>
                      ))
                    ) : data.ai.status === 'generating' ? (
                      <span className="ai-loading">
                        <i className="ai-spin" />正在生成归因摘要…
                      </span>
                    ) : (
                      <span style={{ color: '#5d6b80' }}>
                        暂不可用（未配置模型或生成失败）
                      </span>
                    )}
                    {data.ai.summary && (
                      <div className="kl-warn" style={{ marginTop: 8 }}>
                        说明：以上由大模型基于本站采集的行情与概念依据生成，可能不准确，不构成投资建议。
                      </div>
                    )}
                  </div>
                </>
              )}

              {(snap?.reason || data.industries?.length > 0) && (
                <>
                  <div className="sec-t">概念入选依据</div>
                  <div className="reason-box">
                    {snap?.reason && <div style={{ marginBottom: 8 }}>{snap.reason}</div>}
                    {buildReasonLines(data).map((line, i) => (
                      <div key={i} className="reason-line">· {line}</div>
                    ))}
                    {data.industries?.length > 0 && (
                      <div className="reason-line" style={{ marginTop: 6, color: '#5d6b80' }}>
                        所属行业：{data.industries.join(' / ')}
                      </div>
                    )}
                  </div>
                </>
              )}

              {kl?.bars?.length > 0 && (
                <>
                  <div className="sec-t">近 10 根{kl.label}</div>
                  <div className="tbl-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th className="l">日期</th><th>开盘</th><th>收盘</th>
                          <th>最高</th><th>最低</th><th>涨跌幅</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kl.bars.slice(-10).reverse().map((b, i, arr) => {
                          const prev = arr[i + 1]
                          const chg = prev && prev.c ? ((b.c - prev.c) / prev.c) * 100 : 0
                          return (
                            <tr key={b.d}>
                              <td className="l"><span className="code">{b.d}</span></td>
                              <td>{b.o.toFixed(2)}</td>
                              <td>{b.c.toFixed(2)}</td>
                              <td>{b.h.toFixed(2)}</td>
                              <td>{b.l.toFixed(2)}</td>
                              <td className={cls(chg)}>{pct(chg)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="drawer-actions">
                <button
                  className="btn"
                  onClick={() => navigator.clipboard?.writeText(code)}
                >
                  复制代码
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

/** Turn concept-membership justifications into short readable lines. */
function buildReasonLines(data) {
  const reasons = data.conceptReasons || {}
  const out = []
  for (const [theme, why] of Object.entries(reasons)) {
    if (!why) continue
    const text = why.length > 110 ? why.slice(0, 110) + '…' : why
    out.push(`${theme}：${text}`)
    if (out.length >= 4) break
  }
  return out
}
