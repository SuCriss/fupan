/**
 * Client-side CSV export.
 *
 * Generated from the rows already on screen, so a filtered or sorted view
 * exports exactly what the user sees.
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
