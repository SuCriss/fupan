const { chromium } = require('playwright-core')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })
  const page = await ctx.newPage()

  // Cold cache so transfer sizes are real.
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  await page.goto(URL, { waitUntil: 'load', timeout: 120000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 120000 })

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource')
      .filter((r) => /\.(js|css)$/.test(r.name))
      .map((r) => ({
        name: r.name.split('/').pop(),
        transfer: Math.round(r.transferSize / 1024 * 10) / 10,
        decoded: Math.round(r.decodedBodySize / 1024 * 10) / 10,
        ms: Math.round(r.duration),
      }))
    return {
      res,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      firstPaint: Math.round((performance.getEntriesByName('first-paint')[0] || {}).startTime || 0),
      fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0),
      jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    }
  })

  console.log('=== 资源（解码后 / 传输） ===')
  for (const r of perf.res) {
    console.log(`  ${r.name}  ${r.decoded} kB → ${r.transfer} kB  (${r.ms} ms)`)
  }
  const js = perf.res.filter((r) => r.name.endsWith('.js'))
  console.log(`  JS 分块数 ${js.length}，解码合计 ${js.reduce((a, b) => a + b.decoded, 0).toFixed(1)} kB`)

  console.log('\n=== 时间线 ===')
  console.log(`  first-paint      ${perf.firstPaint} ms`)
  console.log(`  FCP              ${perf.fcp} ms`)
  console.log(`  DOMContentLoaded ${perf.domContentLoaded} ms`)
  console.log(`  load             ${perf.loadEvent} ms`)
  console.log(`  JS 堆            ${perf.jsHeapMB} MB`)

  // 首屏到「数据可用」的间隔（KPI 出现后再打一次点）
  const dataReady = Date.now()
  console.log(`  数据渲染完成约    ${dataReady - (await page.evaluate(() => Math.round(performance.timeOrigin)))} ms（绝对，仅供参考）`)

  await browser.close()
})().catch((e) => { console.error('ERR:', e.message); process.exit(2) })
