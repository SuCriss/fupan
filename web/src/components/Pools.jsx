import React, { useMemo, useState } from 'react'
import { fmtAmt, pct, cls } from '../lib/format'
import { exportCsv } from '../lib/export'

/**
 * Plain-text field map for CSV export, kept separate from the render columns:
 * those return JSX, which would stringify to "[object Object]" in a cell.
 */
const CSV_FIELDS = {
  up: [
    ['代码', (s) => s.code],
    ['名称', (s) => s.name],
    ['现价', (s) => Number(s.latest || 0).toFixed(2)],
    ['涨幅%', (s) => Number(s.chg || 0).toFixed(2)],
    ['连板', (s) => s.daysText],
    ['首封', (s) => s.firstTime || ''],
    ['区间涨停', (s) => s.statText || ''],
    ['板型', (s) => s.boardType || ''],
    ['封单额', (s) => Math.round(s.sealAmt || 0)],
    ['炸板次数', (s) => s.openNum || 0],
    ['换手%', (s) => Number(s.turnover || 0).toFixed(1)],
    ['流通市值', (s) => Math.round(s.floatCap || 0)],
    ['板块', (s) => s.sector || ''],
    ['评分', (s) => s.score?.total ?? ''],
  ],
  lb: [
    ['代码', (s) => s.code],
    ['名称', (s) => s.name],
    ['现价', (s) => Number(s.latest || 0).toFixed(2)],
    ['涨幅%', (s) => Number(s.chg || 0).toFixed(2)],
    ['连板数', (s) => s.boards],
    ['统计', (s) => s.daysText],
    ['首封', (s) => s.firstTime || ''],
    ['板型', (s) => s.boardType || ''],
    ['封单额', (s) => Math.round(s.sealAmt || 0)],
    ['评分', (s) => s.score?.total ?? ''],
  ],
  zb: [
    ['代码', (s) => s.code],
    ['名称', (s) => s.name],
    ['现价', (s) => Number(s.latest || 0).toFixed(2)],
    ['涨幅%', (s) => Number(s.chg || 0).toFixed(2)],
    ['最高', (s) => Number(s.high || 0).toFixed(2)],
    ['换手%', (s) => Number(s.turnover || 0).toFixed(1)],
    ['成交额', (s) => Math.round(s.amount || 0)],
    ['市场', (s) => s.market || ''],
  ],
  dt: [
    ['代码', (s) => s.code],
    ['名称', (s) => s.name],
    ['现价', (s) => Number(s.latest || 0).toFixed(2)],
    ['跌幅%', (s) => Number(s.chg || 0).toFixed(2)],
    ['换手%', (s) => Number(s.turnover || 0).toFixed(1)],
    ['成交额', (s) => Math.round(s.amount || 0)],
    ['市场', (s) => s.market || ''],
  ],
}

/** Default sort per pool kind; user clicks override it. */
const SORTS = {
  up: { key: 'score', dir: -1 },
  lb: { key: 'boards', dir: -1 },
  zb: { key: 'chg', dir: -1 },
  dt: { key: 'chg', dir: 1 },
}

