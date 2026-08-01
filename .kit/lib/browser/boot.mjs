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
