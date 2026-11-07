const { chromium } = require('playwright-core')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

const log = (...a) => console.log(...a)
let failed = 0
const check = (name, ok, extra = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 120000 })

  const stamp = page.locator('.stamp')
  const text0 = (await stamp.textContent()).replace(/\s+/g, ' ').trim()
  check('时间戳含日期与更新时间', /\d{2}-\d{2}\s*\d{2}:\d{2}\s*更新/.test(text0), text0)
  check('时间戳含相对时间', /(刚刚更新|\d+ 分钟前|\d+\.\d 小时前)/.test(text0), text0)

  const cls = await stamp.getAttribute('class')
  check('新鲜度分级生效', /stamp (fresh|aging|stale)/.test(cls), cls)

  const dotColor = await page.locator('.stamp-dot').evaluate((el) => getComputedStyle(el).backgroundColor)
  check('分级圆点已着色', dotColor !== 'rgb(93, 107, 128)', dotColor)

  const title = await stamp.getAttribute('title')
  check('悬停提示含数据时间/日期/行情', /数据时间/.test(title) && /数据日期/.test(title) && /行情/.test(title), title)

  // Busy state: intercept the POST so no real build is started.
  await page.route('**/api/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, started: true, running: true, pending: false, last_started: Date.now() / 1000, last_finished: null, error: null }),
    })
  )
  await page.locator('.btn.primary').click()
  await page.waitForSelector('.stamp-busy', { timeout: 10000 })
  const busy = (await page.locator('.stamp-busy').textContent()).trim()
  const stillShowsTime = /\d{2}:\d{2}\s*更新/.test((await stamp.textContent()).replace(/\s+/g, ' '))
  check('刷新中角标出现', busy === '刷新中…', busy)
  check('刷新中仍保留上次更新时间', stillShowsTime)
  const busyCls = await stamp.getAttribute('class')
  check('刷新中圆点切换为忙碌态', busyCls.includes('busy'), busyCls)

  // Reload to abandon the intercepted flow, then prove the relative age ticks.
  await page.unroute('**/api/refresh')
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 120000 })
  const before = (await page.locator('.stamp').textContent()).replace(/\s+/g, ' ').trim()
  log(`  等待 70s 观察相对时间自增… (起始: ${before})`)
  await page.waitForTimeout(70000)
  const after = (await page.locator('.stamp').textContent()).replace(/\s+/g, ' ').trim()
  check('相对时间随 tick 更新', before !== after, `${before}  →  ${after}`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
