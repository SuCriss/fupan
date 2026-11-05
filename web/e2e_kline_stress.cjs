const { chromium } = require('playwright-core')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

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
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForSelector('.cards .card', { timeout: 120000 })
  await page.locator('.cards .card').first().click()
  await page.waitForSelector('.kl-svg', { timeout: 60000 })
  await page.waitForTimeout(500)

  const alive = async () => page.evaluate(() => ({
    drawer: !!document.querySelector('.drawer'),
    svg: !!document.querySelector('.kl-svg'),
    root: (document.querySelector('#root')?.children.length ?? 0) > 0,
    text: (document.body.innerText || '').trim().length,
  }))

  const box = await page.locator('.kl-svg').boundingBox()
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

  let firstBreak = null

  // Aggressive mixed interaction: hover at varying positions, wheel in/out,
  // press +/- and 重置, and switch periods in between.
  for (let i = 0; i < 60; i += 1) {
    const p = at(0.05 + ((i * 37) % 90) / 100, 0.3 + ((i * 13) % 40) / 100)
    await page.mouse.move(p.x, p.y)

    if (i % 3 === 0) await page.mouse.wheel(0, -120)
    if (i % 3 === 1) await page.mouse.wheel(0, 120)
    if (i % 7 === 0) await page.locator('.kl-zoom button', { hasText: '＋' }).click()
    if (i % 11 === 0) await page.locator('.kl-zoom button', { hasText: '－' }).click()
    if (i % 17 === 0) await page.locator('.kl-zoom button', { hasText: '重置' }).click()
    if (i % 19 === 0) {
      const periods = ['周线', '月线', '季线', '日线']
      await page.locator('.kl-tabs button', { hasText: periods[(i / 19) % 4 | 0] }).first().click()
    }
    await page.waitForTimeout(30)

    const s = await alive()
    if (!s.drawer || !s.svg || !s.root || s.text < 200) {
      firstBreak = { i: i + 1, ...s }
      break
    }
  }

  check('60 轮混合缩放/平移/切周期后页面存活', !firstBreak, firstBreak ? JSON.stringify(firstBreak) : '')
  const s = await alive()
  check('抽屉仍在', s.drawer)
  check('K 线仍在', s.svg)
  check('根节点未卸载', s.root)
  check('页面文本非空', s.text > 200, `${s.text} 字符`)
  check('无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  // Hover must still produce a tooltip after all that zooming.
  const p = at(0.5, 0.4)
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(250)
  const tip = await page.locator('.kl-tip').count()
  check('缩放后 hover 提示仍正常', tip === 1, `${tip} 个提示`)

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERR:', e.message); process.exit(2) })
