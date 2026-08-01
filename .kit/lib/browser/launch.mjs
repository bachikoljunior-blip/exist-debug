/**
 * launchHeadless — one Chromium launch for every harness in the kit.
 *
 * Four dialects of these flags existed across three projects and the differences were
 * accretion, not intent. The base set below is `game2/tools/capture.mjs:229-233` **exactly**,
 * because that is the set every measured review round was captured under; changing it would
 * invalidate the baselines those rounds are compared against. The flags the other projects
 * added — `--no-sandbox` (game, survival) and `--use-angle=swiftshader` (survival) — are
 * opt-in rather than merged in, for the same reason.
 *
 * SwiftShader is software rendering. Any fps it reports is meaningless: measure draw calls,
 * triangles, program counts and CPU step cost instead.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** `game2/tools/capture.mjs:229-233`, verbatim. Do not reorder or extend in place. */
export const SWIFTSHADER_ARGS = [
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--mute-audio',
  // Without a pinned colour profile the same frame measures differently between hosts,
  // which silently breaks every before/after luma comparison.
  '--force-color-profile=srgb',
];

/**
 * `game/tools/{playtest,showcase,perfprobe,weaponsweep}.mjs` each hard-code
 * `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — a pinned build number, and the
 * single least portable line in the whole survey. Resolve it instead.
 */
export function resolveExecutablePath(explicit) {
  if (explicit) return explicit;
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidates = [];
  if (browsersRoot && existsSync(browsersRoot)) {
    candidates.push(join(browsersRoot, 'chromium'));
    try {
      for (const entry of readdirSync(browsersRoot).sort().reverse()) {
        if (entry.startsWith('chromium-')) candidates.push(join(browsersRoot, entry, 'chrome-linux', 'chrome'));
      }
    } catch { /* fall through to the fixed list */ }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');

  // `undefined` is a valid answer: it means "let Playwright resolve its own download",
  // which is correct whenever the versions actually match.
  return candidates.find((path) => existsSync(path));
}

/** `playwright` in game2/survival, `playwright-core` in game. Accept either. */
export async function loadChromium() {
  for (const pkg of ['playwright', 'playwright-core']) {
    try { return (await import(pkg)).chromium; } catch { /* try the next */ }
  }
  throw new Error('launchHeadless: neither `playwright` nor `playwright-core` is installed');
}

/**
 * @param {object} [options]
 * @param {string[]} [options.extraArgs]        Appended after the base set.
 * @param {boolean}  [options.noSandbox]        Adds `--no-sandbox --disable-gpu-sandbox`.
 * @param {boolean}  [options.angleSwiftshader] Adds `--use-angle=swiftshader` (survival).
 * @param {boolean}  [options.exposeGc]         Adds `--js-flags=--expose-gc`, needed by the
 *                                              heap-growth probe.
 * @param {string}   [options.executablePath]
 * @param {boolean}  [options.proxy]            Honour `HTTPS_PROXY` (default true). This is
 *                                              the only reason a headless run can reach a
 *                                              **public** URL from inside the sandbox, and
 *                                              exactly one file in eight repositories had it
 *                                              (`game2/tools/verify-pages.mjs:23`).
 * @param {object}   [options.chromium]         Inject a driver instead of importing one.
 */
export async function launchHeadless({
  extraArgs = [],
  noSandbox = false,
  angleSwiftshader = false,
  exposeGc = false,
  executablePath,
  proxy = true,
  chromium,
  ...rest
} = {}) {
  const driver = chromium || await loadChromium();
  const args = [...SWIFTSHADER_ARGS];
  if (noSandbox) args.push('--no-sandbox', '--disable-gpu-sandbox');
  if (angleSwiftshader) args.push('--use-angle=swiftshader');
  if (exposeGc) args.push('--js-flags=--expose-gc');
  args.push(...extraArgs);

  return driver.launch({
    headless: true,
    args,
    executablePath: resolveExecutablePath(executablePath),
    proxy: proxy && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    ...rest,
  });
}

/**
 * Page options that belong with a proxied launch. Separate from `launchHeadless` because
 * `ignoreHTTPSErrors` is a context/page option, not a browser one, and forgetting it is how
 * a proxied public-URL check fails with a TLS error that reads like the site is down.
 */
export function proxyPageOptions() {
  return process.env.CODEX_NETWORK_PROXY_ACTIVE === '1' ? { ignoreHTTPSErrors: true } : {};
}
