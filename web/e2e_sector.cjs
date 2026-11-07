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

  // Switch to the sector board.
  await page.locator('.tabs button', { hasText: '板块' }).first().click()
  await page.waitForSelector('.sec-grid .sec-card', { timeout: 60000 })

  const cards = await page.locator('.sec-grid .sec-card').count()
  check('板块热度榜渲染', cards > 0, `${cards} 张卡片`)

  const firstName = (await page.locator('.sec-card .sc-head b').first().textContent()).trim()
  const firstHeat = (await page.locator('.sec-card .sc-heat').first().textContent()).trim()
  check('卡片含名称与热度', firstName.length > 0 && /^\d/.test(firstHeat), `${firstName} 热度=${firstHeat}`)

  const metas = await page.locator('.sec-card').first().locator('.sc-meta span').allTextContents()
  check('卡片含家数/最高板/连板', metas.length >= 4, metas.join(' | '))

  const ladderTags = await page.locator('.sec-card').first().locator('.sc-ladder span').allTextContents()
  check('卡片含梯队摘要', ladderTags.length > 0, ladderTags.join(' '))

  // Heat must be descending (ranked board).
  const heats = (await page.locator('.sec-card .sc-heat').allTextContents()).map(Number)
  const sorted = heats.every((v, i) => i === 0 || heats[i - 1] >= v)
  check('热度按降序排列', sorted, heats.slice(0, 6).join(' > '))

  await page.screenshot({ path: 'sector-grid.png' })

  // Open the first dossier.
  await page.locator('.sec-grid .sec-card').first().click()
  await page.waitForSelector('.sec-detail', { timeout: 30000 })
  const title = (await page.locator('.sd-head h3').textContent()).trim()
  check('进入板块详情', title === firstName, `detail="${title}"`)

  const statLabels = await page.locator('.sd-stats .k').allTextContents()
  check('详情指标齐全', ['涨停家数', '最高板', '连板家数', '平均涨幅', '封单合计'].every((k) => statLabels.includes(k)), statLabels.join(' | '))

  const leaders = await page.locator('.sd-leader').count()
  const ranks = await page.locator('.sd-leader .sdl-rk').allTextContents()
  check('龙头/助攻渲染', leaders >= 2, `${leaders} 档: ${ranks.join(' ')}`)
  check('首档标注为龙头', ranks[0] === '龙头', ranks[0])

  const rungs = await page.locator('.sd-ladder .rung').count()
  const members = await page.locator('.sec-detail .tbl-wrap tbody tr').count()
  check('连板梯队渲染', rungs > 0, `${rungs} 层`)
  check('成员表渲染', members > 0, `${members} 行`)

  const nStat = Number((await page.locator('.sd-stats .v').first().textContent()).trim())
  check('成员数与家数一致', nStat === members, `家数=${nStat} 表格=${members}`)

  await page.screenshot({ path: 'sector-detail.png' })

  // A member row opens the stock drawer.
  await page.locator('.sec-detail .tbl-wrap tbody tr').first().click()
  await page.waitForSelector('.drawer', { timeout: 30000 })
  check('成员可打开个股抽屉', true)
  await page.locator('.drawer .close').click()
  await page.waitForTimeout(400)

  // Back to the ranked board.
  await page.locator('.sd-back').click()
  await page.waitForSelector('.sec-grid .sec-card', { timeout: 30000 })
  check('可返回板块榜', (await page.locator('.sec-grid .sec-card').count()) > 0)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message)
  process.exit(2)
})
