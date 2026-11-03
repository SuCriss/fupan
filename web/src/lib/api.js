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
    throw new Error(detail)
  }
  return res.json()
}

export const getReview = (date = '') =>
  request(`/api/all?date=${encodeURIComponent(date)}`)

export const refresh = () => request('/api/refresh', { method: 'POST' })

export const getMarket = () => request('/api/market')

export const getStock = (code, refreshCache = false) =>
  request(`/api/stock/${code}${refreshCache ? '?refresh=true' : ''}`)

export const getAiStatus = () => request('/api/ai/status')

export const getDates = () => request('/api/dates')

export const getWatch = (codes = '') =>
  request(`/api/watch${codes ? `?codes=${encodeURIComponent(codes)}` : ''}`)

export const addWatch = (code) => request(`/api/watch/${code}`, { method: 'POST' })

export const removeWatch = (code) => request(`/api/watch/${code}`, { method: 'DELETE' })
