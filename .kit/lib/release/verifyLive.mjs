/**
 * verifyLive — boot the published URL in a real browser and prove it runs.
 *
 * This is **orthogonal** to `verifyServed`, not a substitute for it. `verifyServed` proves
 * which bytes are being served; `verifyLive` proves those bytes start, reach ready, and
 * survive an interaction with no errors on any of the four channels. A deploy can pass
 * either one and fail the other, so a publish step wants both.
 *
 * Generalised from `game2/tools/verify-pages.mjs`, whose KAGEROU-specific parts — the
 * `/docs/` redirect, `__kagerouReady`, the `#boot-start` click and the
 * `/assets/index-<hash>.js` module check — are all parameters here.
 */

import { launchHeadless, proxyPageOptions } from '../browser/launch.mjs';
import { attachPageDiagnostics } from '../browser/diagnostics.mjs';

/**
 * @param {object} options
 * @param {string}   options.url
 * @param {string}   [options.readyExpr]     Expression that must become true, e.g.
 *                                           `'window.__ready === true'`.
 * @param {string}   [options.expectPath]    Substring the final URL must contain, so a
 *                                           redirect to a placeholder page fails.
 * @param {RegExp}   [options.modulePattern] The entry module's `src` must match. This is what
 *                                           catches a cached `index.html` pointing at an
 *                                           asset hash the deploy replaced.
 * @param {(page) => Promise<void>} [options.startAction]  e.g. click the start button.
 * @param {string}   [options.runningExpr]   Must become true after `startAction`.
 * @param {(page) => Promise<object>} [options.collect]    Extra evidence for the report.
 * @param {string}   [options.screenshot]
 * @returns {Promise<{status: 'passed'|'failed', failures: string[], report: object}>}
 */
export async function verifyLive({
  url,
  readyExpr = null,
  expectPath = null,
  modulePattern = null,
  startAction = null,
  runningExpr = null,
  collect = null,
  timeout = 120000,
  viewport = { width: 1266, height: 585 },
  screenshot = null,
  browser,
  ...launchOptions
} = {}) {
  if (!url) throw new Error('verifyLive: url is required');
  const owned = !browser;
  const driver = browser || await launchHeadless(launchOptions);
  const failures = [];
  let report;

  try {
    const page = await driver.newPage({ viewport, ...proxyPageOptions() });
    const diagnostics = attachPageDiagnostics(page, { consoleTypes: ['error'] });

    const entry = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    const entryStatus = entry?.status() ?? null;
    if (entryStatus !== 200) failures.push(`entry status ${entryStatus}`);

    if (expectPath) {
      await page.waitForURL((current) => String(current).includes(expectPath), { timeout }).catch(() => {});
    }
    if (readyExpr) {
      await page.waitForFunction(readyExpr, undefined, { timeout, polling: 500 })
        .catch(() => failures.push(`never reached ready: ${readyExpr}`));
    }

    const observed = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      module: [...document.scripts].find((s) => s.type === 'module')?.src || null,
    }));

    if (expectPath && !observed.url.includes(expectPath)) {
      failures.push(`not on the production path: ${observed.url}`);
    }
    if (modulePattern && !modulePattern.test(observed.module || '')) {
      failures.push(`unexpected entry module ${observed.module}`);
    }

    let running = null;
    if (startAction) {
      await startAction(page);
      if (runningExpr) {
        await page.waitForFunction(runningExpr, undefined, { timeout, polling: 250 })
          .catch(() => failures.push(`interactive start failed: ${runningExpr}`));
      }
      // Let a frame or two actually render before reading counters off it.
      await page.waitForTimeout(750);
      running = runningExpr ? await page.evaluate((expr) => Boolean(eval(expr)), runningExpr).catch(() => false) : null;
    }

    const extra = collect ? await collect(page).catch((e) => ({ collectError: e.message })) : null;
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });

    const counts = diagnostics.summary();
    if (counts.page) failures.push(`${counts.page} page error(s)`);
    if (counts.console) failures.push(`${counts.console} console error(s)`);
    if (counts.request) failures.push(`${counts.request} request failure(s)`);
    if (counts.http) failures.push(`${counts.http} HTTP error response(s)`);

    report = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      requestedUrl: url,
      entryStatus,
      observed,
      running,
      extra,
      diagnostics: {
        pageErrors: diagnostics.pageErrors,
        consoleErrors: diagnostics.consoleErrors,
        requestFailures: diagnostics.requestFailures,
        badResponses: diagnostics.badResponses,
      },
    };
  } finally {
    if (owned) await driver.close();
  }

  report.status = failures.length ? 'failed' : 'passed';
  report.failures = failures;
  return { status: report.status, failures, report };
}
