import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getStock, getStockAi, getWatch, addWatch, removeWatch } from '../lib/api'
import { KlineChart, KlineSkeleton } from './Kline'
import { MinuteChart } from './MinuteChart'
import { fmtAmt, pct, cls, badgeCls } from '../lib/format'

const PERIODS = [
  ['day', '日线'],
  ['week', '周线'],
  ['month', '月线'],
  ['quarter', '季线'],
]

/** Signed 亿/万 formatting for money-flow amounts (yuan). */
function fmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return '--'
  const n = Number(v)
  const abs = Math.abs(n)
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`
  return `${sign}${abs.toFixed(0)}`
}

/** Same scale, but without the leading plus (turnover amounts are unsigned). */
function fmtMoneyAbs(v) {
  return fmtMoney(v).replace(/^\+/, '')
}

export function DetailDrawer({ code, onClose, onConcept }) {
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
    let polls = 0

    /**
     * While a summary is generating, poll the cheap AI-only endpoint. Polling
     * the full detail would re-run six upstream fetches behind every tick.
     */
    const pollAi = async () => {
      if (!alive || polls >= 80) return
      polls += 1
      try {
        const a = await getStockAi(code)
        if (!alive) return
        if (a.status === 'ready' && a.summary) {
          const d = await getStock(code) // cached server-side, one cheap read
          if (alive) setData(d)
          return
        }
        if (a.status === 'generating') {
          clearTimeout(pollRef.current)
          pollRef.current = setTimeout(pollAi, 3000)
        }
      } catch {
        /* stop polling on a failed status read */
      }
    }

    const load = async () => {
      try {
        const d = await getStock(code)
        if (!alive) return
        setData(d)
        if (d.ai?.status === 'generating') {
          clearTimeout(pollRef.current)
          pollRef.current = setTimeout(pollAi, 3000)
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
                  {data.concepts.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      className="concept-chip"
                      onClick={() => onConcept?.(c)}
                      title={`查看「${c}」相关涨停`}
                    >
                      {c}
                    </button>
                  ))}
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

              {/* Limit-up track record, derived from the daily bars above. */}
              {data.limitStats && data.limitStats.limitUps > 0 && (
                <>
                  <div className="sec-t">
                    涨停记录
                    <span className="sec-note">近 {data.limitStats.window} 个交易日</span>
                  </div>
                  <div className="mgrid">
                    {[
                      ['涨停次数', data.limitStats.limitUps],
                      ['晋级次数', data.limitStats.promoted],
                      ['晋级率', data.limitStats.promoteRate == null ? '--' : `${data.limitStats.promoteRate}%`],
                      ['封板率', data.limitStats.sealRate == null ? '--' : `${data.limitStats.sealRate}%`],
                      ['炸板次数', data.limitStats.broken],
                      [
                        '次日均涨',
                        <span className={cls(data.limitStats.avgNextChg)}>
                          {data.limitStats.avgNextChg == null ? '--' : pct(data.limitStats.avgNextChg)}
                        </span>,
                      ],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="k">{k}</div>
                        <div className="v">{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Money flow: today's order-size split plus recent net inflow. */}
              {data.moneyFlow?.today && (
                <>
                  <div className="sec-t">主力资金</div>
                  <div className="flow-main">
                    <span className="fl-k">主力净额</span>
                    <span className={`fl-v ${cls(data.moneyFlow.today.main)}`}>
                      {fmtMoney(data.moneyFlow.today.main)}
                    </span>
                  </div>
                  <div className="flow-grid">
                    {[
                      ['超大单', data.moneyFlow.today.super],
                      ['大单', data.moneyFlow.today.big],
                      ['中单', data.moneyFlow.today.mid],
                      ['小单', data.moneyFlow.today.small],
                    ].map(([k, v]) => (
                      <div className="flow-row" key={k}>
                        <span className="fl-k">{k}</span>
                        <span className={`fl-v ${cls(v)}`}>{fmtMoney(v)}</span>
                      </div>
                    ))}
                  </div>
                  {data.moneyFlow.history?.length > 0 && (
                    <div className="flow-hist">
                      {(() => {
                        const hist = data.moneyFlow.history.slice(0, 6)
                        const peak = Math.max(...hist.map((h) => Math.abs(h.main)), 1)
                        return hist.map((h) => (
                          <div className="fh-row" key={h.date}>
                            <span className="fh-d">{(h.date || '').slice(5)}</span>
                            <span className="fh-bar">
                              <i
                                className={h.main >= 0 ? 'up' : 'dn'}
                                style={{ width: `${Math.max(2, (Math.abs(h.main) / peak) * 100)}%` }}
                              />
                            </span>
                            <span className={`fh-v ${cls(h.main)}`}>{fmtMoney(h.main)}</span>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                </>
              )}

              {/* Dragon-tiger list appearances. */}
              {data.lhb?.length > 0 && (
                <>
                  <div className="sec-t">
                    龙虎榜
                    <span className="sec-note">近 {data.lhb.length} 次</span>
                  </div>
                  <div className="lhb-list">
                    {data.lhb.map((r, i) => (
                      <div className="lhb-item" key={`${r.date}-${i}`}>
                        <div className="lhb-head">
                          <span className="lhb-date">{r.date}</span>
                          <span className={`lhb-chg ${cls(r.chg)}`}>{pct(r.chg)}</span>
                          {r.nextChg != null && (
                            <span className={`lhb-next ${cls(r.nextChg)}`}>
                              次日 {pct(r.nextChg)}
                            </span>
                          )}
                        </div>
                        {r.reason && <div className="lhb-reason">{r.reason}</div>}
                        <div className="lhb-nums">
                          <span>买 {fmtMoneyAbs(r.buy)}</span>
                          <span>卖 {fmtMoneyAbs(r.sell)}</span>
                          <span className={cls(r.net)}>净 {fmtMoney(r.net)}</span>
                        </div>
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
