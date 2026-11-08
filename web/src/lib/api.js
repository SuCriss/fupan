const BASE = ''

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body.detail) detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(detail)
    // The caller distinguishes "session expired" from a normal failure so it can
    // show the login screen instead of an error banner.
    err.status = res.status
    throw err
  }
  return res.json()
}

/** Whether a password gate is configured and whether this browser is past it. */
export const getAuthStatus = () => request('/api/auth/status')

export const login = (password) =>
  request('/api/login', { method: 'POST', body: JSON.stringify({ password }) })

export const logout = () => request('/api/logout', { method: 'POST' })

export const getReview = (date = '') =>
  request(`/api/all?date=${encodeURIComponent(date)}`)

export const refresh = () => request('/api/refresh', { method: 'POST' })

/** Poll the background snapshot build. */
export const refreshStatus = () => request('/api/refresh/status')

export const getMarket = () => request('/api/market')

/** Fuzzy code/name lookup over the full-market symbol list. */
export const searchStocks = (q) =>
  request(`/api/search?q=${encodeURIComponent(q)}`)

export const getStock = (code, refreshCache = false) =>
  request(`/api/stock/${code}${refreshCache ? '?refresh=true' : ''}`)

/** Only the AI attribution block — cheap enough to poll while generating. */
export const getStockAi = (code) => request(`/api/stock/${code}/ai`)

export const getAiStatus = () => request('/api/ai/status')

export const getDates = () => request('/api/dates')

/** Daily composite sentiment score series (newest first). */
export const getSentiment = (days = 60) =>
  request(`/api/sentiment?days=${encodeURIComponent(days)}`)

/** Heat-ranked sector dossiers derived from the cached limit-up pool. */
export const getSectors = (limit = 24) =>
  request(`/api/sectors?limit=${encodeURIComponent(limit)}`)

/** Whole-market dragon-tiger list plus institutional seats for one day. */
export const getLhb = (date = '') =>
  request(`/api/lhb${date ? `?date=${encodeURIComponent(date)}` : ''}`)

/** Review note for one trading day. */
export const getNote = (date = '') =>
  request(`/api/note${date ? `?date=${encodeURIComponent(date)}` : ''}`)

export const saveNote = (date, content) =>
  request('/api/note', {
    method: 'PUT',
    body: JSON.stringify({ date, content }),
  })

/** Dates that already have a note. */
export const getNoteDates = () => request('/api/note/dates')

export const getWatch = (codes = '') =>
  request(`/api/watch${codes ? `?codes=${encodeURIComponent(codes)}` : ''}`)

export const addWatch = (code) => request(`/api/watch/${code}`, { method: 'POST' })

export const removeWatch = (code) => request(`/api/watch/${code}`, { method: 'DELETE' })
