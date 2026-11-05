const { chromium } = require('playwright-core')

const EXE = process.env.PW_CHROME
const URL = 'https://fupan.chrisite.eu.cc/'

async function measure(page, label) {
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource')
      .filter((x) => /\.(js|css)$/.test(x.name))
      .map((x) => ({
        name: x.name.split('/').pop(),
        transfer: Math.round(x.transferSize / 1024 * 10) / 10,
        ms: Math.round(x.duration),
      }))
    return {
      res,
      fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0),
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    }
  })
  const total = r.res.reduce((a, b) => a + b.transfer, 0)
  console.log(`\n--- ${label} ---`)
  for (const x of r.res) console.log(`  ${x.name}  ${x.transfer} kB  (${x.ms} ms)`)
  console.log(`  合计传输 ${total.toFixed(1)} kB | FCP ${r.fcp} ms | DCL ${r.dcl} ms`)
  return total
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })
  const page = await ctx.newPage()

  await page.goto(URL, { waitUntil: 'load', timeout: 120000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 120000 })
  const cold = await measure(page, '首次访问（填充缓存）')

  // Same tab, second navigation: immutable assets must come from cache.
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 })
  await page.waitForSelector('.kpis .kpi', { timeout: 120000 })
  const warm = await measure(page, '重复访问（immutable 命中）')

  console.log(`\n静态资源传输: ${cold.toFixed(1)} kB → ${warm.toFixed(1)} kB`)
  console.log(warm < cold * 0.35 ? 'PASS 重复访问静态资源基本全部命中缓存' : 'FAIL 重复访问仍在重新下载')

  await browser.close()
})().catch((e) => { console.error('ERR:', e.message); process.exit(2) })
