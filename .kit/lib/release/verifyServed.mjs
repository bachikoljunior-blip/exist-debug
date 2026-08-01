/**
 * verifyServed — fetch what the public actually gets and prove it is what you published.
 *
 * "The push succeeded" is not evidence that the site serves the new build. Two failures in
 * this exact gap are on record: a Pages race after a state-only `main` update
 * (`Gptgame` #10/#12) and a rendered README overwriting the published game
 * (`survival` #3). Both would have been caught here and neither was caught by the build.
 *
 * Assembled from the three partial implementations:
 *  - retry across CDN propagation, cache-busting nonce, recompute-from-served-bytes
 *    (`Gptgame/scripts/verify-public-revision.mjs` — the only one that retried at all)
 *  - parallel sidecar + page fetch and `compareRelease`
 *    (`Q/tools/verify-public.mjs`)
 *  - content markers, so a 200 that serves the wrong page still fails
 */

import { revision as defaultCodec } from './revision.mjs';

/** Q's release-id comparison, unchanged — nine lines and already generic. */
export function compareRelease(expected, served, key = 'release_id') {
  const failures = [];
  if (!expected?.[key]) failures.push(`expected ${key} is missing`);
  if (!served?.[key]) failures.push(`served ${key} is missing`);
  if (expected?.[key] && served?.[key] && expected[key] !== served[key]) {
    failures.push(`served ${key} ${served[key]} does not match ${expected[key]}`);
  }
  return failures;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} options
 * @param {string}  options.url                Public URL of the page.
 * @param {string}  [options.expectedRevision] Digest the publish step produced. Omit to check
 *                                             only that the served bytes are self-consistent.
 * @param {object}  [options.codec]            From `createRevisionCodec`. Pass `null` to skip
 *                                             revision checking entirely and rely on markers.
 * @param {string[]}[options.markers]          Substrings that must appear in the served HTML,
 *                                             e.g. `'<title>ECHO//SEVEN</title>'`. A 200 that
 *                                             serves a directory listing has none of them.
 * @param {object}  [options.sidecar]          `{ path, expected, key }` — a second fetch that
 *                                             must agree, so the id lives in two places.
 * @param {number}  [options.attempts]         Pages propagation is not instant; one check is
 *                                             a coin flip. Twelve at five seconds is what
 *                                             Gptgame settled on after real races.
 * @param {number}  [options.delayMs]
 * @returns {Promise<{ok: boolean, revision: string|null, attempts: number, failures: string[], status: number|null, html: string|null}>}
 */
export async function verifyServed({
  url,
  expectedRevision = null,
  codec = defaultCodec,
  markers = [],
  sidecar = null,
  attempts = 12,
  delayMs = 5000,
  fetchImpl = fetch,
  onAttempt = null,
} = {}) {
  if (!url) throw new Error('verifyServed: url is required');
  const base = url.replace(/\/$/, '');
  let last = { ok: false, revision: null, attempts: 0, failures: ['no attempt was made'], status: null, html: null };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const failures = [];
    let html = null, status = null, served = null;

    try {
      // The nonce must vary per attempt, or a cached 404 from attempt 1 is what every later
      // attempt re-reads.
      const nonce = `${expectedRevision || 'check'}-${Date.now()}-${attempt}`;
      const target = new URL(base);
      target.searchParams.set('revision_check', nonce);

      const requests = [fetchImpl(target, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })];
      if (sidecar) {
        const side = new URL(`${base}/${String(sidecar.path).replace(/^\//, '')}`);
        side.searchParams.set('gate', nonce);
        requests.push(fetchImpl(side, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } }));
      }
      const [pageResponse, sidecarResponse] = await Promise.all(requests);

      status = pageResponse.status;
      if (status !== 200) failures.push(`page HTTP ${status}`);
      html = await pageResponse.text();

      for (const marker of markers) {
        if (!html.includes(marker)) failures.push(`served page is missing marker ${JSON.stringify(marker)}`);
      }

      if (sidecarResponse) {
        if (!sidecarResponse.ok) failures.push(`${sidecar.path} HTTP ${sidecarResponse.status}`);
        else {
          served = await sidecarResponse.json().catch(() => null);
          failures.push(...compareRelease(sidecar.expected, served, sidecar.key || 'release_id'));
        }
      }

      if (codec && !failures.length) {
        // Throws if the embedded digest disagrees with a recomputation over the served
        // bytes, which is the check that does not need to be told what to look for.
        const actual = codec.verify(html);
        if (expectedRevision && actual !== String(expectedRevision).toLowerCase()) {
          failures.push(`served revision ${actual} does not match expected ${expectedRevision}`);
        }
        if (!failures.length) return { ok: true, revision: actual, attempts: attempt, failures: [], status, html };
      } else if (!failures.length) {
        return { ok: true, revision: null, attempts: attempt, failures: [], status, html };
      }
    } catch (error) {
      failures.push(error.message);
    }

    last = { ok: false, revision: null, attempts: attempt, failures, status, html };
    if (onAttempt) onAttempt(attempt, failures);
    if (attempt < attempts) await sleep(delayMs);
  }

  return last;
}
