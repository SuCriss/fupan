/** Browser-side helpers that must never throw (private mode, blocked storage). */

/** Read a persisted UI preference; returns '' when storage is unavailable. */
export function readPref(key) {
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

export function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

/** Best-effort desktop notification after a background auto-refresh. */
export function notifyUpdated(doc) {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    if (readPref('fupan_notify') !== '1') return
    // Only worth a popup when the user is looking at something else.
    if (document.visibilityState === 'visible') return
    const s = doc?.stats || {}
    new Notification('复盘数据已更新', {
      body: `${s.date || ''} 涨停 ${s.upCount ?? 0} 家 · 情绪 ${doc?.sentiment?.score ?? '--'}`,
      tag: 'fupan-refresh',
    })
  } catch {
    /* notifications are best-effort */
  }
}
