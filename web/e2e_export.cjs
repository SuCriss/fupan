const fs = require('fs')
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
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    locale: 'zh-CN',
    acceptDownloads: true,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await gotoWithRetry(page, SITE, { timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })

  await page.locator('.tabs button', { hasText: '涨停池' }).first().click()
  await page.waitForSelector('.tbl-tools', { timeout: 30000 })

  const totalRows = await page.locator('.tbl-tools .tbl-count').textContent()
  check('表格显示条数', /\d+ 只/.test(totalRows), totalRows.trim())

  // Filter down so the export must reflect the filtered view, not the raw pool.
  await page.locator('.toolbar .search').fill('00')
  await page.waitForTimeout(400)
  const filteredRows = await page.locator('.tbl-tools .tbl-count').textContent()
  const totalN = Number((totalRows.match(/(\d+) 只/) || [])[1] || 0)
  const filteredN = Number((filteredRows.match(/(\d+) 只/) || [])[1] || 0)
  check('筛选后条数减少', filteredN > 0 && filteredN < totalN, `${totalN} -> ${filteredN}`)

  const [csvDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('.tbl-tools .btn', { hasText: '导出 CSV' }).click(),
  ])
  const raw = fs.readFileSync(await csvDl.path())
  const text = raw.toString('utf8')
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean)

  check('CSV 文件名含日期', /涨停池-\d{4}-\d{2}-\d{2}\.csv/.test(csvDl.suggestedFilename()), csvDl.suggestedFilename())
  check('CSV 含 UTF-8 BOM（Excel 中文不乱码）', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
  check('CSV 表头正确', lines[0].startsWith('代码,名称,现价,涨幅%'), lines[0].slice(0, 40))
  check('CSV 行数与筛选一致', lines.length - 1 === filteredN, `${lines.length - 1} 行 / 界面 ${filteredN} 只`)
  check('CSV 首行含六位代码', /^\d{6},/.test(lines[1] || ''), (lines[1] || '').slice(0, 30))

  // The image export was removed; the toolbar must no longer offer it.
  const imgBtn = await page.locator('.toolbar .btn', { hasText: '导出图片' }).count()
  check('导出图片按钮已移除', imgBtn === 0, `${imgBtn} 个`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
