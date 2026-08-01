/**
 * selftest.mjs — prove a gate can fail before trusting it to pass.
 *
 * Three tools already carried a `--deliberate-failure` / `FLOOR_TEST_BAD` mode
 * (`Q/tools/floor-gates.mjs`, `Q/tools/verify-public.mjs`, `Q/tools/validate.mjs`) and it is
 * the single cheapest defence against the failure mode this whole kit exists for: a gate
 * that is silently inert looks exactly like a gate that is passing. Both print nothing and
 * exit 0.
 *
 * Two of the migrations on record ended with gates installed but never observed failing, and
 * their state files honestly record `prepared_not_applied` for that reason. Making the proof
 * a first-class primitive is how that stops being optional.
 */

/**
 * @param {string} name
 * @param {() => string[] | {failures: string[]} | boolean} evaluate
 *   Return a non-empty failure list (or `false`/throw) to mean "the gate fired".
 * @returns {{name: string, fired: boolean, detail: string}}
 */
export function assertGateFires(name, evaluate) {
  let fired = false;
  let detail = '';
  try {
    const result = evaluate();
    const failures = Array.isArray(result) ? result
      : result && Array.isArray(result.failures) ? result.failures
      : result === false ? ['returned false'] : [];
    fired = failures.length > 0;
    detail = failures.join('; ');
  } catch (error) {
    fired = true;
    detail = `threw: ${error.message}`;
  }
  return { name, fired, detail };
}

/** As above for an async evaluator. */
export async function assertGateFiresAsync(name, evaluate) {
  try {
    const result = await evaluate();
    const failures = Array.isArray(result) ? result
      : result && Array.isArray(result.failures) ? result.failures
      : result === false ? ['returned false'] : [];
    return { name, fired: failures.length > 0, detail: failures.join('; ') };
  } catch (error) {
    return { name, fired: true, detail: `threw: ${error.message}` };
  }
}

/**
 * Run a table of must-fail scenarios and one must-pass control.
 *
 * The control matters as much as the failures: a gate that fires on everything is also
 * broken, and it is the easier mistake to make while tightening one.
 *
 * @param {Array<{name: string, evaluate: Function, shouldFire?: boolean}>} cases
 * @returns {{ok: boolean, results: Array, summary: string}}
 */
export async function runGateSelfTests(cases) {
  const results = [];
  for (const { name, evaluate, shouldFire = true, async: isAsync = false } of cases) {
    const outcome = isAsync ? await assertGateFiresAsync(name, evaluate) : assertGateFires(name, evaluate);
    results.push({ ...outcome, shouldFire, ok: outcome.fired === shouldFire });
  }
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    summary: failed.length
      ? `${failed.length}/${results.length} self-tests wrong: ${failed.map((r) => `${r.name} ${r.shouldFire ? 'DID NOT FIRE' : 'FIRED UNEXPECTEDLY'}`).join(', ')}`
      : `${results.length}/${results.length} gate self-tests behaved as specified`,
  };
}

/** Print a self-test table and return false if any case behaved wrongly. */
export async function reportGateSelfTests(cases, { label = 'gate self-tests' } = {}) {
  const { ok, results, summary } = await runGateSelfTests(cases);
  for (const r of results) {
    const mark = r.ok ? 'ok  ' : 'BAD ';
    const verb = r.fired ? 'fired' : 'did not fire';
    console.log(`${mark}${r.name}: ${verb}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`[${label}] ${summary}`);
  return ok;
}
