const { chromium } = require('playwright-core')
const { gotoWithRetry, reloadWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const ORIGIN = 'https://fupan.chrisite.eu.cc'

const log = (...a) => console.log(...a)
let failed = 0
const check = (name, ok, extra = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

async function status() {
  const r = await fetch(`${ORIGIN}/api/refresh/status`)
  return r.json()
}

;(async () => {
  const before = await status()
  log(`基线 last_started=${before.last_started} running=${before.running}`)

  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()

  // Seed a 1-minute interval (the UI offers 5/10/15/30; state honours any number).
  await gotoWithRetry(page, `${ORIGIN}/`, { timeout: 90000 })
  await page.evaluate(() => {
    localStorage.setItem('fupan_auto', '1')
    localStorage.setItem('fupan_auto_min', '1')
  })
  await reloadWithRetry(page, { timeout: 90000 })
  await page.waitForSelector('.autoref.on', { timeout: 30000 })
  const hint = (await page.locator('.ar-hint').textContent()).trim()
  check('1 分钟间隔生效', /下次 \d{2}:\d{2}/.test(hint), `hint="${hint}"`)

  // The interval should fire on its own; watch the server for a new build.
  let fired = false
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000)
    const s = await status()
    if (s.last_started && s.last_started !== before.last_started) {
      fired = true
      log(`定时器触发构建: last_started=${s.last_started} running=${s.running}`)
      break
    }
  }
  check('自动刷新确实触发后端构建', fired)

  // The UI must keep showing data while the silent refresh runs.
  const kpis = await page.locator('.kpis .kpi').count()
  check('刷新期间数据仍在展示', kpis > 0, `${kpis} 个 KPI`)
  const stamp = (await page.locator('.stamp').textContent()).trim()
  check('角标反映刷新状态', stamp.length > 0, `stamp="${stamp}"`)

  await browser.close()
  log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message)
  process.exit(2)
})
