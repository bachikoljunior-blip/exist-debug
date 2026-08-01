/**
 * attachPageDiagnostics — the four channels a headless run must watch, in one call.
 *
 * Eight variants of this existed across three projects, each watching a different subset.
 * The subset matters: `survival/tools/perf.mjs` listens only for `pageerror`, so a run whose
 * assets 404 reports a clean pass. The union below is
 * `game2/tools/verify-pages.mjs:37-47` (four channels) merged with
 * `game2/tools/capture.mjs:306-311` (stack trimming).
 */

/**
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {number}   [options.stackFrames] Frames of `pageerror` stack to keep. A bare
 *   message cannot be routed to an owner — `i.toArray is not a function` could be any of a
 *   dozen systems — and a full stack drowns the log. Four is what `capture.mjs` settled on.
 * @param {string[]} [options.consoleTypes]
 * @returns {{consoleErrors: string[], pageErrors: string[], requestFailures: object[], badResponses: object[], lines: () => string[], count: () => number, summary: () => object}}
 */
export function attachPageDiagnostics(page, { stackFrames = 4, consoleTypes = ['error', 'warning'] } = {}) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const badResponses = [];

  page.on('console', (message) => {
    if (consoleTypes.includes(message.type())) consoleErrors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    const stack = (error.stack || '')
      .split('\n').slice(1, 1 + stackFrames).map((line) => line.trim()).join(' | ');
    pageErrors.push(`${error.message}${stack ? ` @ ${stack}` : ''}`);
  });
  page.on('requestfailed', (request) => {
    requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
  });

  const lines = () => [
    ...pageErrors.map((e) => `pageerror: ${e}`),
    ...consoleErrors,
    ...requestFailures.map((r) => `requestfailed: ${r.url} (${r.error})`),
    ...badResponses.map((r) => `http ${r.status}: ${r.url}`),
  ];

  return {
    consoleErrors,
    pageErrors,
    requestFailures,
    badResponses,
    lines,
    count: () => lines().length,
    summary: () => ({
      page: pageErrors.length,
      console: consoleErrors.length,
      request: requestFailures.length,
      http: badResponses.length,
    }),
  };
}
