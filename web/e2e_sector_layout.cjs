const { chromium } = require('playwright-core')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

const log = (...a) => console.log(...a)
let failed = 0
const check = (name, ok, extra = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

async function layoutAudit(page, label) {
  const r = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - window.innerWidth
    const cards = [...document.querySelectorAll('.sec-card')]
    const bad = []
    for (const c of cards) {
      const cr = c.getBoundingClientRect()
      if (cr.height < 70) bad.push(`矮卡片 ${Math.round(cr.height)}px`)
      for (const el of c.querySelectorAll('*')) {
        const er = el.getBoundingClientRect()
        // Text escaping the card on the right is a real clipping symptom.
        if (er.right > cr.right + 1.5) {
          bad.push(`溢出 ${el.className || el.tagName}`)
          break
        }
      }
    }
    return {
      docOverflow,
      cards: cards.length,
      minHeight: cards.length ? Math.min(...cards.map((c) => c.getBoundingClientRect().height)) : 0,
      bad: bad.slice(0, 4),
    }
  })
  check(`${label}: 无横向滚动`, r.docOverflow <= 0, `overflow=${r.docOverflow}px`)
  check(`${label}: 卡片高度正常`, r.minHeight >= 70, `min=${Math.round(r.minHeight)}px`)
  check(`${label}: 卡片内无溢出`, r.bad.length === 0, r.bad.join('; '))
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  for (const vp of [
    { name: '桌面 1400', width: 1400, height: 1000 },
    { name: '移动 390', width: 390, height: 844 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForSelector('.cards .card', { timeout: 90000 })
    await page.locator('.tabs button', { hasText: '板块' }).first().click()
    await page.waitForSelector('.sec-grid .sec-card', { timeout: 60000 })
    log(`\n--- ${vp.name} ---`)
    await layoutAudit(page, vp.name)
    await page.screenshot({ path: `sector-${vp.width}.png` })
    await ctx.close()
  }

  await browser.close()
  log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message)
  process.exit(2)
})
