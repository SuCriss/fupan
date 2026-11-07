const path = require('path')
const { chromium } = require('playwright-core')
const { gotoWithRetry, reloadWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

const log = (...a) => console.log(...a)
let failed = 0
function check(name, ok, extra = '') {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await gotoWithRetry(page, URL, { timeout: 90000 })

  // Data must have loaded (KPI grid appears once /api/all resolves).
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  const kpiCount = await page.locator('.kpis .kpi').count()
  check('数据加载完成', kpiCount > 0, `${kpiCount} 个 KPI`)

  // Sentiment panel from feature #4.
  const senti = await page.locator('.sentiment .se-score').first().textContent().catch(() => null)
  check('情绪温度计渲染', !!senti && /^\d/.test(senti.trim()), `分数 ${senti}`)

  // --- auto refresh control -------------------------------------------
  const box = page.locator('.autoref')
  await box.waitFor({ timeout: 15000 })
  check('自动刷新控件存在', (await box.count()) === 1)

  const hint0 = (await page.locator('.ar-hint').textContent()).trim()
  const on0 = await box.evaluate((el) => el.classList.contains('on'))
  check('默认关闭', !on0 && hint0 === '已关闭', `hint="${hint0}"`)

  // Turn it on.
  await page.locator('.ar-switch').click()
  await page.waitForTimeout(400)
  const on1 = await box.evaluate((el) => el.classList.contains('on'))
  const hint1 = (await page.locator('.ar-hint').textContent()).trim()
  const pressed = await page.locator('.ar-switch').getAttribute('aria-pressed')
  check('点击后开启', on1 && pressed === 'true', `aria-pressed=${pressed}`)
  // In session the hint counts down; outside it the hint must explain the pause.
  check(
    '提示随交易时段变化',
    /下次 \d{2}:\d{2}/.test(hint1) || /(交易中|集合竞价|午间休市|已收盘|休市|等待行情状态)/.test(hint1),
    `hint="${hint1}"`,
  )

  const ls1 = await page.evaluate(() => localStorage.getItem('fupan_auto'))
  check('偏好已持久化', ls1 === '1', `fupan_auto=${ls1}`)

  // Interval select.
  await page.locator('.ar-sel').selectOption('15')
  await page.waitForTimeout(300)
  const lsMin = await page.evaluate(() => localStorage.getItem('fupan_auto_min'))
  check('间隔可改并持久化', lsMin === '15', `fupan_auto_min=${lsMin}`)

  // Reload keeps the preference.
  await reloadWithRetry(page, { timeout: 90000 })
  await page.waitForSelector('.autoref', { timeout: 30000 })
  const on2 = await page.locator('.autoref').evaluate((el) => el.classList.contains('on'))
  const sel2 = await page.locator('.ar-sel').inputValue()
  check('刷新后保持开启', on2, '')
  check('刷新后保持间隔', sel2 === '15', `select=${sel2}`)

  // The backend session state drives the gate; any of the five states is valid
  // depending on when the suite runs.
  const market = await page.evaluate(async () => {
    const r = await fetch('/api/market')
    return r.json()
  })
  const VALID = ['交易中', '集合竞价', '午间休市', '已收盘', '休市']
  check('后端行情状态合法', VALID.includes(market.status), `status=${market.status}`)

  await page.screenshot({ path: 'auto-refresh.png', fullPage: false })

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message)
  process.exit(2)
})
