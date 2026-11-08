/**
 * Client-side export helpers.
 *
 * CSV is generated from the rows already on screen (so a filtered or sorted view
 * exports exactly what the user sees). The image card is drawn on a canvas rather
 * than screenshotting the DOM: a canvas card stays readable when pasted into a
 * chat app, which a 1500px dashboard screenshot does not.
 */

/** Quote a cell so commas, quotes and newlines survive a round-trip. */
function cell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Export rows as CSV.
 * @param {string} filename  without extension
 * @param {string[]} headers column titles
 * @param {Array<Array<any>>} rows cell values in the same order as headers
 */
export function exportCsv(filename, headers, rows) {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))]
  // The BOM is what makes Excel open UTF-8 Chinese correctly instead of mojibake.
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  download(blob, `${filename}.csv`)
}

const CARD_W = 1200
const CARD_H = 820
const BG = '#0b0f16'
const PANEL = '#141b26'
const LINE = '#22303f'
const TEXT = '#e6edf6'
const MUTED = '#7d8ea3'
const UP = '#ff4d5e'
const DOWN = '#2ec27e'
const GOLD = '#f5b942'

function fmtAmtShort(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(0)}万`
  return n.toFixed(0)
}

/**
 * Draw a shareable summary card.
 * @param {{date:string, stats:object, sentiment:object, leaders:Array, sectors:Array}} data
 * @returns {Promise<Blob>}
 */
export function renderSummaryCard(data) {
  const canvas = document.createElement('canvas')
  const dpr = 2 // export at 2x so text stays crisp in chat apps
  canvas.width = CARD_W * dpr
  canvas.height = CARD_H * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const s = data.stats || {}
  const sent = data.sentiment || {}

  // Background
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Header
  ctx.fillStyle = TEXT
  ctx.font = 'bold 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('A股涨停复盘', 48, 70)
  ctx.fillStyle = MUTED
  ctx.font = '22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(data.date || '', 48, 104)

  // Sentiment score, right aligned
  if (sent.score != null) {
    const tone = sent.tone === 'hot' ? UP : sent.tone === 'cold' ? DOWN : GOLD
    ctx.textAlign = 'right'
    ctx.fillStyle = tone
    ctx.font = 'bold 64px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(String(sent.score), CARD_W - 48, 84)
    ctx.fillStyle = MUTED
    ctx.font = '20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(`情绪 ${sent.label || ''}`, CARD_W - 48, 112)
    ctx.textAlign = 'left'
  }

  // KPI row
  const kpis = [
    { k: '涨停', v: s.upCount ?? 0, c: UP },
    { k: '跌停', v: s.downCount ?? 0, c: DOWN },
    { k: '封板率', v: `${s.sealRate ?? 0}%`, c: GOLD },
    { k: '最高板', v: s.maxBoard ?? 0, c: GOLD },
    { k: '连板', v: s.lianbanCount ?? 0, c: UP },
    { k: '炸板率', v: `${s.brokenRate ?? 0}%`, c: MUTED },
  ]
  const kw = (CARD_W - 96) / kpis.length
  kpis.forEach((item, i) => {
    const x = 48 + i * kw
    ctx.fillStyle = PANEL
    ctx.fillRect(x, 140, kw - 12, 92)
    ctx.fillStyle = MUTED
    ctx.font = '17px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(item.k, x + 16, 168)
    ctx.fillStyle = item.c
    ctx.font = 'bold 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(String(item.v), x + 16, 210)
  })

  // Two columns: leaders and sectors
  const colW = (CARD_W - 96 - 32) / 2

  const drawColumn = (title, x, items, fmt) => {
    ctx.fillStyle = GOLD
    ctx.font = 'bold 21px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(title, x, 288)
    ctx.fillStyle = LINE
    ctx.fillRect(x, 302, colW, 1)
    items.forEach((it, i) => {
      const y = 340 + i * 52
      fmt(ctx, it, x, y, colW, i)
    })
  }

  // Leaders: rank, name, boards, chg
  drawColumn('龙头榜', 48, (data.leaders || []).slice(0, 7), (c, it, x, y, w, i) => {
    c.fillStyle = i < 3 ? GOLD : MUTED
    c.font = 'bold 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(`#${i + 1}`, x, y)
    c.fillStyle = TEXT
    c.font = '21px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(String(it.name || '').slice(0, 6), x + 52, y)
    c.fillStyle = MUTED
    c.font = '18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(it.daysText || '', x + 230, y)
    c.textAlign = 'right'
    c.fillStyle = (it.chg ?? 0) >= 0 ? UP : DOWN
    c.font = 'bold 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(`${(it.chg ?? 0) >= 0 ? '+' : ''}${Number(it.chg || 0).toFixed(2)}%`, x + w, y)
    c.textAlign = 'left'
  })

  // Sectors: name, count, heat
  drawColumn('板块热度', 48 + colW + 32, (data.sectors || []).slice(0, 7), (c, it, x, y, w) => {
    c.fillStyle = TEXT
    c.font = '21px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(String(it.name || '').slice(0, 8), x, y)
    c.fillStyle = MUTED
    c.font = '18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(`${it.n} 家`, x + 240, y)
    c.textAlign = 'right'
    c.fillStyle = (it.heat ?? 0) >= 80 ? UP : GOLD
    c.font = 'bold 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    c.fillText(String(it.heat ?? ''), x + w, y)
    c.textAlign = 'left'
  })

  // Footer
  ctx.fillStyle = MUTED
  ctx.font = '16px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('数据来源: fupan.chrisite.eu.cc  ·  仅供复盘参考，不构成投资建议', 48, CARD_H - 34)

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

/** Render the summary card and trigger a download. */
export async function exportSummaryPng(data) {
  const blob = await renderSummaryCard(data)
  if (!blob) throw new Error('导出图片失败')
  download(blob, `复盘-${data.date || 'latest'}.png`)
}

export { fmtAmtShort }
