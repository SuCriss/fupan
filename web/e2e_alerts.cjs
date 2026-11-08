const { chromium } = require('playwright-core')
const { gotoWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const SITE = 'https://fupan.chrisite.eu.cc/'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

// A watchlist row as the server returns it, with the fields the alert path reads.
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

  // Capture notifications instead of showing them, and pre-grant permission.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
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

  // --- case 1: transition normal -> limitUp must alert -----------------
  let rows = [row('002578', '闽发铝业', 'limitUp', 10.11, 5), row('600519', '贵州茅台', 'normal', 0.07)]
  await page.route('**/api/watch', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ts: Date.now(), list: rows }) })
  )
  // Seed the "previous" state so this load looks like a real transition.
  await ctx.addInitScript(() => {
    localStorage.setItem('fupan_notify', '1')
    localStorage.setItem('fupan_alert_state', JSON.stringify({ '002578': 'normal', '600519': 'normal' }))
    // Alerts only run during a live session; force the market status.
    window.__forceSession = true
  })
  await page.route('**/api/market', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ts: Date.now(), status: '交易中', date: '2026-11-06', indices: [] }),
    })
  )

  await gotoWithRetry(page, SITE, { timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  await page.waitForTimeout(2500)

  const notes1 = await page.evaluate(() => window.__notes || [])
  check('涨停跃迁触发通知', notes1.length === 1, `${notes1.length} 条`)
  check('通知标题含股票名与状态', /闽发铝业.*涨停/.test(notes1[0]?.title || ''), notes1[0]?.title || '(无)')
  check('通知正文含代码与连板', /002578/.test(notes1[0]?.body || '') && /5连板/.test(notes1[0]?.body || ''), notes1[0]?.body || '')

  const state1 = await page.evaluate(() => JSON.parse(localStorage.getItem('fupan_alert_state') || '{}'))
  check('状态已更新为持久化值', state1['002578'] === 'limitUp', JSON.stringify(state1))

  // --- case 2: no repeat alert when the state is unchanged -------------
  await page.evaluate(() => { window.__notes.length = 0 })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  await page.waitForTimeout(2500)
  const notes2 = await page.evaluate(() => window.__notes || [])
  check('状态未变不重复通知', notes2.length === 0, `${notes2.length} 条`)

  // --- case 3: 炸板 transition also alerts ----------------------------
  rows = [row('600892', '大晟文化', 'broken', -3.2), row('600519', '贵州茅台', 'normal', 0.07)]
  await page.evaluate(() => {
    localStorage.setItem('fupan_alert_state', JSON.stringify({ '600892': 'limitUp', '600519': 'normal' }))
    window.__notes.length = 0
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  await page.waitForTimeout(2500)
  const notes3 = await page.evaluate(() => window.__notes || [])
  check('炸板跃迁触发通知', notes3.some((n) => /炸板/.test(n.title)), notes3.map((n) => n.title).join(' / ') || '(无)')

  // --- case 4: alerts stay silent without the notification toggle -----
  await page.evaluate(() => {
    localStorage.setItem('fupan_notify', '0')
    localStorage.setItem('fupan_alert_state', JSON.stringify({ '002578': 'normal' }))
    window.__notes.length = 0
  })
  rows = [row('002578', '闽发铝业', 'limitUp', 10.11, 5)]
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  await page.waitForTimeout(2500)
  const notes4 = await page.evaluate(() => window.__notes || [])
  check('关闭通知后不再提醒', notes4.length === 0, `${notes4.length} 条`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
