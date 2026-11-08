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

  // Clean slate for today's date.
  const day = (await page.locator('.kpi .s').first().textContent()).trim()
  await page.evaluate(async (d) => {
    await fetch('/api/note', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: d, content: '' }),
    })
  }, day)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })

  // --- box present and collapsed -------------------------------------
  const box = page.locator('.notebox')
  await box.waitFor({ timeout: 30000 })
  check('笔记区块存在', (await box.count()) === 1)
  check('默认折叠', (await page.locator('.nb-body').count()) === 0)

  const meta0 = (await page.locator('.nb-meta').textContent()).trim()
  check('空笔记显示未填写', meta0.includes('未填写'), meta0)

  // --- expand --------------------------------------------------------
  await page.locator('.nb-head').click()
  await page.waitForSelector('.nb-input', { timeout: 15000 })
  check('展开后出现输入框', true)
  check('输入框带日期说明', /记录 \d{4}-\d{2}-\d{2}/.test(await page.locator('.nb-input').getAttribute('placeholder') || ''))

  // --- type -> autosave ----------------------------------------------
  const TEXT = 'e2e 笔记：开盘一字板集中，情绪偏热。'
  await page.locator('.nb-input').click()
  // 80ms between keys: at 15ms Chromium coalesces keystrokes and drops
  // characters, which no human typing speed reproduces. fill() is unusable here
  // because React's controlled input overwrites the DOM value with its own state.
  await page.keyboard.type(TEXT, { delay: 80 })
  // 1.2s debounce + request; wait for the saved marker.
  await page.waitForFunction(
    () => (document.querySelector('.nb-meta')?.textContent || '').includes('已保存'),
    { timeout: 20000 }
  )
  const meta1 = (await page.locator('.nb-meta').textContent()).trim()
  check('输入后自动保存', meta1.includes('已保存'), meta1)
  check('显示字数', /\d+ 字/.test(meta1), meta1)

  // --- persisted across reload ---------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  await page.waitForTimeout(800)
  const meta2 = (await page.locator('.nb-meta').textContent()).trim()
  check('刷新后仍显示字数', /\d+ 字/.test(meta2), meta2)

  await page.locator('.nb-head').click()
  await page.waitForSelector('.nb-input', { timeout: 15000 })
  const val = await page.locator('.nb-input').inputValue()
  check('刷新后内容保留', val === TEXT, val.slice(0, 30))

  // --- server actually holds it --------------------------------------
  const server = await page.evaluate(async (d) => {
    const r = await fetch(`/api/note?date=${d}`)
    return r.json()
  }, day)
  check('服务端已持久化', server.content === TEXT, `${server.content?.length || 0} 字`)

  // --- clearing deletes ----------------------------------------------
  await page.locator('.nb-input').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  await page.locator('.nb-foot .btn').click()
  await page.waitForTimeout(1500)
  const server2 = await page.evaluate(async (d) => {
    const r = await fetch(`/api/note?date=${d}`)
    return r.json()
  }, day)
  check('清空后服务端已删除', server2.content === '', `"${server2.content}"`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
