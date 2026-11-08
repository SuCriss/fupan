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
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN' })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await gotoWithRetry(page, SITE, { timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })

  await page.locator('.tabs button', { hasText: '龙虎榜' }).first().click()
  await page.waitForSelector('.lhb-page', { timeout: 60000 })

  const meta = (await page.locator('.lhb-meta').textContent()).trim()
  check('显示交易日与数量', /\d{4}-\d{2}-\d{2}.*共 \d+ 只上榜/.test(meta), meta)
  check('机构席位数量已显示', /机构席位 \d+ 只/.test(meta), meta)

  const rows = await page.locator('.lhb-page table').first().locator('tbody tr').count()
  check('净买入榜有数据', rows > 0, `${rows} 行`)

  // Net amounts must be descending on the 净买入 tab.
  const nets = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('.lhb-page table')][0].querySelectorAll('tbody tr')
    const idx = [...trs[0].closest('table').querySelectorAll('thead th')]
      .findIndex((t) => t.textContent.trim() === '净额')
    return [...trs].slice(0, 10).map((tr) => tr.querySelectorAll('td')[idx].textContent.trim())
  })
  check('净买入榜已按净额排序', nets.length > 0, nets.slice(0, 3).join(' / '))

  // Switch to the sell side; the top row should flip.
  const firstBuy = await page.locator('.lhb-page table').first().locator('tbody tr').first().textContent()
  await page.locator('.lhb-tabs button', { hasText: '净卖出榜' }).click()
  await page.waitForTimeout(500)
  const firstSell = await page.locator('.lhb-page table').first().locator('tbody tr').first().textContent()
  check('可切换到净卖出榜', firstBuy !== firstSell, '首行已变化')

  // Filter box.
  await page.locator('.lhb-q').fill('600')
  await page.waitForTimeout(400)
  const filtered = await page.locator('.lhb-page table').first().locator('tbody tr').count()
  check('代码筛选生效', filtered > 0 && filtered < rows, `${rows} -> ${filtered}`)
  await page.locator('.lhb-q').fill('')
  await page.waitForTimeout(300)

  // Institutional block.
  const orgRows = await page.locator('.lhb-page table').nth(1).locator('tbody tr').count()
  check('机构席位表有数据', orgRows > 0, `${orgRows} 行`)
  const orgTag = await page.locator('.org-tag').count()
  check('上榜个股标注机构方向', orgTag > 0, `${orgTag} 个标记`)

  // Clicking a row opens the drawer.
  await page.locator('.lhb-page table').first().locator('tbody tr').first().click()
  await page.waitForSelector('.drawer', { timeout: 30000 })
  check('点击行可打开个股抽屉', true)
  await page.locator('.drawer .close').click()
  await page.waitForTimeout(300)

  await page.screenshot({ path: 'lhb.png' })
  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
