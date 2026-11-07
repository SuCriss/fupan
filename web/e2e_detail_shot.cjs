const { chromium } = require('playwright-core')
const { gotoWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })
  const page = await ctx.newPage()

  await gotoWithRetry(page, URL, { timeout: 90000 })
  await page.waitForSelector('.cards .card', { timeout: 90000 })
  await page.locator('.cards .card').first().click()
  await page.waitForSelector('.drawer .sec-t', { timeout: 60000 })
  await page.waitForTimeout(2500)

  // Scroll the drawer so the new panels sit in view.
  await page.evaluate(() => {
    const body = document.querySelector('.drawer-body')
    const target = [...document.querySelectorAll('.drawer .sec-t')]
      .find((el) => el.textContent.includes('涨停记录'))
    if (body && target) body.scrollTop = target.offsetTop - 8
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'drawer-panels.png' })

  const texts = await page.evaluate(() => {
    const pick = (label) => {
      const heads = [...document.querySelectorAll('.drawer .sec-t')]
      const h = heads.find((el) => el.textContent.includes(label))
      if (!h) return null
      const out = [h.textContent.trim()]
      let n = h.nextElementSibling
      let guard = 0
      while (n && !n.classList.contains('sec-t') && guard < 6) {
        out.push(n.innerText.replace(/\n+/g, ' | '))
        n = n.nextElementSibling
        guard += 1
      }
      return out.join('\n')
    }
    return {
      limit: pick('涨停记录'),
      flow: pick('主力资金'),
      lhb: pick('龙虎榜'),
    }
  })
  console.log('=== 涨停记录 ===\n' + texts.limit)
  console.log('\n=== 主力资金 ===\n' + texts.flow)
  console.log('\n=== 龙虎榜 ===\n' + texts.lhb)

  await browser.close()
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message)
  process.exit(2)
})
