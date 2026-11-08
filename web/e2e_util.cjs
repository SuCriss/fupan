/**
 * Shared helpers for the browser end-to-end suites.
 *
 * These suites drive a real deployment over the public internet, so a single
 * navigation can fail on a transient TLS/DNS blip that has nothing to do with
 * the application. Retrying the navigation keeps the suites signal: a red result
 * means the app broke, not that the network hiccuped.
 *
 * The app sits behind a password gate, so every navigation also has to establish
 * a session first. The password comes from PW_FUPAN in the environment; without
 * it the suites still run against a deployment where the gate is disabled.
 */

const TRANSIENT = /net::|ERR_|ECONNRESET|ETIMEDOUT|Timeout .* exceeded/i

/**
 * Log in through the API if the deployment has a gate and this context has no
 * session. Returns true when a login actually happened.
 */
async function ensureLoggedIn(page) {
  const password = process.env.PW_FUPAN
  if (!password) return false

  const needs = await page
    .evaluate(async () => {
      const r = await fetch('/api/auth/status')
      const j = await r.json()
      return Boolean(j.enabled) && !j.authenticated
    })
    .catch(() => false)
  if (!needs) return false

  const ok = await page
    .evaluate(async (pw) => {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      return r.ok
    }, password)
    .catch(() => false)
  if (!ok) throw new Error('登录失败：检查 PW_FUPAN 是否正确')

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
  return true
}

/**
 * Navigate, retrying only on transient network failures.
 * Real failures (404, app error) are rethrown immediately.
 */
async function gotoWithRetry(page, url, opts = {}) {
  const { attempts = 3, timeout = 90000, waitUntil = 'domcontentloaded', login = true } = opts
  let lastErr
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await page.goto(url, { waitUntil, timeout })
      if (login) await ensureLoggedIn(page)
      return res
    } catch (e) {
      lastErr = e
      if (!TRANSIENT.test(e.message) || i === attempts) throw e
      await page.waitForTimeout(1000 * i)
    }
  }
  throw lastErr
}

/** Wait for a selector, retrying a reload on transient navigation loss. */
async function waitForApp(page, selector, opts = {}) {
  const { attempts = 3, timeout = 90000 } = opts
  let lastErr
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await page.waitForSelector(selector, { timeout })
      return
    } catch (e) {
      lastErr = e
      if (i === attempts) throw e
      await page.waitForTimeout(1000 * i)
    }
  }
  throw lastErr
}

/** Reload the current page, retrying only on transient network failures. */
async function reloadWithRetry(page, opts = {}) {
  const { attempts = 3, timeout = 90000, waitUntil = 'domcontentloaded' } = opts
  let lastErr
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await page.reload({ waitUntil, timeout })
    } catch (e) {
      lastErr = e
      if (!TRANSIENT.test(e.message) || i === attempts) throw e
      await page.waitForTimeout(1000 * i)
    }
  }
  throw lastErr
}

module.exports = { gotoWithRetry, reloadWithRetry, waitForApp, ensureLoggedIn, TRANSIENT }
