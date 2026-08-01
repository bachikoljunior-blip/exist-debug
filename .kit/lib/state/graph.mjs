/**
 * graph.mjs — integrity checks for a plan/task graph held in a state file.
 *
 * `game2` checks unique ids and four referential relations but has no cycle detector;
 * `survival` has the only cycle detector in the survey but checks fewer relations. Both are
 * here. A dependency cycle is worth catching precisely because it is invisible: the state
 * file reads fine, and the resume procedure simply never selects a next task.
 */

export function uniqueIds(items, label = 'item') {
  const failures = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id) {
      failures.push(`every ${label} needs a non-empty id`);
      continue;
    }
    if (seen.has(item.id)) failures.push(`duplicate ${label} id ${item.id}`);
    seen.add(item.id);
  }
  return { failures, ids: seen };
}

/**
 * Every value of `field` must resolve to a known id.
 * @param {object} options
 * @param {boolean} [options.allowSelf] Reject self-reference unless explicitly allowed.
 */
export function checkRefs(items, field, ids, { label = 'item', allowSelf = false } = {}) {
  const failures = [];
  for (const item of items) {
    const raw = item?.[field];
    if (raw === null || raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (!ids.has(value)) failures.push(`${label} ${item.id} has missing ${field} ${value}`);
      if (!allowSelf && value === item.id) failures.push(`${label} ${item.id} references itself via ${field}`);
    }
  }
  return failures;
}

/** Depth-first cycle detection that reports the trail, not just the fact. */
export function detectCycles(items, field = 'dependencies') {
  const byId = new Map(items.filter((i) => i?.id).map((i) => [i.id, i]));
  const failures = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (id, trail = []) => {
    if (visiting.has(id)) { failures.push(`dependency cycle: ${[...trail, id].join(' -> ')}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const raw = byId.get(id)?.[field];
    for (const next of Array.isArray(raw) ? raw : raw ? [raw] : []) visit(next, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };

  for (const item of items) if (item?.id) visit(item.id);
  return failures;
}

/**
 * Exactly one item may hold a status. Two active tasks means two sessions believe they own
 * the work; zero means the resume procedure has nothing to continue from.
 */
export function exactlyOne(items, predicate, label) {
  const hits = items.filter(predicate);
  return hits.length === 1 ? [] : [`exactly one ${label} is required; found ${hits.length}`];
}

/** Every value of `field` must name a path that exists. Evidence that is not there is not evidence. */
export function evidenceExists(items, field, exists, { label = 'task' } = {}) {
  const failures = [];
  for (const item of items) {
    for (const path of item?.[field] || []) {
      if (typeof path !== 'string' || !exists(path)) failures.push(`${label} ${item.id} ${field} path does not exist: ${path}`);
    }
  }
  return failures;
}

/**
 * A criterion marked verified must carry real evidence.
 *
 * This is the single most valuable rule in any of the four validators
 * (`game2/tools/validate-project-state.mjs:216-220`) because it is the one that stops a
 * status field from being upgraded by assertion. Without it "verified" costs nothing to
 * write.
 *
 * The field names are options because the repositories disagree on case, and a hard-coded
 * `c.evidenceState` reading a snake_case state file finds `undefined` — which is in
 * `emptyEvidence`, so the check appears to work while actually never inspecting the field.
 * That is this kit's own failure mode, found by running the gate against real template state.
 */
export function antiFabrication(criteria, {
  verifiedStatus = 'verified',
  emptyEvidence = ['none', '', null, undefined],
  missingApparatus = ['missing', '', null, undefined],
  label = 'criterion',
  evidenceField = 'evidenceState',
  apparatusField = 'apparatus',
  measuredField = 'measured',
} = {}) {
  const failures = [];
  for (const c of criteria) {
    if (c?.status !== verifiedStatus) continue;
    const evidence = c[evidenceField];
    const apparatus = c[apparatusField];
    const measured = c[measuredField];
    if (emptyEvidence.includes(evidence)) failures.push(`${label} ${c.id} is ${verifiedStatus} with ${evidenceField} ${JSON.stringify(evidence)}`);
    if (missingApparatus.includes(apparatus)) failures.push(`${label} ${c.id} is ${verifiedStatus} with ${apparatusField} ${JSON.stringify(apparatus)}`);
    if (measured === null || measured === undefined || String(measured).trim() === '') {
      failures.push(`${label} ${c.id} is ${verifiedStatus} with no ${measuredField} value`);
    }
  }
  return failures;
}
