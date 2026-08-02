/**
 * waitForBoot — wait for a page to declare itself ready, and report *where* it stalled.
 *
 * Two details here are load-bearing and both were paid for:
 *
 * 1. `polling: 500`. Playwright's default is `'raf'`, and rAF does not tick while the main
 *    thread is inside `renderer.compile()`. Under SwiftShader that window is long enough
 *    that a perfectly healthy page looks hung. Poll on a timer.
 *    (`game2/tools/capture.mjs:323-325`)
 *
 * 2. Reading the boot-status element on timeout. "Boot timed out" is not actionable;
 *    "timed out after 418s at step: baking foliage impostors" is. Both game2 (`#boot-status`)
 *    and survival (`#boot-note`) do this, which is why the selector is a parameter.
 *
 * Boot budgets have to be generous here: procedural texture synthesis, terrain erosion and
 * impostor bakes run one to two orders of magnitude slower on software rendering than on a
 * real GPU.
 */

/**
 * Refuse a `readyExpr` that is a *function source* rather than an expression.
 *
 * Playwright evaluates a string as an expression, so `'() => window.READY === true'` produces
 * a function **object** — which is truthy — and `waitForFunction` resolves on the first poll.
 * Measured: 21 ms to `booted: true` against a page where `window.READY` is `undefined`, while
 * the documented form `'window.READY === true'` correctly times out and returns `booted:
 * false`. The mistake costs nothing to make and turns the boot gate into a constant `true`,
 * which is the apparatus failure this whole harness exists to prevent — a page that died
 * reports as healthy. Cheap to detect, so it is an error rather than a footnote.
 */
export function assertExpression(expr, caller) {
  if (/^\s*(\(|async\s|function\b)[^]*=>|^\s*function\b/.test(String(expr))) {
    throw new Error(
      `${caller}: readyExpr must be an expression, not a function source. ` +
      `Playwright evaluates the string as an expression, so a function literal is always ` +
      `truthy and the wait would succeed immediately. ` +
      `Use 'window.READY === true', not '() => window.READY === true'.`,
    );
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {string} options.readyExpr        Expression evaluated in the page, e.g.
 *                                          `'window.__kagerouReady === true'`.
 * @param {string} [options.statusSelector] Element whose text names the current boot step.
 * @param {number} [options.timeout]
 * @param {number} [options.polling]
 * @returns {Promise<{booted: boolean, seconds: number, stalledAt: string|null}>}
 */
export async function waitForBoot(page, {
  readyExpr,
  statusSelector = null,
  timeout = 420000,
  polling = 500,
} = {}) {
  if (!readyExpr) throw new Error('waitForBoot: readyExpr is required');
  assertExpression(readyExpr, 'waitForBoot');
  const started = Date.now();

  try {
    await page.waitForFunction(readyExpr, undefined, { timeout, polling });
    return { booted: true, seconds: (Date.now() - started) / 1000, stalledAt: null };
  } catch {
    let stalledAt = null;
    if (statusSelector) {
      stalledAt = await page
        .evaluate((sel) => document.querySelector(sel)?.textContent || '(no status)', statusSelector)
        .catch(() => '(unreachable)');
    }
    return { booted: false, seconds: (Date.now() - started) / 1000, stalledAt };
  }
}
