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

const STATUS_TEXT = {
  limitUp: '涨停',
  limitDown: '跌停',
  broken: '炸板',
}

/**
 * Raise a notification for each watchlist limit-state change.
 * Unlike notifyUpdated this fires even on a visible tab: a name hitting the
 * limit is exactly what the user is watching for.
 */
export function notifyAlerts(changes) {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    if (readPref('fupan_notify') !== '1') return
    for (const c of changes.slice(0, 3)) {
      const label = STATUS_TEXT[c.status] || c.status
      const boards = c.boards >= 2 ? ` ${c.boards}连板` : ''
      new Notification(`${c.name} ${label}`, {
        body: `${c.code}${boards}${c.chg != null ? `  ${c.chg >= 0 ? '+' : ''}${Number(c.chg).toFixed(2)}%` : ''}`,
        tag: `fupan-alert-${c.code}`,
      })
    }
  } catch {
    /* notifications are best-effort */
  }
}

/** Previous limit state per code, so only transitions alert. */
export function readAlertState() {
  try {
    return JSON.parse(readPref('fupan_alert_state') || '{}') || {}
  } catch {
    return {}
  }
}

export function writeAlertState(state) {
  writePref('fupan_alert_state', JSON.stringify(state))
}
