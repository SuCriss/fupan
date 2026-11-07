const { chromium } = require('playwright-core')
const { gotoWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const SITE = 'https://fupan.chrisite.eu.cc/'

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })).newPage()

  let bucket = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/')) bucket.push(u.pathname)
  })

  const report = (label) => {
    const counts = bucket.reduce((m, p) => ((m[p] = (m[p] || 0) + 1), m), {})
    const total = bucket.length
    const detail = Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p}×${n}`).join('  ')
    console.log(`\n[${label}] 共 ${total} 次: ${detail || '无'}`)
    bucket = []
    return { total, counts }
  }

  await gotoWithRetry(page, SITE, { timeout: 120000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 120000 })
  const load = report('首次加载')

  // Typing in the global search: 8 keystrokes in quick succession.
  const search = page.locator('.search-inp')
  await search.click()
  for (const ch of '60051900') {
    await search.type(ch, { delay: 30 })
  }
  await page.waitForTimeout(1200)
  report('搜索框连打 8 个字符')

  // Tab switching: each tab is client-side, should be zero requests.
  for (const t of ['涨停池', '连板池', '炸板池', '龙头榜', '板块']) {
    await page.locator('.tabs button', { hasText: t }).first().click()
    await page.waitForTimeout(150)
  }
  report('连切 5 个标签页')

  // Rapid date changes through the picker.
  const dateInput = page.locator('.datenav input[type="date"]')
  for (const d of ['2026-11-04', '2026-11-03', '2026-11-04']) {
    await dateInput.fill(d)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1500)
  report('快速切换日期 3 次')

  // Open a stock drawer.
  await page.locator('.tabs button', { hasText: '龙头榜' }).first().click()
  await page.waitForSelector('.cards .card', { timeout: 30000 })
  await page.locator('.cards .card').first().click()
  await page.waitForSelector('.kl-svg', { timeout: 60000 })
  await page.waitForTimeout(1500)
  report('打开个股抽屉')

  // Click the star rapidly (watch toggle).
  const star = page.locator('.drawer-head .star')
  for (let i = 0; i < 6; i += 1) {
    await star.click({ force: true }).catch(() => {})
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(1500)
  report('连点自选星标 6 次')

  // Rapid refresh-button clicks.
  await page.locator('.drawer .close').click().catch(() => {})
  await page.waitForTimeout(300)
  const btn = page.locator('.btn.primary')
  for (let i = 0; i < 5; i += 1) {
    await btn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(80)
  }
  await page.waitForTimeout(2500)
  report('连点刷新按钮 5 次')

  console.log('\n(首次加载明细)')
  console.log('  ' + Object.entries(load.counts).map(([p, n]) => `${p}×${n}`).join('  '))

  await browser.close()
})().catch((e) => { console.error('ERR:', e.message); process.exit(2) })
