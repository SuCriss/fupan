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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await gotoWithRetry(page, SITE, { timeout: 90000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 90000 })

  // --- manifest ------------------------------------------------------
  const man = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    if (!link) return { ok: false }
    const res = await fetch(link.href)
    const j = await res.json()
    return {
      ok: res.ok,
      status: res.status,
      name: j.name,
      short: j.short_name,
      display: j.display,
      start: j.start_url,
      icons: (j.icons || []).map((i) => `${i.sizes}:${i.purpose || 'any'}`),
      theme: j.theme_color,
    }
  })
  check('manifest 已链接且可解析', man.ok, `HTTP ${man.status}`)
  check('应用名正确', man.name === 'A股涨停复盘' && man.short === '涨停复盘', `${man.name} / ${man.short}`)
  check('display=standalone', man.display === 'standalone')
  check('start_url 为根路径', man.start === '/')
  check('图标含 192/512/maskable', man.icons.length >= 3, man.icons.join(' '))

  // --- icons actually load -------------------------------------------
  const iconOk = await page.evaluate(async () => {
    const out = []
    for (const s of ['192', '512']) {
      const r = await fetch(`/icon-${s}.png`)
      out.push({ s, ok: r.ok, type: r.headers.get('content-type') })
    }
    return out
  })
  check('图标可加载且为 PNG',
    iconOk.every((i) => i.ok && i.type === 'image/png'),
    iconOk.map((i) => `${i.s}:${i.type}`).join(' '))

  // --- service worker ------------------------------------------------
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false }
    const reg = await navigator.serviceWorker.getRegistration('/')
    return {
      supported: true,
      registered: !!reg,
      scope: reg?.scope || '',
      state: reg?.active?.state || reg?.installing?.state || reg?.waiting?.state || '',
    }
  })
  check('Service Worker 已注册', sw.supported && sw.registered, `state=${sw.state} scope=${sw.scope}`)
  check('SW 作用域为根', sw.scope.endsWith('/'), sw.scope)

  // Give the worker a moment to activate, then confirm it controls the page.
  await page.waitForTimeout(2500)
  const controlled = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/')
    return {
      active: reg?.active?.state,
      controller: !!navigator.serviceWorker.controller,
    }
  })
  check('SW 已激活', controlled.active === 'activated', controlled.active || '(无)')

  // --- offline fallback ----------------------------------------------
  // Reload while offline: the cached shell should still render the app frame.
  await ctx.setOffline(true)
  let offlineRendered = false
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 })
    offlineRendered = await page.evaluate(() => !!document.querySelector('#root'))
  } catch {
    offlineRendered = false
  }
  await ctx.setOffline(false)
  check('离线时可加载应用外壳', offlineRendered)

  check('无页面 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2) })
