/**
 * Shared helpers for the browser end-to-end suites.
 *
 * These suites drive a real deployment over the public internet, so a single
 * navigation can fail on a transient TLS/DNS blip that has nothing to do with
 * the application. Retrying the navigation keeps the suites signal: a red result
 * means the app broke, not that the network hiccuped.
 */

const TRANSIENT = /net::|ERR_|ECONNRESET|ETIMEDOUT|Timeout .* exceeded/i

/**
 * Navigate, retrying only on transient network failures.
 * Real failures (404, app error) are rethrown immediately.
 */
async function gotoWithRetry(page, url, opts = {}) {
  const { attempts = 3, timeout = 90000, waitUntil = 'domcontentloaded' } = opts
  let lastErr
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await page.goto(url, { waitUntil, timeout })
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

module.exports = { gotoWithRetry, reloadWithRetry, waitForApp, TRANSIENT }
