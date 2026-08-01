/**
 * findings.mjs — validate the critic's output before anything consumes it.
 *
 * `dispatch` routes on `owner` and sorts on `severity`. Nothing checked that either field
 * was present, or spelled the way the router expects, and the four review files on disk have
 * already drifted: `review-r13.json` has no `round`, no `category` and no `hypothesis`.
 *
 * A deliberately small hand-written validator rather than a JSON Schema engine, so the kit
 * keeps its zero-dependency property. `findings.schema.json` beside this file is the
 * published contract for anything else that wants to read these.
 */

const SEVERITIES = new Set(['blocker', 'major', 'minor']);
const VERDICTS = new Set(['PASS', 'FAIL']);

const REQUIRED_FINDING = {
  severity: 0, shot: 1, problem: 20, why: 10, owner: 1, fix: 10,
};

/** Fields every round should carry but older files predate. Reported as warnings. */
const RECOMMENDED_TOP = ['round', 'profile', 'tier', 'nativeResolution'];

/**
 * @param {object} review
 * @param {object} [options]
 * @param {boolean} [options.strict] Promote the recommended fields to failures. Use for new
 *   rounds; leave off when validating historical files.
 * @param {Set<string>|null} [options.knownOwners] Fail an owner the map cannot route.
 * @returns {{ok: boolean, failures: string[], warnings: string[]}}
 */
export function validateFindings(review, { strict = false, knownOwners = null } = {}) {
  const failures = [];
  const warnings = [];

  if (!review || typeof review !== 'object') return { ok: false, failures: ['review is not an object'], warnings };

  if (!VERDICTS.has(review.verdict)) failures.push(`verdict must be PASS or FAIL, got ${JSON.stringify(review.verdict)}`);
  if (!Number.isInteger(review.score) || review.score < 0 || review.score > 100) {
    failures.push(`score must be an integer 0-100, got ${JSON.stringify(review.score)}`);
  }
  if (typeof review.blindComparison !== 'string' || review.blindComparison.trim().length < 40) {
    failures.push('blindComparison must state which a stranger would pick and the specific reason');
  }
  if (!Array.isArray(review.findings)) {
    failures.push('findings must be an array');
    return { ok: false, failures, warnings };
  }

  for (const field of RECOMMENDED_TOP) {
    if (review[field] === undefined || review[field] === null) {
      (strict ? failures : warnings).push(`missing ${field}`);
    }
  }
  if (review.nativeResolution !== undefined && !/^[0-9]+x[0-9]+$/.test(String(review.nativeResolution))) {
    failures.push(`nativeResolution must look like 2532x1170, got ${JSON.stringify(review.nativeResolution)}`);
  }

  review.findings.forEach((finding, i) => {
    const at = `findings[${i}]`;
    if (!finding || typeof finding !== 'object') { failures.push(`${at} is not an object`); return; }

    for (const [field, minLength] of Object.entries(REQUIRED_FINDING)) {
      const value = finding[field];
      if (typeof value !== 'string' || value.trim().length < minLength) {
        failures.push(`${at}.${field} is missing or too short (needs a string of at least ${minLength} chars)`);
      }
    }
    if (finding.severity !== undefined && !SEVERITIES.has(finding.severity)) {
      failures.push(`${at}.severity must be blocker|major|minor, got ${JSON.stringify(finding.severity)}`);
    }
    if (knownOwners && typeof finding.owner === 'string') {
      const owner = finding.owner.replace(/^\.\//, '');
      if (!knownOwners.has(owner)) failures.push(`${at}.owner ${owner} is not in the ownership map`);
    }
    // Not a failure: a finding may legitimately have no mechanism to propose. But an absent
    // hypothesis and a hypothesis smuggled into `problem` look identical from here, and the
    // second is what the problem/hypothesis split exists to prevent.
    if (finding.hypothesis === undefined) warnings.push(`${at} has no hypothesis field`);
  });

  return { ok: failures.length === 0, failures, warnings };
}
