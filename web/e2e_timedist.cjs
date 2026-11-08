const { chromium } = require('playwright-core')
const { gotoWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const SITE = 'https://fupan.chrisite.eu.cc/'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await gotoWithRetry(page, SITE, { timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })

  await page.locator('.tabs button', { hasText: '涨停池' }).first().click()
  await page.waitForSelector('.timedist', { timeout: 30000 })

  // --- distribution chart -------------------------------------------
  const chart = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.timedist .td-col')]
    const labels = [...document.querySelectorAll('.timedist .td-x')].map((e) => e.textContent.trim())
    const nums = cols.map((c) => Number(c.querySelector('.td-n')?.textContent || 0))
    return {
      cols: cols.length,
      labels,
      nums,
      total: nums.reduce((a, b) => a + b, 0),
      aria: document.querySelector('.td-bars')?.getAttribute('aria-label') || '',
      head: document.querySelector('.td-sub')?.textContent.replace(/\s+/g, ' ').trim() || '',
    }
  })
  check('时间分布渲染 9 个时段', chart.cols === 9, `${chart.cols} 个`)
  check('横轴标签完整', chart.labels.length === 9 && chart.labels[0] === '9:25', chart.labels.join(' '))
  check('有涨停计入分桶', chart.total > 0, `合计 ${chart.total} 家`)
  check('含竞价/开盘/尾盘摘要', /竞价 \d+/.test(chart.head) && /尾盘30分 \d+/.test(chart.head), chart.head)
  check('图表有无障碍描述', chart.aria.length > 10, chart.aria.slice(0, 50))

  // --- enriched table columns ---------------------------------------
  const cols = await page.evaluate(() =>
    [...document.querySelectorAll('main table thead th')].map((t) => t.textContent.replace(/[↑↓]/g, '').trim())
  )
  for (const name of ['首封', '区间涨停', '炸板']) {
    check(`表格含「${name}」列`, cols.includes(name), cols.join('/'))
  }

  const row = await page.evaluate(() => {
    const tr = document.querySelector('main table tbody tr')
    if (!tr) return null
    const cells = [...tr.querySelectorAll('td')].map((t) => t.textContent.trim())
    const idx = [...document.querySelectorAll('main table thead th')]
      .findIndex((t) => t.textContent.includes('首封'))
    return { cells, firstTime: idx >= 0 ? cells[idx] : null }
  })
  check('首行首封时间已填充', !!row && /^\d{2}:\d{2}:\d{2}$/.test(row.firstTime || ''), row?.firstTime || '(空)')

  await page.screenshot({ path: 'timedist.png' })
  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
