#!/usr/bin/env node
/**
 * check-ownership.mjs — fail when the dispatcher's team map and the architecture document
 * have drifted apart.
 *
 * Run against game2 the first time, this found two real drifts that nothing had noticed:
 * `src/core/Cinematic.js` and `src/world/Constants.js` are both owned in
 * `tools/dispatch.mjs` and both absent from `ARCHITECTURE.md` §8. The second matters most —
 * `CLAUDE.md` names `src/world/Constants.js` as the authoritative source nothing may
 * re-implement, and it is not in the binding ownership contract.
 *
 * The consequence is quiet either way: a file in the document but not the map sends its
 * findings to `unrouted`, where a human has to place them; a file in the map but not the
 * document keeps a team alive that the contract does not recognise.
 *
 *   node tools/check-ownership.mjs --repo=/path/to/repo
 *   node tools/check-ownership.mjs --repo=. --heading='## 8. Files and ownership'
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkOwnershipDrift, extractFencedBlock, parseOwnershipTree } from '../lib/plan/ownership.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || true];
}));

const repo = resolve(String(argv.repo || '.'));
const docPath = join(repo, String(argv.doc || 'ARCHITECTURE.md'));
const mapPath = join(repo, String(argv.map || 'tools/dispatch.mjs'));
const heading = String(argv.heading || '## 8. Files and ownership');

if (!existsSync(docPath)) { console.error(`FAIL missing ${docPath}`); process.exit(2); }
if (!existsSync(mapPath)) { console.error(`FAIL missing ${mapPath}`); process.exit(2); }

const doc = parseOwnershipTree(extractFencedBlock(readFileSync(docPath, 'utf8'), { heading }));
if (doc.untagged.length) {
  console.error(`FAIL ${doc.untagged.length} file(s) in the contract carry no owner tag:`);
  for (const f of doc.untagged) console.error(`  - ${f}`);
  process.exit(1);
}

// Read the map without executing the module: importing a CLI runs its `main`.
const source = readFileSync(mapPath, 'utf8');
const marker = String(argv.symbol || 'const TEAMS = ');
const start = source.indexOf(marker);
if (start < 0) { console.error(`FAIL ${mapPath} has no ${marker.trim()} literal`); process.exit(2); }
const body = source.slice(start + marker.length);
const literal = body.slice(0, body.indexOf('\n};') + 2);

let teams;
try {
  teams = JSON.parse(literal
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1'));
} catch (error) {
  console.error(`FAIL cannot parse the team map literal: ${error.message}`);
  process.exit(2);
}

const { ok, failures } = checkOwnershipDrift(teams, doc.teams);
const counts = `${Object.values(teams).flat().length} mapped file(s) vs ${doc.files.size} in the contract`;
if (!ok) {
  console.error(`FAIL ownership drift (${counts}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Ownership map matches ${argv.doc || 'ARCHITECTURE.md'} ${heading} (${counts}).`);
