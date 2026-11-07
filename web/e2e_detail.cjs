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

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.cards .card', { timeout: 90000 })
  check('龙头卡片渲染', (await page.locator('.cards .card').count()) > 0)

  // Open the top-ranked stock's drawer.
  const firstCode = await page.locator('.cards .card .nm span').first().textContent()
  await page.locator('.cards .card').first().click()
  await page.waitForSelector('.drawer', { timeout: 30000 })
  await page.waitForSelector('.drawer .sec-t', { timeout: 60000 })
  log(`抽屉已打开: ${firstCode}`)

  const sections = await page.locator('.drawer .sec-t').allTextContents()
  const has = (kw) => sections.some((s) => s.includes(kw))
  check('涨停记录区块', has('涨停记录'), sections.join(' | '))
  check('主力资金区块', has('主力资金'))
  check('龙虎榜区块', has('龙虎榜'))

  // Limit-up track record numbers.
  const limitVals = await page.locator('.drawer .mgrid .v').allTextContents()
  check('涨停记录含晋级率', limitVals.some((v) => v.includes('%')), limitVals.slice(0, 8).join(' / '))

  // Money flow numbers are signed 亿/万.
  const flowMain = await page.locator('.drawer .flow-main .fl-v').first().textContent()
  check('主力净额已格式化', /^[+-]?[\d.]+[亿万]?$/.test((flowMain || '').trim()), `main="${flowMain}"`)
  const flowRows = await page.locator('.drawer .flow-row').count()
  check('四档资金流渲染', flowRows === 4, `${flowRows} 行`)
  const histRows = await page.locator('.drawer .fh-row').count()
  check('资金流历史柱渲染', histRows > 0, `${histRows} 天`)

  // Dragon-tiger entries carry a reason line.
  const lhbItems = await page.locator('.drawer .lhb-item').count()
  const lhbReason = await page.locator('.drawer .lhb-reason').first().textContent().catch(() => '')
  check('龙虎榜条目渲染', lhbItems > 0, `${lhbItems} 条`)
  check('龙虎榜含上榜原因', (lhbReason || '').length > 4, lhbReason)

  await page.screenshot({ path: 'drawer-enhance.png' })

  // Concept chip -> closes drawer, filters the limit-up pool.
  const chip = page.locator('.drawer .concept-chip').first()
  const chipName = (await chip.textContent()).trim()
  await chip.click()
  await page.waitForTimeout(700)
  const drawerGone = (await page.locator('.drawer').count()) === 0
  check('点击概念后抽屉关闭', drawerGone, `concept="${chipName}"`)

  const queryVal = await page.locator('.toolbar .search').inputValue()
  check('概念联动填入筛选词', queryVal === chipName, `query="${queryVal}"`)

  const activeTab = (await page.locator('.tabs button.on').textContent()) || ''
  check('联动切到涨停池', activeTab.trim() === '涨停池', `tab="${activeTab.trim()}"`)

  const rows = await page.locator('main .tbl-wrap tbody tr').count()
  check('筛选后有结果', rows > 0, `${rows} 行`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message)
  process.exit(2)
})
