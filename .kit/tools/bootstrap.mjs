#!/usr/bin/env node
/**
 * bootstrap.mjs — install or update this kit inside another repository.
 *
 * Vendoring, deliberately, rather than a submodule or a registry dependency. The sessions
 * these repositories are developed in run in disposable containers with no durable state
 * outside git, so a target repo has to be self-contained: whatever is committed is
 * everything the next session gets. A submodule adds a fetch that can fail; a registry
 * dependency adds a registry.
 *
 * The cost of vendoring is drift, which `KIT_VERSION` and `--check` exist to make loud.
 *
 *   node tools/bootstrap.mjs --target=/path/to/repo
 *   node tools/bootstrap.mjs --target=/path/to/repo --check
 *   node tools/bootstrap.mjs --target=/path/to/repo --skills=probe,publish,critic
 *   node tools/bootstrap.mjs --target=/path/to/repo --template
 *
 * `--template` is a different kind of install and is handled separately on purpose. `.kit/`
 * is vendored and must never be edited in place; `template/` is scaffolding whose entire
 * point is to be edited. So template files are never overwritten, never entered in the
 * ledger, and never reported as drift.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || true];
}));

const target = resolve(String(argv.target || '.'));
const check = Boolean(argv.check);
const version = readFileSync(join(KIT, 'KIT_VERSION'), 'utf8').trim();

if (target === KIT) { console.error('FAIL --target is the kit itself'); process.exit(2); }
if (!existsSync(target)) { console.error(`FAIL target ${target} does not exist`); process.exit(2); }

/**
 * A vendored copy has no copy of the kit to compare itself against, so `--check` from inside
 * a target cannot be an upstream comparison — it would be circular. It verifies the install
 * against the ledger written at install time instead, which still catches the two things a
 * target can actually go wrong by: a file edited in place, and a file lost.
 */
const vendored = !existsSync(join(KIT, '.claude', 'skills'));
const ledgerPath = join(target, '.kit', 'INSTALLED.json');

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Everything the kit installs, as (source, destination) pairs. */
function plannedFiles() {
  const pairs = [];
  const walk = (fromRoot, toRoot, sub = '') => {
    for (const entry of readdirSync(join(fromRoot, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(fromRoot, toRoot, rel);
      else pairs.push([join(fromRoot, rel), join(toRoot, rel)]);
    }
  };

  walk(join(KIT, 'lib'), join(target, '.kit', 'lib'));
  pairs.push([join(KIT, 'tools', 'check-ownership.mjs'), join(target, '.kit', 'tools', 'check-ownership.mjs')]);
  pairs.push([join(KIT, 'tools', 'bootstrap.mjs'), join(target, '.kit', 'tools', 'bootstrap.mjs')]);

  const wanted = argv.skills ? String(argv.skills).split(',') : readdirSync(join(KIT, '.claude', 'skills'));
  for (const name of wanted) {
    const from = join(KIT, '.claude', 'skills', name);
    if (!existsSync(from)) { console.error(`FAIL unknown skill ${name}`); process.exit(2); }
    walk(from, join(target, '.claude', 'skills', name));
  }
  return pairs;
}

/**
 * The protocol/state/CI scaffolding, as (source, destination) pairs.
 *
 * `template/README.md` is documentation *about* the template — the divergence table and the
 * adoption procedure — so it stays in the kit rather than landing in the target.
 */
function plannedTemplateFiles() {
  const from = join(KIT, 'template');
  const pairs = [];
  const walk = (sub = '') => {
    for (const entry of readdirSync(join(from, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (rel !== 'README.md') pairs.push([join(from, rel), join(target, rel)]);
    }
  };
  walk();
  return pairs;
}

/**
 * Install the scaffolding. Existing files are **never** overwritten: a repository that
 * already has a protocol or a state file has one for a reason, and silently replacing it
 * would destroy the only record of where the project actually is.
 */
function installTemplate() {
  if (vendored) {
    console.error('FAIL this is a vendored copy — the template lives in the kit repository.');
    process.exit(2);
  }
  const written = [];
  const skipped = [];
  for (const [from, to] of plannedTemplateFiles()) {
    const rel = relative(target, to);
    if (existsSync(to)) { skipped.push(rel); continue; }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    written.push(rel);
  }
  for (const rel of written) console.log(`  + ${rel}`);
  for (const rel of skipped) console.log(`  = ${rel} already exists — left alone`);
  console.log(`template -> ${target}: ${written.length} file(s) written, ${skipped.length} left alone.`);
  if (written.length) {
    console.log('Next: fill in the placeholders, read template/README.md for the divergence table,');
    console.log('then run `node tools/validate-state.mjs --selftest` and `node tools/validate-state.mjs`.');
  }
}

const stampPath = join(target, '.kit', 'KIT_VERSION');

if (vendored) {
  if (!check) {
    console.error('FAIL this is a vendored copy — it has no kit to install from. Re-run bootstrap from the kit repository.');
    process.exit(2);
  }
  if (!existsSync(ledgerPath)) {
    console.error(`FAIL no install ledger at ${relative(target, ledgerPath)} — re-install from the kit.`);
    process.exit(1);
  }
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const drift = [];
  for (const [rel, expected] of Object.entries(ledger.files)) {
    const path = join(target, rel);
    if (!existsSync(path)) drift.push(`missing ${rel}`);
    else if (digest(path) !== expected) drift.push(`edited in place: ${rel}`);
  }
  const installed = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '(none)';
  if (installed !== ledger.version) drift.push(`KIT_VERSION is ${installed}, ledger says ${ledger.version}`);

  if (drift.length) {
    console.error(`FAIL vendored kit ${ledger.version} has drifted in ${target}:`);
    for (const d of drift) console.error(`  - ${d}`);
    process.exit(1);
  }
  console.log(`vendored kit ${ledger.version} is intact in ${target} (${Object.keys(ledger.files).length} files verified against the install ledger).`);
  console.log('note: this is an integrity check, not a comparison against the kit — run --check from the kit for that.');
  process.exit(0);
}

const pairs = plannedFiles();

if (check) {
  const drift = [];
  for (const [from, to] of pairs) {
    if (!existsSync(to)) drift.push(`missing ${relative(target, to)}`);
    else if (!readFileSync(from).equals(readFileSync(to))) drift.push(`stale ${relative(target, to)}`);
  }
  const installed = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '(none)';
  if (installed !== version) drift.push(`KIT_VERSION is ${installed}, kit is ${version}`);
  // A file the kit no longer ships but the target still carries is drift in the other
  // direction: it keeps working, so nobody notices it is unmaintained.
  const installedLib = join(target, '.kit', 'lib');
  if (existsSync(installedLib)) {
    const expected = new Set(pairs.map(([, to]) => to));
    const stray = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) stray(path);
        else if (!expected.has(path)) drift.push(`orphaned ${relative(target, path)} — the kit no longer ships this`);
      }
    };
    stray(installedLib);
  }

  if (drift.length) {
    console.error(`FAIL kit ${version} is not cleanly installed in ${target}:`);
    for (const d of drift) console.error(`  - ${d}`);
    process.exit(1);
  }
  console.log(`kit ${version} is installed and current in ${target} (${pairs.length} files).`);
  if (argv.template) {
    console.log('note: template/ files are scaffolding meant to be edited, so they are not in');
    console.log('      the ledger and --check says nothing about them.');
  }
  process.exit(0);
}

let written = 0;
let unchanged = 0;
for (const [from, to] of pairs) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) { unchanged += 1; continue; }
  copyFileSync(from, to);
  written += 1;
}

