import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getReview,
  refresh as apiRefresh,
  refreshStatus,
  getMarket,
  getDates,
  getWatch,
  removeWatch,
} from './lib/api'
import { fmtAmt, pct, cls, badgeCls } from './lib/format'
import { DetailDrawer } from './components/DetailDrawer'
import StockSearch from './components/StockSearch'

const TABS = [
  { key: 'watch', label: '自选' },
  { key: 'leaders', label: '龙头榜' },
  { key: 'up', label: '涨停池' },
  { key: 'lb', label: '连板池' },
  { key: 'zb', label: '炸板池' },
  { key: 'dt', label: '跌停池' },
  { key: 'ladder', label: '连板天梯' },
  { key: 'hot', label: '热股榜' },
  { key: 'compare', label: '昨日对比' },
  { key: 'drawdown', label: '回撤榜' },
]

const SORTS = {
  up: { key: 'score', dir: -1 },
  lb: { key: 'boards', dir: -1 },
  zb: { key: 'chg', dir: -1 },
  dt: { key: 'chg', dir: 1 },
}

function Kpis({ stats }) {
  if (!stats || !stats.upCount && !stats.date) return null
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

function IndexBar({ market }) {
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

function LeaderCards({ list, onOpen }) {
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

const COLS = {
  up: [
    { k: 'code', t: '代码', l: 1, w: (s) => <span className="code">{s.code}</span> },
    { k: 'name', t: '名称', l: 1, w: (s) => <><b>{s.name}</b>{s.boards >= 2 && <span className="bd">{s.boards}板</span>}</> },
    { k: 'latest', t: '现价', w: (s) => Number(s.latest || 0).toFixed(2) },
    { k: 'chg', t: '涨幅', w: (s) => <span className="u">{pct(s.chg)}</span> },
    { k: 'boards', t: '连板', w: (s) => s.daysText },
    { k: 'boardType', t: '板型', w: (s) => s.boardType || '--' },
    { k: 'sealAmt', t: '封单额', w: (s) => fmtAmt(s.sealAmt) },
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

function DataTable({ kind, rows, query, onOpen }) {
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

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.k}
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
  )
}

function Ladder({ ladder, onOpen }) {
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

function HotList({ list, query, onOpen }) {
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

function Compare({ data }) {
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

function Drawdown({ rows, onOpen }) {
  if (!rows?.length) return <div className="empty">暂无回撤数据</div>
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th className="l">代码</th><th className="l">名称</th>
            <th>现价</th><th>今日涨幅</th><th>盘中最高</th><th>回撤幅度</th>
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

function WatchList({ onOpen }) {
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

const DEFAULT_TITLE = 'A股涨停复盘 - 涨停板复盘·连板梯队·封板率·板块效应分析工具'

/** Read the ?date=YYYY-MM-DD deep link (YYYYMMDD is also accepted). */
function readDateFromUrl() {
  try {
    const raw = (new URLSearchParams(window.location.search).get('date') || '').trim()
    if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  } catch {
    /* no window / malformed URL */
  }
  return ''
}

export default function App() {
  const [data, setData] = useState(null)
  const [market, setMarket] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('leaders')
  const [query, setQuery] = useState('')
  const [detailCode, setDetailCode] = useState(null)
  const [stamp, setStamp] = useState('--')
  // '' means "latest"; otherwise a YYYY-MM-DD archive date.
  const [date, setDate] = useState(readDateFromUrl)
  const [dateInput, setDateInput] = useState('')
  const [dates, setDates] = useState([])

  const load = useCallback(async (force = false, targetDate = date) => {
    setLoading(true)
    setError('')
    try {
      // Only the latest day can be rebuilt; archives are read-only.
      if (force && !targetDate) {
        // The rebuild runs in a server-side worker thread (~90s, mostly the
        // previous-day K-line probes). Poll until it settles, then re-read.
        const asked = Date.now()
        await apiRefresh()
        setStamp('刷新中…')
        let settled = false
        for (let i = 0; i < 150; i += 1) {
          await new Promise((r) => setTimeout(r, 1500))
          const st = await refreshStatus()
          // Wait for a build that *finished after* the request was made.
          if (!st.running && (st.last_finished || 0) > asked / 1000) {
            settled = true
            break
          }
        }
        if (!settled) throw new Error('刷新超时，请稍后重试')
      }
      const j = await getReview(targetDate)
      if (j.error) throw new Error(j.error)
      setData(j)
      setDateInput(j.stats?.date || '')
      setStamp(new Date(j.ts).toLocaleTimeString('zh-CN', { hour12: false }))
    } catch (e) {
      setError(e.message || String(e))
      setStamp('加载失败')
    } finally {
      setLoading(false)
    }
  }, [date])

  /** Switch to an archive date ('' = latest) and reflect it in the URL. */
  const selectDate = useCallback((next) => {
    const d = next || ''
    setDate(d)
    try {
      const url = new URL(window.location.href)
      if (d) url.searchParams.set('date', d)
      else url.searchParams.delete('date')
      window.history.pushState({ date: d }, '', url)
    } catch {
      /* history unavailable */
    }
  }, [])

  useEffect(() => {
    load()
    getMarket().then(setMarket).catch(() => {})
    const t = setInterval(() => getMarket().then(setMarket).catch(() => {}), 60000)
    return () => clearInterval(t)
  }, [load])

  // Back/forward navigation between archive deep links.
  useEffect(() => {
    const onPop = () => setDate(readDateFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Available archive dates, newest first.
  useEffect(() => {
    getDates()
      .then((r) => setDates((r.dates || []).map((x) => x.date)))
      .catch(() => {})
  }, [])

  // Per-date <title> so each archive day has its own search snippet.
  useEffect(() => {
    const s = data?.stats
    document.title = s?.date
      ? `${s.date} A股涨停复盘 - 涨停${s.upCount ?? 0}家·最高${s.maxBoard ?? 0}板`
      : DEFAULT_TITLE
  }, [data])

  const openDetail = useCallback((code) => setDetailCode(code), [])

  const stats = data?.stats
  const pools = data?.pools || {}

  // Archive navigation: the list is newest-first, so +1 is older, -1 newer.
  const dateList = useMemo(() => {
    const today = stats?.date
    const list = [...dates]
    if (today && !list.includes(today)) list.unshift(today)
    return list
  }, [dates, stats])
  const curIdx = dateList.indexOf(date || stats?.date || '')
  const prevDate = curIdx >= 0 ? dateList[curIdx + 1] : null // older
  const nextDate = curIdx > 0 ? dateList[curIdx - 1] : null // newer
  const isArchive = Boolean(date)

  useEffect(() => {
    if (detailCode) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [detailCode])

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="logo">复</div>
          <div>
            <h1>A股涨停复盘 <span className="ver">v1.0</span></h1>
            <p>涨停梯队 · 连板天梯 · 封板率 · 板块效应</p>
          </div>
        </div>
        <div className="tools">
          <StockSearch onPick={openDetail} />
          <div className="datenav">
            <button
              className="dnav"
              onClick={() => prevDate && selectDate(prevDate)}
              disabled={!prevDate || loading}
              title={prevDate ? `上一交易日 ${prevDate}` : '没有更早的数据'}
            >
              ‹
            </button>
            <input
              className="inp"
              type="date"
              value={dateInput || ''}
              onChange={(e) => selectDate(e.target.value)}
              title="选择历史日期（仅已缓存日期可用）"
            />
            <button
              className="dnav"
              onClick={() => nextDate && selectDate(nextDate)}
              disabled={!nextDate || loading}
              title={nextDate ? `下一交易日 ${nextDate}` : '已是最新'}
            >
              ›
            </button>
          </div>
          {isArchive ? (
            <button className="btn" onClick={() => selectDate('')} disabled={loading}>
              返回最新
            </button>
          ) : (
            <button className="btn primary" onClick={() => load(true)} disabled={loading}>
              {loading ? '刷新中…' : '刷新数据'}
            </button>
          )}
          <span className="stamp">{stamp}</span>
        </div>
      </header>

      {isArchive && (
        <div className="archive-bar">
          <span>正在查看 <b>{date}</b> 的历史复盘（只读）</span>
          <button className="link" onClick={() => selectDate('')}>回到最新 →</button>
        </div>
      )}

      <IndexBar market={market} />
      <Kpis stats={stats} />

      {stats?.sectors?.length > 0 && (
        <section className="sectors">
          <span className="lbl">概念聚合</span>
          {stats.sectors.map((s) => (
            <button key={s.name} className="chip" onClick={() => { setQuery(s.name); setTab('up') }}>
              <b>{s.name}</b><i>{s.n}家</i>
            </button>
          ))}
        </section>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'on' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="toolbar">
        <input
          className="inp search"
          placeholder="搜索代码 / 名称 / 板块 / 板型"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="legend">
          <span><span className="dot up" />涨停/连板</span>
          <span><span className="dot down" />跌停</span>
          <span className="tag-badge b-up">龙头 · 主攻</span>
          <span className="tag-badge b-mild">强势 · 接力</span>
          <span className="tag-badge b-flat">跟风 · 观察</span>
        </div>
      </div>

      <main className="view">
        {tab === 'watch' ? (
          <WatchList onOpen={openDetail} />
        ) : error ? (
          <div className="empty">
            数据加载失败：{error}
            <br /><br />
            请确认后端服务已启动（http://127.0.0.1:8000），且网络可访问行情源。
          </div>
        ) : !data ? (
          <div className="empty">加载中…</div>
        ) : tab === 'leaders' ? (
          <LeaderCards list={data.leaders} onOpen={openDetail} />
        ) : tab === 'ladder' ? (
          <Ladder ladder={data.ladder} onOpen={openDetail} />
        ) : tab === 'hot' ? (
          <HotList list={data.hot} query={query} onOpen={openDetail} />
        ) : tab === 'compare' ? (
          <Compare data={data.compare} />
        ) : tab === 'drawdown' ? (
          <Drawdown rows={data.drawdown} onOpen={openDetail} />
        ) : (
          <DataTable kind={tab} rows={pools[tab]} query={query} onOpen={openDetail} />
        )}
      </main>

      {detailCode && (
        <DetailDrawer code={detailCode} onClose={() => setDetailCode(null)} />
      )}
    </>
  )
}
