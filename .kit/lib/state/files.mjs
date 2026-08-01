/**
 * files.mjs — the required-file and required-text assertions every state validator needs.
 *
 * Four validators (`game2/tools/validate-project-state.mjs`,
 * `survival/tools/check_operating_state.mjs`, `Gptgame/scripts/verify-continuity.mjs`,
 * `Q/tools/validate-protocol.mjs`) each open with their own copy of this. They do the same
 * three things: a file must exist, a document must stay short, a document must contain a
 * marker.
 *
 * The byte ceiling is not fussiness. A loader document that grows past a few kilobytes stops
 * being read as a loader; enforcing the size is how "concise" survives contact with six
 * months of additions.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function requireFiles(root, list) {
  const failures = [];
  for (const name of list) {
    const path = join(root, name);
    try {
      if (!statSync(path).isFile()) failures.push(`${name} is not a file`);
    } catch {
      failures.push(`missing ${name}`);
    }
  }
  return failures;
}

export function requireNonEmpty(root, list) {
  const failures = [];
  for (const name of list) {
    const path = join(root, name);
    if (!existsSync(path)) { failures.push(`missing ${name}`); continue; }
    if (readFileSync(path, 'utf8').trim().length === 0) failures.push(`${name} is empty`);
  }
  return failures;
}

/** @param {Record<string, number>} ceilings `{ 'START_HERE.md': 7000 }` */
export function requireByteCeiling(root, ceilings) {
  const failures = [];
  for (const [name, limit] of Object.entries(ceilings)) {
    const path = join(root, name);
    if (!existsSync(path)) { failures.push(`missing ${name}`); continue; }
    const size = statSync(path).size;
    if (size > limit) failures.push(`${name} is ${size} bytes, over its ${limit}-byte ceiling`);
  }
  return failures;
}

/**
 * Markers may be strings or RegExps. Use this for structural contracts — floor item
 * headings, section numbers, vocabulary tokens — not for prose.
 */
export function requireContains(root, name, markers) {
  const path = join(root, name);
  if (!existsSync(path)) return [`missing ${name}`];
  const text = readFileSync(path, 'utf8');
  const failures = [];
  for (const marker of markers) {
    const hit = marker instanceof RegExp ? marker.test(text) : text.includes(marker);
    if (!hit) failures.push(`${name} is missing ${marker instanceof RegExp ? String(marker) : JSON.stringify(marker)}`);
  }
  return failures;
}

export function requireAbsent(root, name, markers) {
  const path = join(root, name);
  if (!existsSync(path)) return [`missing ${name}`];
  const text = readFileSync(path, 'utf8');
  const failures = [];
  for (const marker of markers) {
    const hit = marker instanceof RegExp ? marker.test(text) : text.includes(marker);
    if (hit) failures.push(`${name} must not contain ${marker instanceof RegExp ? String(marker) : JSON.stringify(marker)}`);
  }
  return failures;
}
