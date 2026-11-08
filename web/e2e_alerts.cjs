const { chromium } = require('playwright-core')
const { gotoWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const SITE = 'https://fupan.chrisite.eu.cc/'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

const row = (code, name, status, chg, boards = 0) => ({
  code, name, status, chg, price: 10, pre_close: 10, open: 10, high: 10, low: 10,
  turnover: 1, amount: 1e8, limitPct: 10, boards,
  daysText: boards >= 2 ? `${boards}连板` : '首板',
})

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  // Only the Notification shim goes in addInitScript: it must exist on every
  // navigation. localStorage is seeded per case with evaluate(), because an init
  // script would overwrite the state each case is trying to set up.
  await ctx.addInitScript(() => {
    window.__notes = []
    class FakeNotification {
      static permission = 'granted'
      static requestPermission() { return Promise.resolve('granted') }
      constructor(title, opts) { window.__notes.push({ title, body: (opts || {}).body }) }
    }
    window.Notification = FakeNotification
  })

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  let rows = []
  await page.route('**/api/watch', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ts: Date.now(), list: rows }) })
  )
  // Alerts only run during a live session.
  await page.route('**/api/market', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ts: Date.now(), status: '交易中', date: '2026-11-06', indices: [] }),
    })
  )

  await gotoWithRetry(page, SITE, { timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })

  /** Seed storage, then reload so the alert effect runs against it. */
  const seedAndReload = async ({ notify, alertState }) => {
    await page.evaluate(({ notify, alertState }) => {
      localStorage.setItem('fupan_notify', notify)
      localStorage.setItem('fupan_alert_state', JSON.stringify(alertState))
      window.__notes.length = 0
    }, { notify, alertState })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
    await page.waitForTimeout(2500)
    return page.evaluate(() => window.__notes || [])
  }

  // --- case 1: normal -> limitUp -------------------------------------
  rows = [row('002578', '闽发铝业', 'limitUp', 10.11, 5), row('600519', '贵州茅台', 'normal', 0.07)]
  let notes = await seedAndReload({
    notify: '1',
    alertState: { '002578': 'normal', '600519': 'normal' },
  })
  check('涨停跃迁触发通知', notes.length === 1, `${notes.length} 条`)
  check('标题含股票名与状态', /闽发铝业.*涨停/.test(notes[0]?.title || ''), notes[0]?.title || '(无)')
  check('正文含代码与连板', /002578/.test(notes[0]?.body || '') && /5连板/.test(notes[0]?.body || ''), notes[0]?.body || '')

  const st1 = await page.evaluate(() => JSON.parse(localStorage.getItem('fupan_alert_state') || '{}'))
  check('状态已写回', st1['002578'] === 'limitUp', JSON.stringify(st1))

  // --- case 2: same state again -> silent ------------------------------
  notes = await seedAndReload({
    notify: '1',
    alertState: { '002578': 'limitUp', '600519': 'normal' },
  })
  check('状态未变不重复通知', notes.length === 0, `${notes.length} 条`)

  // --- case 3: limitUp -> broken --------------------------------------
  rows = [row('600892', '大晟文化', 'broken', -3.2), row('600519', '贵州茅台', 'normal', 0.07)]
  notes = await seedAndReload({
    notify: '1',
    alertState: { '600892': 'limitUp', '600519': 'normal' },
  })
  check('炸板跃迁触发通知', notes.some((n) => /炸板/.test(n.title)), notes.map((n) => n.title).join(' / ') || '(无)')

  // --- case 4: toggle off -> silent -----------------------------------
  rows = [row('002578', '闽发铝业', 'limitUp', 10.11, 5)]
  notes = await seedAndReload({ notify: '0', alertState: { '002578': 'normal' } })
  check('关闭通知后静默', notes.length === 0, `${notes.length} 条`)

  // --- case 5: first run records state without alerting ---------------
  rows = [row('002578', '闽发铝业', 'limitUp', 10.11, 5)]
  notes = await seedAndReload({ notify: '1', alertState: {} })
  check('首次运行只记录不通知', notes.length === 0, `${notes.length} 条`)
  const st5 = await page.evaluate(() => JSON.parse(localStorage.getItem('fupan_alert_state') || '{}'))
  check('首次运行已记录状态', st5['002578'] === 'limitUp', JSON.stringify(st5))

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
