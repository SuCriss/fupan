/**
 * Offline support for the fupan SPA.
 *
 * Deliberately conservative:
 *  - content-hashed /assets files are cache-first (they never change)
 *  - the HTML shell is network-first, so a deploy is picked up immediately and
 *    the cached copy is only a fallback when the network is gone
 *  - /api requests are never cached: stale quotes are worse than an error
 *
 * Bumping CACHE on a behavioural change is what evicts old entries.
 */

const CACHE = 'fupan-v1'
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Live market data must never be served from cache.
  if (url.pathname.startsWith('/api/')) return

  // Immutable build output: cache-first, and fill the cache on first use.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(request, copy))
            }
            return res
          })
      )
    )
    return
  }

  // Navigation: network-first so a deploy lands at once, cache as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(SHELL, copy))
          }
          return res
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error()))
    )
    return
  }

  // Everything else (icons, manifest, robots): cache-first, refresh in background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => hit || Response.error())
      return hit || network
    })
  )
})