const COLS = {
  up: [
    { k: 'code', t: '代码', l: 1, w: (s) => <span className="code">{s.code}</span> },
    { k: 'name', t: '名称', l: 1, w: (s) => <><b>{s.name}</b>{s.boards >= 2 && <span className="bd">{s.boards}板</span>}</> },
    { k: 'latest', t: '现价', w: (s) => Number(s.latest || 0).toFixed(2) },
    { k: 'chg', t: '涨幅', w: (s) => <span className="u">{pct(s.chg)}</span> },
    { k: 'boards', t: '连板', w: (s) => s.daysText },
    // First-seal time comes from the exchange feed; it shows when the money
    // actually arrived, which the snapshot alone cannot tell.
    { k: 'firstTime', t: '首封', w: (s) => <span className="ft">{s.firstTime || '--:--'}</span> },
    {
      k: 'statText',
      t: '区间涨停',
      // Deliberately not labelled "连板": the exchange counts limit-ups inside a
      // fixed window (10 days), while our 连板 column counts consecutive boards.
      // Showing both without saying so reads as a contradiction (5板 vs 6板).
      w: (s) =>
        s.statText ? (
          <span title="近10个交易日累计涨停次数（交易所口径，与「连板」的连续计数窗口不同）">
            {s.statText}
          </span>
        ) : '--',
    },
    { k: 'boardType', t: '板型', w: (s) => s.boardType || '--' },
    { k: 'sealAmt', t: '封单额', w: (s) => fmtAmt(s.sealAmt) },
    { k: 'openNum', t: '炸板', w: (s) => (s.openNum ? `${s.openNum}次` : '—') },
    { k: 'turnover', t: '换手', w: (s) => `${Number(s.turnover || 0).toFixed(1)}%` },
    { k: 'floatCap', t: '流通市值', w: (s) => fmtAmt(s.floatCap) },
    { k: 'sector', t: '板块', w: (s) => (s.sector ? `${s.sector}×${s.sectorN}` : '--') },
    { k: 'score', t: '评分', w: (s) => <span className="g">{s.score?.total ?? '--'}</span> },
  ],
  lb: [
    { k: 'code', t: '代码', l: 1, w: (s) => <span className="code">{s.code}</span> },
    { k: 'name', t: '名称', l: 1, w: (s) => <b>{s.name}</b> },
    { k: 'latest', t: '现价', w: (s) => Number(s.latest || 0).toFixed(2) },
    { k: 'chg', t: '涨幅', w: (s) => <span className="u">{pct(s.chg)}</span> },
    { k: 'boards', t: '连板数', w: (s) => s.boards },
    { k: 'days', t: '统计', w: (s) => s.daysText },
    { k: 'boardType', t: '板型', w: (s) => s.boardType || '--' },
    { k: 'sealAmt', t: '封单额', w: (s) => fmtAmt(s.sealAmt) },
    { k: 'score', t: '评分', w: (s) => <span className="g">{s.score?.total ?? '--'}</span> },
  ],
  zb: [
    { k: 'code', t: '代码', l: 1, w: (s) => <span className="code">{s.code}</span> },
    { k: 'name', t: '名称', l: 1, w: (s) => <b>{s.name}</b> },
    { k: 'latest', t: '现价', w: (s) => Number(s.latest || 0).toFixed(2) },
    { k: 'chg', t: '涨幅', w: (s) => <span className={cls(s.chg)}>{pct(s.chg)}</span> },
    { k: 'high', t: '最高', w: (s) => Number(s.high || 0).toFixed(2) },
    { k: 'turnover', t: '换手', w: (s) => `${Number(s.turnover || 0).toFixed(1)}%` },
    { k: 'amount', t: '成交额', w: (s) => fmtAmt(s.amount) },
    { k: 'market', t: '市场', w: (s) => s.market || '--' },
  ],
  dt: [
    { k: 'code', t: '代码', l: 1, w: (s) => <span className="code">{s.code}</span> },
    { k: 'name', t: '名称', l: 1, w: (s) => <b>{s.name}</b> },
    { k: 'latest', t: '现价', w: (s) => Number(s.latest || 0).toFixed(2) },
    { k: 'chg', t: '跌幅', w: (s) => <span className="d">{pct(s.chg)}</span> },
    { k: 'turnover', t: '换手', w: (s) => `${Number(s.turnover || 0).toFixed(1)}%` },
    { k: 'amount', t: '成交额', w: (s) => fmtAmt(s.amount) },
    { k: 'market', t: '市场', w: (s) => s.market || '--' },
  ],
}

