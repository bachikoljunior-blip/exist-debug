/**
 * floorGate.mjs — the git-diff gate that keeps product changes tied to their record.
 *
 * `Q/tools/floor-gates.mjs:12-31` was already a pure function; the only thing it needed was
 * for its constants to stop being constants. That matters more than it sounds, because the
 * two repositories running this gate **cannot both pass it as written**: Q demands
 * `review_outcome: passed`, Gptgame demands `review_outcome: complete_verified`, and
 * `passed` is not in the ten-value status vocabulary both protocols define. One shared gate
 * has to take the accepted value as configuration.
 *
 * Two rules, both about the same thing — a change to the product must move its record:
 *
 *   F2  product files changed  ->  the canonical state file changed too
 *   F5  product files changed  ->  a review record exists AND this change set touched it
 *
 * F5's second half is what makes it real. Without the diff check a stale review record from
 * three commits ago satisfies the gate forever.
 */

export const DEFAULT_PRODUCT_PATTERN =
  /^(?:index\.html|styles\.css|icon\.svg|manifest\.webmanifest|sw\.js|release\.json|assets-manifest\.json|package(?:-lock)?\.json|src\/|tests\/|tools\/|scripts\/|lib\/|vendor\/|\.github\/workflows\/)/;

/**
 * @param {object} input
 * @param {string[]} input.changedFiles
 * @param {string}   input.stateText      Current contents of the canonical state file.
 * @param {string}   [input.stateDiffText] Diff of that file across this change set.
 * @param {object}   [options]
 * @param {string}   [options.statePath]
 * @param {RegExp}   [options.productPattern]
 * @param {string[]} [options.independenceLevels]
 * @param {string[]} [options.acceptedOutcomes] Accepted `review_outcome` values.
 * @param {string[]} [options.reviewFields]     Any one of these must appear in the diff.
 * @returns {string[]} failures, empty when the gate passes
 */
export function evaluateFloorGate({ changedFiles, stateText, stateDiffText = '' }, {
  statePath = 'AI_DEVELOPMENT/STATE.yaml',
  productPattern = DEFAULT_PRODUCT_PATTERN,
  independenceLevels = ['A', 'B', 'C'],
  acceptedOutcomes = ['complete_verified'],
  reviewFields = ['independence_level_used', 'review_outcome', 'reviewed_at', 'review_scope'],
} = {}) {
  const failures = [];
  const protectedChanges = changedFiles.filter((file) => productPattern.test(file));
  if (!protectedChanges.length) return failures;

  if (!changedFiles.includes(statePath)) {
    failures.push(`F2: protected files changed without ${statePath} (${protectedChanges.join(', ')})`);
  }

  // `(?![A-Za-z])` matters: without it a value of `null` matches its leading `n` and the
  // failure message reports `found N` for a field that is unset.
  const level = stateText.match(/independence_level_used:\s*['"]?([A-Z])(?![A-Za-z])/i)?.[1]?.toUpperCase();
  const outcome = stateText.match(/review_outcome:\s*['"]?([a-z_]+)['"]?/i)?.[1];
  if (!independenceLevels.includes(level || '') || !acceptedOutcomes.includes(outcome)) {
    failures.push(
      `F5: protected changes require independence_level_used ${independenceLevels.join('/')} `
      + `and review_outcome ${acceptedOutcomes.join('|')} (found ${level || 'none'} / ${outcome || 'none'})`,
    );
  }

  const touched = new RegExp(`^[+-]\\s*(?:${reviewFields.join('|')}):`, 'm');
  if (!touched.test(stateDiffText)) {
    failures.push(`F5: this change set must update its review record in ${statePath}`);
  }
  return failures;
}

/** Canned scenarios that must produce a failure. Used by the self-test harness. */
export function floorGateScenarios(options = {}) {
  const statePath = options.statePath || 'AI_DEVELOPMENT/STATE.yaml';
  const outcome = (options.acceptedOutcomes || ['complete_verified'])[0];
  return {
    F2: {
      why: 'a product file changed without the canonical state file',
      input: {
        changedFiles: ['src/game.js'],
        stateText: `independence_level_used: C\nreview_outcome: ${outcome}\n`,
        stateDiffText: '+reviewed_at: now\n',
      },
    },
    F5: {
      why: 'a product file changed with no review record',
      input: {
        changedFiles: ['src/game.js', statePath],
        stateText: 'independence_level_used: null\nreview_outcome: null\n',
        stateDiffText: '',
      },
    },
    F5_STALE: {
      why: 'the review record is valid but was not touched by this change set',
      input: {
        changedFiles: ['src/game.js', statePath],
        stateText: `independence_level_used: B\nreview_outcome: ${outcome}\n`,
        stateDiffText: '+some_unrelated_field: 1\n',
      },
    },
  };
}