mkdirSync(dirname(stampPath), { recursive: true });
const stamp = `${version}\n`;
const stampChanged = !existsSync(stampPath) || readFileSync(stampPath, 'utf8') !== stamp;
if (stampChanged) writeFileSync(stampPath, stamp);

// The install ledger. It is what lets the target verify its own copy later without needing
// the kit present — `--check` from inside a vendored tree has nothing else to compare to.
const ledger = {
  version,
  files: Object.fromEntries(pairs
    .map(([, to]) => [relative(target, to).split(sep).join('/'), digest(to)])
    .sort(([a], [b]) => a.localeCompare(b))),
};
const ledgerText = `${JSON.stringify(ledger, null, 2)}\n`;
if (!existsSync(ledgerPath) || readFileSync(ledgerPath, 'utf8') !== ledgerText) {
  writeFileSync(ledgerPath, ledgerText);
  written += 1;
}

// A README beside the vendored copy, so the next person does not edit it in place.
const notice = join(target, '.kit', 'README.md');
const noticeText = `# Vendored kit ${version}

Installed by \`node tools/bootstrap.mjs --target=.\` from the kit repository.

**Do not edit anything under \`.kit/\` in place.** Change it in the kit and re-run bootstrap;
\`node .kit/tools/bootstrap.mjs --target=. --check\` fails when this copy has drifted.

Skills live in \`.claude/skills/\` and are loaded by Claude Code automatically.
`;
if (!existsSync(notice) || readFileSync(notice, 'utf8') !== noticeText) {
  writeFileSync(notice, noticeText);
  written += 1;
}

console.log(`kit ${version} -> ${target}: ${written} file(s) written, ${unchanged} already current.`);
if (written === 0 && !stampChanged) console.log('(idempotent: nothing changed)');

// Always after the kit, never instead of it: the template's validator imports from
// `.kit/lib/state/`, so scaffolding without the kit is broken by construction.
if (argv.template) installTemplate();
