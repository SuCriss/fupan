const { chromium } = require('playwright-core')
const { gotoWithRetry } = require('./e2e_util.cjs')

const EXE = process.env.PW_CHROME
const SITE = 'https://fupan.chrisite.eu.cc/'
const PW = process.env.PW_FUPAN

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) failed += 1
}

;(async () => {
  if (!PW) {
    console.log('SKIP  未设置 PW_FUPAN，跳过登录测试')
    process.exit(0)
  }

  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  // No shared storage: this context must start unauthenticated.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  // --- 1. unauthenticated visit shows the gate ------------------------
  await gotoWithRetry(page, SITE, { timeout: 90000, login: false })
  await page.waitForSelector('.login-card', { timeout: 30000 })
  check('未登录时显示登录页', true)

  const noData = await page.evaluate(() => !document.querySelector('.kpis'))
  check('登录前不渲染业务数据', noData)

  const apiBlocked = await page.evaluate(async () => {
    const r = await fetch('/api/all')
    return r.status
  })
  check('未登录时业务接口返回 401', apiBlocked === 401, `HTTP ${apiBlocked}`)

  // --- 2. wrong password ---------------------------------------------
  await page.locator('.login-input').fill('definitely-wrong')
  await page.locator('.login-btn').click()
  await page.waitForSelector('.login-err', { timeout: 20000 })
  const errText = (await page.locator('.login-err').textContent()).trim()
  check('错误密码给出提示', errText.length > 0, errText)
  check('错误后仍停留在登录页', (await page.locator('.login-card').count()) === 1)
  check('错误后清空输入框', (await page.locator('.login-input').inputValue()) === '')

  // --- 3. correct password -------------------------------------------
  await page.locator('.login-input').fill(PW)
  await page.locator('.login-btn').click()
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  check('正确密码进入应用', true)
  check('登录页已消失', (await page.locator('.login-card').count()) === 0)

  const apiOk = await page.evaluate(async () => {
    const r = await fetch('/api/all')
    return r.status
  })
  check('登录后业务接口可用', apiOk === 200, `HTTP ${apiOk}`)

  const cookieFlags = await page.evaluate(() => {
    const c = document.cookie || ''
    return { hasSession: /fupan_sess/.test(c), raw: c }
  })
  // httpOnly cookies are deliberately invisible to JS; that is the correct state.
  check('会话 Cookie 对 JS 不可见（httpOnly）', !cookieFlags.hasSession, cookieFlags.raw || '(空)')

  // --- 4. session survives reload ------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })
  check('刷新后仍保持登录', (await page.locator('.login-card').count()) === 0)

  // --- 5. logout ------------------------------------------------------
  await page.locator('.logout-btn').click()
  await page.waitForSelector('.login-card', { timeout: 30000 })
  check('退出后回到登录页', true)

  const afterLogout = await page.evaluate(async () => {
    const r = await fetch('/api/all')
    return r.status
  })
  check('退出后接口重新 401', afterLogout === 401, `HTTP ${afterLogout}`)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