/** Sortable, searchable table for the 涨停/连板/炸板/跌停 pools. */
export function DataTable({ kind, rows, query, onOpen }) {
  const [sort, setSort] = useState(SORTS[kind] || { key: 'chg', dir: -1 })
  const cols = COLS[kind]

  const list = useMemo(() => {
    let src = rows || []
    const q = (query || '').trim()
    if (q) {
      src = src.filter(
        (s) =>
          String(s.code).includes(q) ||
          String(s.name).includes(q) ||
          String(s.boardType || '').includes(q) ||
          // Match every concept the stock carries, not just its headline sector,
          // so a chip's count always equals the filtered row count.
          (s.concepts || []).some((c) => String(c).includes(q)) ||
          String(s.sector || '').includes(q) ||
          String(s.industry || '').includes(q)
      )
    }
    const num = (v) => (v == null || v === '' ? -1e9 : typeof v === 'number' ? v : parseFloat(v) || 0)
    return [...src].sort((a, b) => {
      const av = sort.key === 'score' ? a.score?.total ?? 0 : a[sort.key]
      const bv = sort.key === 'score' ? b.score?.total ?? 0 : b[sort.key]
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av ?? '').localeCompare(String(bv ?? ''), 'zh') * sort.dir
      }
      return (num(av) - num(bv)) * sort.dir
    })
  }, [rows, query, sort])

  if (!list.length) return <div className="empty">没有匹配的数据</div>

  const handleExport = () => {
    const fields = CSV_FIELDS[kind]
    if (!fields) return
    const stamp = new Date().toISOString().slice(0, 10)
    exportCsv(
      `${kind === 'up' ? '涨停池' : kind === 'lb' ? '连板池' : kind === 'zb' ? '炸板池' : '跌停池'}-${stamp}`,
      fields.map(([t]) => t),
      // Exports the current filtered + sorted view, not the raw pool.
      list.map((s) => fields.map(([, get]) => get(s)))
    )
  }

  return (
    <>
      <div className="tbl-tools">
        <span className="tbl-count">{list.length} 只</span>
        <button className="btn sm" onClick={handleExport} title="导出当前筛选与排序后的数据">
          导出 CSV
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.k}
                  scope="col"
                  className={c.l ? 'l' : ''}
                  onClick={() =>
                    setSort((cur) => ({ key: c.k, dir: cur.key === c.k ? -cur.dir : -1 }))
                  }
                >
                  {c.t}
                  {sort.key === c.k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.code} onClick={() => onOpen(s.code)}>
                {cols.map((c) => (
                  <td key={c.k} className={c.l ? 'l' : ''}>{c.w(s)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Consecutive-board ladder with day-over-day promotion deltas. */
export function Ladder({ ladder, onOpen }) {
  if (!ladder?.length) return <div className="empty">暂无连板数据</div>
  return (
    <div className="ladder">
      {ladder.map((r) => {
        const n = r.todayCount ?? r.list.length
        const d = r.delta
        const tip = d == null ? `${n} 只` : d > 0 ? `${n} 只 · 较昨日 +${d}` : d < 0 ? `${n} 只 · 较昨日 ${d}` : `${n} 只 · 持平`
        const tcls = !d ? '' : d > 0 ? 'up' : 'dn'
        return (
          <div className={`rung${r.gap ? ' gap' : ''}`} key={r.board}>
            <div className="h">{r.board} 板<small className={tcls}>{tip}</small></div>
            <div className="b">
              {r.list.length ? (
                r.list.map((s) => (
                  <span
                    key={s.code}
                    className={`stockchip ${s.chg < 0 ? 'dn' : ''}`}
                    onClick={() => onOpen(s.code)}
                  >
                    <b>{s.name}</b><em>{pct(s.chg)}</em>
                  </span>
                ))
              ) : (
                <span className="gaptxt">空档 · 全层断层</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Ranked hot list with keyword filtering across code, name and concepts. */
export function HotList({ list, query, onOpen }) {
  const q = (query || '').trim()
  const rows = q
    ? (list || []).filter(
        (x) =>
          x.code.includes(q) ||
          x.name.includes(q) ||
          (x.concepts || []).join('').includes(q)
      )
    : list || []
  if (!rows.length) return <div className="empty">没有匹配的热股</div>
  return rows.map((s) => (
    <div className="hotrow" key={s.code} onClick={() => onOpen(s.code)}>
      <div className={`no ${s.rank <= 10 ? 'top' : ''}`}>{s.rank}</div>
      <div>
        <h4>
          {s.name} <span>{s.code}</span>
          {s.board && <span className="tag-badge b-up">{s.board}</span>}
        </h4>
        {s.title && <div className="tt">{s.title}</div>}
        {s.concepts?.length > 0 && (
          <div className="conc">{s.concepts.map((c, i) => <i key={i}>{c}</i>)}</div>
        )}
      </div>
      <div className="rt">
        <div className={cls(s.rise)} style={{ fontSize: 15, fontWeight: 700 }}>{pct(s.rise)}</div>
        <div style={{ fontSize: 11, color: '#5d6b80', marginTop: 2 }}>热度 {fmtAmt(s.heat)}</div>
      </div>
    </div>
  ))
}

/** Yesterday-vs-today ladder comparison with the promotion rate. */
export function Compare({ data }) {
  if (!data) return <div className="empty">暂无对比数据</div>
  const promo = data.promotionRate
  return (
    <>
      <div className="kpis" style={{ padding: '0 0 14px' }}>
        <div className="kpi u">
          <div className="k">昨日涨停</div>
          <div className="v u">{data.yestTotal ?? 0}</div>
          <div className="s">{data.prevDate || ''}</div>
        </div>
        <div className="kpi u">
          <div className="k">今日涨停</div>
          <div className="v u">{data.todayTotal ?? 0}</div>
          <div className="s">含连板与首板</div>
        </div>
        <div className="kpi g">
          <div className="k">连板晋级率</div>
          <div className="v g">{promo == null ? '--' : `${promo}%`}</div>
          <div className="s">今日 / 昨日</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {[
          { title: `昨日 ${data.prevDate || ''}`, groups: data.yest || [] },
          { title: '今日', groups: data.today || [] },
        ].map((side) => (
          <div key={side.title}>
            <div className="sec-t">{side.title}</div>
            {side.groups.map((g) => (
              <div className="rung" key={g.board} style={{ marginBottom: 8 }}>
                <div className="h">{g.label}<small>{g.list.length} 只</small></div>
                <div className="b">
                  {g.list.map((s) => (
                    <span key={s.code} className="stockchip">
                      <b>{s.name || s.code}</b>
                      {s.chg ? <em>{pct(s.chg)}</em> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {!side.groups.length && <div className="empty" style={{ padding: 24 }}>暂无数据</div>}
          </div>
        ))}
      </div>
    </>
  )
}

/** Intraday drawdown table for stocks that failed to hold their high. */
export function Drawdown({ rows, onOpen }) {
  if (!rows?.length) return <div className="empty">暂无回撤数据</div>
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" className="l">代码</th><th scope="col" className="l">名称</th>
            <th scope="col">现价</th><th scope="col">今日涨幅</th><th scope="col">盘中最高</th><th scope="col">回撤幅度</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)}>
              <td className="l"><span className="code">{r.code}</span></td>
              <td className="l"><b>{r.name}</b></td>
              <td>{Number(r.price || 0).toFixed(2)}</td>
              <td className={cls(r.chg)}>{pct(r.chg)}</td>
              <td className="u">{pct(r.highChg)}</td>
              <td className="d">{pct(r.dd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
