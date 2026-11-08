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

  // --- CSV from a filtered table -------------------------------------
  await page.locator('.tabs button', { hasText: '涨停池' }).first().click()
  await page.waitForSelector('.tbl-tools', { timeout: 30000 })

  const totalRows = await page.locator('.tbl-tools .tbl-count').textContent()
  check('表格显示条数', /\d+ 只/.test(totalRows), totalRows.trim())

  // Filter down so the export must reflect the filtered view, not the raw pool.
  await page.locator('.toolbar .search').fill('00')
  await page.waitForTimeout(400)
  const filteredRows = await page.locator('.tbl-tools .tbl-count').textContent()
  const filteredN = Number((filteredRows.match(/(\d+) 只/) || [])[1] || 0)
  check('筛选后条数减少', filteredN > 0 && filteredN < Number((totalRows.match(/(\d+) 只/) || [])[1]), `${totalRows.trim()} -> ${filteredRows.trim()}`)

  const [csvDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('.tbl-tools .btn', { hasText: '导出 CSV' }).click(),
  ])
  const csvPath = await csvDl.path()
  const raw = fs.readFileSync(csvPath)
  const text = raw.toString('utf8')
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean)

  check('CSV 文件名含日期', /涨停池-\d{4}-\d{2}-\d{2}\.csv/.test(csvDl.suggestedFilename()), csvDl.suggestedFilename())
  check('CSV 含 UTF-8 BOM（Excel 中文不乱码）', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
  check('CSV 表头正确', lines[0].startsWith('代码,名称,现价,涨幅%'), lines[0].slice(0, 40))
  check('CSV 行数与筛选一致', lines.length - 1 === filteredN, `${lines.length - 1} 行 / 界面 ${filteredN} 只`)
  check('CSV 首行含六位代码', /^\d{6},/.test(lines[1] || ''), (lines[1] || '').slice(0, 30))

  await page.locator('.toolbar .search').fill('')
  await page.waitForTimeout(300)

  // --- PNG summary card ----------------------------------------------
  const [pngDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('.toolbar .btn', { hasText: '导出图片' }).click(),
  ])
  const pngPath = await pngDl.path()
  const png = fs.readFileSync(pngPath)

  const isPng = png[0] === 0x89 && png.toString('ascii', 1, 4) === 'PNG'
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  check('PNG 文件名含日期', /复盘-\d{4}-\d{2}-\d{2}\.png/.test(pngDl.suggestedFilename()), pngDl.suggestedFilename())
  check('导出的确是 PNG', isPng, `${png.length} bytes`)
  check('PNG 尺寸为 2400x1640（2x 高清）', w === 2400 && h === 1640, `${w}x${h}`)
  check('PNG 体积合理（非空白图）', png.length > 20000, `${Math.round(png.length / 1024)} KB`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
