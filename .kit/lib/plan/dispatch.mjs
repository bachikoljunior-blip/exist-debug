/**
 * dispatch.mjs — turn a review verdict into the exact, minimal set of agents to spawn.
 *
 * The measured problem: one round's critic named about six areas, fourteen owners were
 * spawned anyway, and roughly eight read their files, found nothing to do and returned —
 * about 1.6M tokens for zero change to the artefact.
 *
 * The instinct to keep the fan-out wide is right but aimed at the wrong stage. The
 * independence that makes the method work lives in the **reviewing**: the critic looks at
 * the whole thing with fresh eyes each round. An owner with no finding against its files has
 * nothing to be independent about. So the review stays as wide as it ever was and only the
 * repair fleet is gated.
 *
 * Generalised from `game2/tools/dispatch.mjs`; the team map and the model routing are inputs.
 */

export const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 };

/**
 * Default routing. The split is not "cheap where we can get away with it" — it follows the
 * line these projects measured. Every defect that mattered was silent: correct-looking
 * config, no exception, no log. Finding those meant reading linked uniforms, ablating a
 * light, checking a winding order numerically. That work stays at the top tier.
 *
 * What drops is work whose answer is already determined and merely needs computing — a
 * histogram, a triangle count, a table. Those have a checkable right answer, so a wrong one
 * is caught immediately instead of becoming the next round's false premise.
 */
export const DEFAULT_ROUTING = {
  critic: { model: 'opus', effort: 'high', why: 'the perceptual judgement the whole method rests on' },
  owner: { model: 'opus', effort: 'high', why: 'silent defects; diagnosis is the expensive part' },
  measure: { model: 'haiku', effort: 'low', why: 'numbers with one right answer, independently checkable' },
  scribe: { model: 'haiku', effort: 'low', why: 'mechanical collation, no judgement' },
};

/** `{team: [files]}` → `Map<file, team>`, rejecting a file claimed by two teams. */
export function invertOwnership(teams) {
  const ownerOf = new Map();
  const conflicts = [];
  for (const [team, files] of Object.entries(teams)) {
    for (const file of files) {
      if (ownerOf.has(file)) conflicts.push(`${file} is claimed by both ${ownerOf.get(file)} and ${team}`);
      ownerOf.set(file, team);
    }
  }
  // Two teams sharing a file is how one source file ended up assigned to two live agents at
  // once, caught only because the second noticed a write landing between its read and edit.
  if (conflicts.length) throw new Error(`ownership conflict: ${conflicts.join('; ')}`);
  return ownerOf;
}

/**
 * @param {object} review           Parsed `review-rN.json`.
 * @param {object} options
 * @param {object} options.teams    `{team: [files]}`.
 * @param {object} [options.routing]
 * @param {(path: string) => boolean} [options.fileExists] Injected so this stays pure/testable.
 * @returns {{dispatch: object[], skipped: string[], unrouted: object[]}}
 */
export function buildPlan(review, { teams, routing = DEFAULT_ROUTING, fileExists = () => true } = {}) {
  if (!teams) throw new Error('buildPlan: teams is required');
  const ownerOf = invertOwnership(teams);
  const byTeam = new Map();
  const unrouted = [];

  for (const finding of review?.findings || []) {
    const owner = String(finding.owner || '').replace(/^\.\//, '');
    const team = ownerOf.get(owner);
    // An unknown owner, or a path that no longer exists, is surfaced — never dropped. A
    // finding that quietly evaporates is worse than one misrouted: misrouted gets bounced
    // back, evaporated is invisible.
    if (!team || !fileExists(owner)) {
      unrouted.push({
        ...finding,
        reason: !team ? `no team owns ${owner || '(blank)'}` : `${owner} does not exist`,
      });
      continue;
    }
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push({ ...finding, owner });
  }

  const rank = (s) => SEVERITY_RANK[s] ?? 3;
  const dispatch = [...byTeam.entries()].map(([team, findings]) => {
    findings.sort((a, b) => rank(a.severity) - rank(b.severity));
    return {
      team,
      role: 'owner',
      ...routing.owner,
      files: [...new Set(findings.map((f) => f.owner))],
      findings: findings.length,
      blockers: findings.filter((f) => f.severity === 'blocker').length,
      worst: findings[0]?.severity ?? 'minor',
      summary: findings.map((f) => `${f.shot}: ${f.problem}`.slice(0, 110)),
    };
  }).sort((a, b) => rank(a.worst) - rank(b.worst));

  return { dispatch, skipped: Object.keys(teams).filter((t) => !byTeam.has(t)), unrouted };
}

/**
 * Human-readable plan. The skip list is printed prominently on purpose: a silent gate looks
 * exactly like a gate that is broken and letting nothing through.
 */
export function formatPlan({ dispatch, skipped, unrouted }, { round, verdict, score, findings, perAgentTokens = 200 } = {}) {
  const out = [];
  out.push(`round ${round ?? '?'}: ${verdict ?? '?'}, score ${score ?? '?'}, ${findings ?? '?'} findings`, '');
  if (!dispatch.length) out.push('nothing to dispatch — no finding routes to an owned file.');
  for (const d of dispatch) {
    out.push(`spawn  ${d.team.padEnd(10)} ${d.model}/${d.effort}  ${d.findings} finding(s), ${d.blockers} blocker(s)`);
    for (const s of d.summary) out.push(`         · ${s}`);
    out.push(`         files: ${d.files.join(', ')}`);
  }
  out.push('', `not spawned (no finding against their files): ${skipped.join(', ') || '(none)'}`);
  out.push(`  ~${(skipped.length * perAgentTokens).toLocaleString()}k tokens not spent on agents that would have reported "nothing to do"`);
  if (unrouted.length) {
    out.push('', 'UNROUTED — the coordinator must place these by hand:');
    for (const u of unrouted) out.push(`  · [${u.severity}] ${u.shot}: ${u.problem} (${u.reason})`);
  }
  return out.join('\n');
}
