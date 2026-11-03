/** End-to-end functional audit: every tab, table sorting, and the detail drawer. */
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })

const problems = []
page.on('pageerror', (e) => problems.push('PAGEERROR: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) problems.push('CONSOLE: ' + m.text())
})

await page.goto('http://127.0.0.1:8000/', { waitUntil: 'load', timeout: 30000 })
await page.waitForSelector('.card', { timeout: 90000 })
await page.waitForTimeout(800)

const tabs = ['龙头榜', '涨停池', '连板池', '炸板池', '跌停池', '连板天梯', '热股榜', '昨日对比', '回撤榜']
const report = {}

for (const label of tabs) {
  await page.locator('.tabs button', { hasText: label }).first().click()
  await page.waitForTimeout(600)
  report[label] = await page.evaluate(() => {
    const v = document.querySelector('.view')
    return {
      cards: v.querySelectorAll('.card').length,
      tableRows: v.querySelectorAll('tbody tr').length,
      rungs: v.querySelectorAll('.rung').length,
      hotRows: v.querySelectorAll('.hotrow').length,
      empty: v.querySelector('.empty')?.textContent?.trim() || null,
      firstText: (v.textContent || '').trim().slice(0, 110),
    }
  })
}

// Sorting check on the limit-up table.
await page.locator('.tabs button', { hasText: '涨停池' }).first().click()
await page.waitForTimeout(500)
await page.locator('.view thead th', { hasText: '涨幅' }).first().click()
await page.waitForTimeout(500)
report.sortCheck = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.view tbody tr')]
  return rows.slice(0, 4).map((r) => [...r.querySelectorAll('td')].map((t) => t.textContent.trim()).join(' | '))
})

// Detail drawer.
await page.locator('.tabs button', { hasText: '龙头榜' }).first().click()
await page.waitForTimeout(500)
await page.locator('.card').first().click()
await page.waitForSelector('.drawer', { timeout: 10000 })
await page.waitForTimeout(7000)
report.drawer = await page.evaluate(() => {
  const d = document.querySelector('.drawer')
  return {
    title: d.querySelector('h2')?.textContent?.trim(),
    subtitle: d.querySelector('.drawer-head p')?.textContent?.trim(),
    hasMinuteSvg: !!d.querySelector('svg polyline'),
    hasKlineSvg: !!d.querySelector('svg rect'),
    kvRows: d.querySelectorAll('.kv .row').length,
    bars: d.querySelectorAll('.bar i').length,
    tableRows: d.querySelectorAll('tbody tr').length,
    bodyText: (d.textContent || '').trim().slice(0, 220),
  }
})

// Switch to daily K-line inside the drawer.
const kBtn = page.locator('.drawer button', { hasText: '日K' })
if (await kBtn.count()) {
  await kBtn.first().click()
  await page.waitForTimeout(1200)
  report.drawerKline = await page.evaluate(() => {
    const d = document.querySelector('.drawer')
    return { svgRects: d.querySelectorAll('svg rect').length }
  })
}

// Close with Escape.
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
report.drawerClosedByEscape = (await page.locator('.drawer').count()) === 0

// Search filter.
await page.locator('.search').fill('电力')
await page.waitForTimeout(600)
await page.locator('.tabs button', { hasText: '涨停池' }).first().click()
await page.waitForTimeout(500)
report.search = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.view tbody tr')]
  return { rows: rows.length, sample: rows.slice(0, 3).map((r) => r.textContent.trim().slice(0, 40)) }
})

console.log(JSON.stringify({ report, problems }, null, 2))
await browser.close()
