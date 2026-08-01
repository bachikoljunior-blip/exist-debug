/**
 * mirror.mjs — copy a build to a publication directory, and detect when the copy has rotted.
 *
 * Two of these existed: `game2/tools/sync-pages.mjs` (dist → docs, no drift check at all) and
 * `survival/tools/export_pages_root.mjs` (dist → repo root, with a byte-exact `--check`).
 * The check half is the part worth keeping. A stale mirror is the failure mode that produced
 * `fix: publish game from configured Pages root` — the legacy branch-source deployment
 * overwrote the uploaded artifact with a rendered README, and nothing in the build noticed.
 *
 * Hashed bundle names are handled deliberately: exactly one must exist, and any older one
 * left behind in the destination is an error rather than harmless clutter. A leftover bundle
 * is a second, older copy of the application sitting on the public surface.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function filesMatching(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => pattern.test(name) && statSync(join(dir, name)).isFile())
    .sort();
}

export function sameBytes(left, right) {
  return existsSync(left) && existsSync(right) && readFileSync(left).equals(readFileSync(right));
}

/**
 * Resolve the file set a mirror must contain.
 * @param {object} options
 * @param {string} options.src
 * @param {string[]} [options.files]          Required static files.
 * @param {RegExp} [options.bundlePattern]    Hashed bundle, expected exactly once.
 */
export function resolveMirrorSet({ src, files = [], bundlePattern = null }) {
  for (const name of files) {
    if (!existsSync(join(src, name))) throw new Error(`missing ${src}/${name} — run the build first`);
  }
  let bundle = null;
  if (bundlePattern) {
    const found = filesMatching(src, bundlePattern);
    if (found.length !== 1) throw new Error(`expected exactly one bundle matching ${bundlePattern} in ${src}, found ${found.length}`);
    [bundle] = found;
  }
  return { names: bundle ? [...files, bundle] : [...files], bundle };
}

/**
 * @returns {{ok: boolean, errors: string[], checked: number}}
 */
export function checkMirror({ src, dest, files = [], bundlePattern = null }) {
  const { names, bundle } = resolveMirrorSet({ src, files, bundlePattern });
  const errors = [];
  for (const name of names) {
    if (!sameBytes(join(dest, name), join(src, name))) errors.push(`${name} differs from ${src}/${name}`);
  }
  if (bundlePattern) {
    for (const name of filesMatching(dest, bundlePattern)) {
      if (name !== bundle) errors.push(`obsolete bundle remains in ${dest}: ${name}`);
    }
  }
  return { ok: errors.length === 0, errors, checked: names.length };
}

/**
 * Copy the resolved set, removing stale bundles first.
 *
 * `nojekyll` writes the `.nojekyll` marker. Without it GitHub Pages runs the source through
 * Jekyll, which silently drops every path beginning with an underscore — a class of 404 that
 * looks like a broken build rather than a hosting setting.
 */
export function writeMirror({ src, dest, files = [], bundlePattern = null, nojekyll = true }) {
  const { names, bundle } = resolveMirrorSet({ src, files, bundlePattern });
  mkdirSync(dest, { recursive: true });
  if (bundlePattern) {
    for (const name of filesMatching(dest, bundlePattern)) {
      if (name !== bundle) rmSync(join(dest, name));
    }
  }
  for (const name of names) copyFileSync(join(src, name), join(dest, name));
  if (nojekyll) writeFileSync(join(dest, '.nojekyll'), '');
  return { written: names.length, names };
}

/**
 * Whole-directory replacement, for the `dist/` → `docs/` case where the file list is not
 * fixed. Both paths must be inside the project: never accept an environment-supplied target
 * for something whose first action is a recursive delete.
 */
export function replaceMirror({ src, dest, require: required = ['index.html'] }) {
  for (const name of required) {
    if (!existsSync(join(src, name))) throw new Error(`missing ${src}/${name} — run the build first`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) replaceMirror({ src: from, dest: to, require: [] });
    else copyFileSync(from, to);
  }
  writeFileSync(join(dest, '.nojekyll'), '');
  for (const name of required) {
    if (!existsSync(join(dest, name))) throw new Error(`publication directory is incomplete: ${name} did not arrive`);
  }
  return { dest };
}
