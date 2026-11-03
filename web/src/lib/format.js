export const fmtAmt = (n) => {
  if (!n) return '--'
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(0) + '万'
  return String(n)
}

export const pct = (n, d = 2) => (Number(n) > 0 ? '+' : '') + Number(n || 0).toFixed(d) + '%'

export const cls = (n) => (n > 0 ? 'u' : n < 0 ? 'd' : 'flat')

export const badgeCls = (c) =>
  c === 'up' ? 'b-up' : c === 'mild' ? 'b-mild' : c === 'down' ? 'b-down' : 'b-flat'

export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  )

/** Format YYYYMMDD <-> YYYY-MM-DD */
export const isoDate = (d) => (d ? d.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '')
