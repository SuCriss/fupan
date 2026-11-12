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
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) {
      errors.push('console: ' + m.text().slice(0, 120))
    }
  })

  await gotoWithRetry(page, SITE, { timeout: 90000 })

  // Wait for either data or the login screen so we can tell which state we got.
  await page.waitForFunction(
    () => document.querySelector('.kpis .kpi') || document.querySelector('.login-card'),
    { timeout: 90000 }
  )

  const state = await page.evaluate(() => {
    const txt = (sel) => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ').trim()
    return {
      login: !!document.querySelector('.login-card'),
      kpis: document.querySelectorAll('.kpis .kpi').length,
      kpiText: txt('.kpis'),
      stamp: txt('.stamp'),
      archiveBar: txt('.archive-bar'),
      empty: txt('main .empty'),
      leaders: document.querySelectorAll('.cards .card').length,
      bodyLen: (document.body.innerText || '').trim().length,
      loadingText: (document.body.innerText || '').includes('加载中'),
    }
  })

  console.log('登录页:', state.login)
  console.log('KPI 数:', state.kpis, '| 文案:', state.kpiText.slice(0, 80))
  console.log('时间戳:', state.stamp)
  console.log('提示条:', state.archiveBar || '(无)')
  console.log('龙头卡:', state.leaders)
  console.log('主区提示:', state.empty || '(无)')
  console.log('正文长度:', state.bodyLen)
  console.log('仍显示「加载中」:', state.loadingText)
  console.log('JS 错误:', errors.length ? errors.join(' | ') : '无')

  await page.screenshot({ path: 'now.png' })
  await browser.close()
})().catch((e) => { console.error('ERR:', e.message); process.exit(2) })
