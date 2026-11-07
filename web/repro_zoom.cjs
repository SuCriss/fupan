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

  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)) })

  await gotoWithRetry(page, URL, { timeout: 120000 })
  await page.waitForSelector('.cards .card', { timeout: 120000 })
  await page.locator('.cards .card').first().click()
  await page.waitForSelector('.kl-svg', { timeout: 60000 })
  await page.waitForTimeout(600)

  const state = async () => page.evaluate(() => ({
    drawer: !!document.querySelector('.drawer'),
    svg: !!document.querySelector('.kl-svg'),
    rootChildren: document.querySelector('#root')?.children.length ?? -1,
    bodyText: (document.body.innerText || '').trim().length,
    zoomTxt: (document.querySelector('.kl-zoom-txt')?.textContent || '').trim(),
  }))

  console.log('初始:', JSON.stringify(await state()))

  // Hover a bar first — this is what makes a stale hover index possible.
  const box = await page.locator('.kl-svg').boundingBox()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4)
  await page.waitForTimeout(200)
  const hovered = await page.locator('.kl-tip, .kl-hover').count()
  console.log('hover 后提示节点数:', hovered)

  // 1) Zoom IN with the ＋ button (does not reset hover).
  for (let i = 0; i < 15; i += 1) {
    await page.locator('.kl-zoom button', { hasText: '＋' }).click()
    await page.waitForTimeout(60)
    const s = await state()
    if (!s.drawer || s.rootChildren <= 0) {
      console.log(`❌ 第 ${i + 1} 次点「＋」后崩溃:`, JSON.stringify(s))
      break
    }
  }
  console.log('＋×15 后:', JSON.stringify(await state()))

  // 2) Wheel zoom in/out hard.
  for (let i = 0; i < 30; i += 1) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4)
    await page.mouse.wheel(0, i % 2 ? 120 : -120)
    await page.waitForTimeout(25)
    const s = await state()
    if (!s.drawer || s.rootChildren <= 0) {
      console.log(`❌ 第 ${i + 1} 次滚轮后崩溃:`, JSON.stringify(s))
      break
    }
  }
  console.log('滚轮×30 后:', JSON.stringify(await state()))

  // 3) Pan while zoomed.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4)
  await page.mouse.down()
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.move(box.x + box.width * 0.5 - i * 15, box.y + box.height * 0.4)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  console.log('拖动后:', JSON.stringify(await state()))

  console.log('\n=== 捕获的错误 ===')
  if (!errors.length) console.log('  无')
  else errors.slice(0, 6).forEach((e) => console.log('  ' + e))

  await browser.close()
})().catch((e) => { console.error('SCRIPT ERR:', e.message); process.exit(2) })
