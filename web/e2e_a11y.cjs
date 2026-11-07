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

  // --- tab bar -------------------------------------------------------
  const tabs = await page.evaluate(() => ({
    list: !!document.querySelector('[role="tablist"]'),
    count: document.querySelectorAll('[role="tab"]').length,
    selected: document.querySelectorAll('[role="tab"][aria-selected="true"]').length,
  }))
  check('标签栏 role=tablist', tabs.list)
  check('每个标签 role=tab', tabs.count >= 10, `${tabs.count} 个`)
  check('恰有一个 aria-selected=true', tabs.selected === 1, `${tabs.selected} 个`)

  // --- table headers -------------------------------------------------
  await page.locator('.tabs button', { hasText: '涨停池' }).first().click()
  await page.waitForTimeout(400)
  const th = await page.evaluate(() => {
    const all = [...document.querySelectorAll('main table thead th')]
    return { total: all.length, scoped: all.filter((t) => t.getAttribute('scope') === 'col').length }
  })
  check('表头全部带 scope=col', th.total > 0 && th.total === th.scoped, `${th.scoped}/${th.total}`)

  // --- drawer dialog semantics ---------------------------------------
  await page.locator('.tabs button', { hasText: '龙头榜' }).first().click()
  await page.waitForSelector('.cards .card', { timeout: 30000 })
  await page.locator('.cards .card').first().click()
  await page.waitForSelector('.drawer', { timeout: 30000 })

  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    const id = d && d.getAttribute('aria-labelledby')
    return {
      dialog: !!d,
      modal: d && d.getAttribute('aria-modal'),
      labelledby: id,
      labelResolves: !!(id && document.getElementById(id)),
      closeLabel: document.querySelector('.drawer .close')?.getAttribute('aria-label') || '',
      maskHidden: document.querySelector('.mask')?.getAttribute('aria-hidden'),
    }
  })
  check('抽屉 role=dialog', dlg.dialog)
  check('抽屉 aria-modal=true', dlg.modal === 'true')
  check('aria-labelledby 指向存在的标题', dlg.labelResolves, dlg.labelledby || '(空)')
  check('关闭按钮有 aria-label', dlg.closeLabel.length > 0, dlg.closeLabel)
  check('遮罩 aria-hidden', dlg.maskHidden === 'true')

  // Escape must still close the dialog.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('Esc 可关闭抽屉', (await page.locator('.drawer').count()) === 0)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
