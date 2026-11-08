import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getReview,
  refresh as apiRefresh,
  refreshStatus,
  getMarket,
  getDates,
  getSentiment,
  getSectors,
} from './lib/api'
import { readPref, writePref, notifyUpdated } from './lib/prefs'
import StockSearch from './components/StockSearch'
import { SentimentPanel } from './components/Sentiment'
import { SectorGrid, SectorDetail } from './components/Sector'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Kpis, IndexBar, LeaderCards } from './components/Overview'
import { DataTable, Ladder, HotList, Compare, Drawdown } from './components/Pools'
import { WatchList } from './components/WatchList'
import { TimeDist } from './components/TimeDist'

// The drawer carries the charting code (K-line, minute chart), which is only
// needed once a stock is opened. Keeping it out of the initial bundle speeds up
// first paint; it is prefetched on idle so the first open is still instant.
const DetailDrawer = React.lazy(() =>
  import('./components/DetailDrawer').then((m) => ({ default: m.DetailDrawer }))
)

const TABS = [
  { key: 'watch', label: '自选' },
  { key: 'leaders', label: '龙头榜' },
  { key: 'sectors', label: '板块' },
  { key: 'up', label: '涨停池' },
  { key: 'lb', label: '连板池' },
  { key: 'zb', label: '炸板池' },
  { key: 'dt', label: '跌停池' },
  { key: 'ladder', label: '连板天梯' },
  { key: 'hot', label: '热股榜' },
  { key: 'compare', label: '昨日对比' },
  { key: 'drawdown', label: '回撤榜' },
]

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
  // Freshness is derived from the snapshot's own timestamp so the header can say
  // how old the data actually is, not just when it was fetched.
  const [dataTs, setDataTs] = useState(0)
  const [stampBusy, setStampBusy] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  // '' means "latest"; otherwise a YYYY-MM-DD archive date.
  const [date, setDate] = useState(readDateFromUrl)
  const [dateInput, setDateInput] = useState('')
  const [dates, setDates] = useState([])
  const [trend, setTrend] = useState([])
  const [sectors, setSectors] = useState(null)
  const [sectorSel, setSectorSel] = useState('')
  // Auto-refresh during trading hours, persisted across visits.
  const [autoOn, setAutoOn] = useState(() => readPref('fupan_auto') === '1')
  const [autoMin, setAutoMin] = useState(() => Number(readPref('fupan_auto_min')) || 10)
  const [nextAt, setNextAt] = useState(0)
  const [notifyOn, setNotifyOn] = useState(() => readPref('fupan_notify') === '1')
  const busyRef = useRef(false)
  // Newest request that arrived while one was in flight (coalesced, not queued).
  const pendingRef = useRef(null)
  // Live view of the selected day, so a slow response cannot compare against a
  // stale closure value.
  const dateRef = useRef(date)
  dateRef.current = date

  const loadTrend = useCallback(() => {
    getSentiment(60)
      .then((r) => setTrend(r.list || []))
      .catch(() => {})
  }, [])

  /**
   * Load (and optionally rebuild) the review document.
   * `silent` keeps the auto-refresh from disabling the whole UI every cycle.
   *
   * Concurrent calls are *coalesced*, not dropped: a request that arrives while
   * one is in flight replaces the queued one, so a burst of date switches ends on
   * the day the user actually picked instead of silently keeping an older one.
   */
  const load = useCallback(async (force = false, targetDate = date, silent = false) => {
    if (busyRef.current) {
      pendingRef.current = { force, targetDate, silent }
      return
    }
    busyRef.current = true
    if (!silent) setLoading(true)
    setError('')
    try {
      // Only the latest day can be rebuilt; archives are read-only.
      if (force && !targetDate) {
        // The rebuild runs in a server-side worker thread (~90s, mostly the
        // previous-day K-line probes). Poll until it settles, then re-read.
        const asked = Date.now()
        await apiRefresh()
        setStampBusy(silent ? '自动刷新中…' : '刷新中…')
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
      // Only mirror the response into the picker when it still matches the
      // user's selection; a slower response must not drag it back to an older day.
      if ((targetDate || '') === (dateRef.current || '')) {
        setDateInput(j.stats?.date || '')
      }
      setDataTs(Number(j.ts) || Date.now())
      setStampBusy('')
      if (force) loadTrend()
      if (silent) notifyUpdated(j)
    } catch (e) {
      if (silent) {
        // A background refresh must never blank out data the user is reading.
        setStampBusy('自动刷新失败')
      } else {
        setError(e.message || String(e))
        setStampBusy('加载失败')
      }
    } finally {
      busyRef.current = false
      if (!silent) setLoading(false)
      // Run whatever arrived while this request was in flight.
      const next = pendingRef.current
      pendingRef.current = null
      if (next) load(next.force, next.targetDate, next.silent)
    }
  }, [date, loadTrend])

  /** Switch to an archive date ('' = latest) and reflect it in the URL. */
  const selectDate = useCallback((next) => {
    const d = next || ''
    setDate(d)
    setDateInput(d) // reflect the choice immediately, before the fetch lands
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
  }, [load])

  // Indices and the sentiment trend do not depend on the selected archive day,
  // so they are polled once here instead of re-firing on every date switch.
  useEffect(() => {
    getMarket().then(setMarket).catch(() => {})
    const t = setInterval(() => getMarket().then(setMarket).catch(() => {}), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    loadTrend()
  }, [loadTrend])

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

  // Sector dossiers are derived from the snapshot, so refresh them with it.
  useEffect(() => {
    if (!data) return
    getSectors(24)
      .then((r) => setSectors(r.list || []))
      .catch(() => setSectors([]))
  }, [data])

  // Warm the lazily-split drawer chunk once the page is idle: first paint stays
  // lean, but the first stock click still opens without a network stall.
  useEffect(() => {
    const warm = () => { import('./components/DetailDrawer').catch(() => {}) }
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(warm, { timeout: 3000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const id = setTimeout(warm, 1500)
    return () => clearTimeout(id)
  }, [])

  // Per-date <title> so each archive day has its own search snippet.
  useEffect(() => {
    const s = data?.stats
    document.title = s?.date
      ? `${s.date} A股涨停复盘 - 涨停${s.upCount ?? 0}家·最高${s.maxBoard ?? 0}板`
      : DEFAULT_TITLE
  }, [data])

  const openDetail = useCallback((code) => setDetailCode(code), [])

  // --- trading-hours auto refresh -----------------------------------------
  useEffect(() => {
    writePref('fupan_auto', autoOn ? '1' : '0')
    writePref('fupan_auto_min', String(autoMin))
  }, [autoOn, autoMin])

  const marketStatus = market?.status || ''
  const inSession = marketStatus === '交易中' || marketStatus === '集合竞价'
  // Archive days are read-only, and there is nothing to poll when the market
  // is closed, so the switch only bites during a live session.
  const autoActive = autoOn && inSession && !date

  useEffect(() => {
    if (!autoActive) {
      setNextAt(0)
      return undefined
    }
    const period = Math.max(1, autoMin) * 60000
    setNextAt(Date.now() + period)
    const t = setInterval(() => {
      // Leave `nextAt` due while hidden so returning to the tab refreshes at
      // once instead of waiting out another full period.
      if (document.visibilityState === 'hidden') return
      setNextAt(Date.now() + period)
      load(true, date, true)
    }, period)
    return () => clearInterval(t)
  }, [autoActive, autoMin, date, load])

  // If a refresh came due while the tab was in the background, run it now.
  useEffect(() => {
    if (!autoActive) return undefined
    const onVis = () => {
      if (document.visibilityState === 'visible' && nextAt && Date.now() >= nextAt) {
        load(true, date, true)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [autoActive, nextAt, date, load])

  // Keep the relative age honest without re-rendering on every tick.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const stats = data?.stats
  const pools = data?.pools || {}

  // Freshness tiers mirror the server's SNAPSHOT_TTL (900s): under 5 minutes is
  // fresh, under the TTL is aging, beyond it the served data is stale.
  const ageSec = dataTs ? Math.max(0, Math.round((nowMs - dataTs) / 1000)) : null
  const freshCls =
    ageSec == null ? 'unknown' : ageSec <= 300 ? 'fresh' : ageSec <= 900 ? 'aging' : 'stale'
  const ageText =
    ageSec == null
      ? '--'
      : ageSec < 45
        ? '刚刚更新'
        : ageSec < 3600
          ? `${Math.max(1, Math.round(ageSec / 60))} 分钟前`
          : `${(ageSec / 3600).toFixed(1)} 小时前`
  const updTime = dataTs
    ? new Date(dataTs).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)
    : '--:--'
  const dataDay = stats?.date || ''
  const stampTitle = dataTs
    ? `数据时间 ${new Date(dataTs).toLocaleString('zh-CN', { hour12: false })}`
      + ` · 数据日期 ${dataDay || '--'}`
      + ` · 行情 ${market?.status || '--'}`
    : '尚未加载数据'

  // `/api/market` has not answered yet on first paint. Saying "非交易时段" then
  // would be a guess, and a wrong one during a live session.
  const autoHint = !autoOn
    ? '已关闭'
    : date
      ? '归档只读'
      : !marketStatus
        ? '等待行情状态…'
        : !inSession
          ? `${marketStatus} · 暂停`
          : nextAt
            ? `下次 ${new Date(nextAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)}`
            : '等待行情状态…'

  const toggleNotify = async () => {
    try {
      if (notifyOn) {
        writePref('fupan_notify', '0')
        setNotifyOn(false)
        return
      }
      if (typeof Notification === 'undefined') return
      const perm =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission()
      if (perm === 'granted') {
        writePref('fupan_notify', '1')
        setNotifyOn(true)
      }
    } catch {
      /* notifications are optional */
    }
  }

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
          <span className={`stamp ${stampBusy ? 'busy' : freshCls}`} title={stampTitle}>
            <i className="stamp-dot" />
            {dataTs ? (
              <>
                {dataDay && <b>{dataDay.slice(5)}</b>}
                {' '}
                <span className="stamp-time">{updTime} 更新 · {ageText}</span>
              </>
            ) : (
              <span className="stamp-time">加载中…</span>
            )}
            {stampBusy && <em className="stamp-busy">{stampBusy}</em>}
          </span>
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
      {data?.sentiment && (
        <SentimentPanel
          sentiment={data.sentiment}
          series={trend}
          date={stats?.date || ''}
        />
      )}

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

      <nav className="tabs" role="tablist" aria-label="复盘视图">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
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
        <div className={`autoref${autoOn ? ' on' : ''}`}>
          <button
            type="button"
            className="ar-switch"
            onClick={() => setAutoOn((v) => !v)}
            aria-pressed={autoOn}
            title="交易时段内自动刷新复盘数据"
          >
            <i aria-hidden="true" />
            <span>自动刷新</span>
          </button>
          <select
            className="inp ar-sel"
            value={autoMin}
            onChange={(e) => setAutoMin(Number(e.target.value))}
            disabled={!autoOn}
            aria-label="自动刷新间隔"
          >
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>每 {m} 分钟</option>
            ))}
          </select>
          <span className="ar-hint">{autoHint}</span>
          <button
            type="button"
            className={`ar-bell${notifyOn ? ' on' : ''}`}
            onClick={toggleNotify}
            aria-pressed={notifyOn}
            title={notifyOn ? '关闭更新通知' : '开启更新通知（标签页在后台时提醒）'}
          >
            {notifyOn ? '🔔' : '🔕'}
          </button>
        </div>
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
        ) : tab === 'up' ? (
          <>
            <TimeDist rows={pools.up} />
            <DataTable kind="up" rows={pools.up} query={query} onOpen={openDetail} />
          </>
        ) : tab === 'sectors' ? (
          sectorSel ? (
            <SectorDetail
              sector={(sectors || []).find((s) => s.name === sectorSel)}
              onBack={() => setSectorSel('')}
              onOpen={openDetail}
            />
          ) : (
            <SectorGrid sectors={sectors} onSelect={setSectorSel} />
          )
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
        <React.Suspense fallback={<div className="mask" />}>
          <ErrorBoundary resetKey={detailCode}>
            <DetailDrawer
              code={detailCode}
              onClose={() => setDetailCode(null)}
              onConcept={(name) => {
                setDetailCode(null)
                setQuery(name)
                setTab('up')
              }}
            />
          </ErrorBoundary>
        </React.Suspense>
      )}
    </>
  )
}
