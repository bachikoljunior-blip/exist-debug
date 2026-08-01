/**
 * contentHash.mjs — decide which expensive artefacts actually need regenerating.
 *
 * Generalised from `game2/tools/manifest.mjs`, where it decides which screenshots to
 * re-photograph. Nothing about it is specific to screenshots: it is content-keyed change
 * detection over a declared dependency set, and it applies to anything whose regeneration
 * costs minutes.
 *
 * Two properties are load-bearing and both were paid for:
 *
 * - **Hash by content, never by mtime.** A checkout, a stash pop or a rebase all move mtimes
 *   without changing a byte. An mtime-keyed manifest regenerates everything after any of
 *   them, for nothing.
 * - **A missing dependency hashes as the literal `absent`**, not skipped, so deleting a file
 *   registers as a change rather than as no change.
 *
 * The failure here is asymmetric, and `depsFor` should be written accordingly. Regenerating
 * something unchanged wastes minutes; *carrying forward* something that did change hands the
 * reviewer a stale artefact, and that has already nearly produced a fixed bug being refiled
 * as a regression. When in doubt, list the file.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.root
 * @param {string} options.manifestPath
 * @param {(key: string) => string[]} options.depsFor Repo-relative paths for one artefact.
 *   Return the union of everything for an unknown key — unknown means unsafe.
 * @param {number} [options.hashLength]
 */
export function createContentPlanner({ root, manifestPath, depsFor, hashLength = 16 }) {
  if (!root || !manifestPath || typeof depsFor !== 'function') {
    throw new Error('createContentPlanner: root, manifestPath and depsFor are required');
  }

  /**
   * Two artefacts with identical dependency sets hash identically. That looks alarming next
   * to two visibly different outputs and has been raised as a suspected rig defect; it is
   * harmless. The hash is a change detector **per manifest key**, never an artefact
   * identity, and `plan()` only ever compares a key against itself.
   */
  function hashOf(key) {
    const h = createHash('sha1');
    for (const rel of [...depsFor(key)].sort()) {
      h.update(rel);
      h.update('\0');
      const abs = join(root, rel);
      h.update(existsSync(abs) ? readFileSync(abs) : 'absent');
      h.update('\0');
    }
    return h.digest('hex').slice(0, hashLength);
  }

  function readManifest() {
    if (!existsSync(manifestPath)) return {};
    try { return JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { return {}; }
  }

  function writeManifest(m) {
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  }

  /**
   * Partition wanted keys into carry-forward and must-regenerate.
   * A carried entry must still point at a file that exists: the manifest outlives the
   * artefacts it describes.
   */
  function plan(scope, keys) {
    const m = readManifest();
    const fresh = [];
    const stale = [];
    for (const key of keys) {
      const hash = hashOf(key);
      const prev = m[`${scope}-${key}`];
      if (prev && prev.hash === hash && prev.file && existsSync(prev.file)) {
        fresh.push({ key, hash, from: prev.file, tag: prev.tag ?? null });
      } else {
        stale.push({
          key,
          hash,
          why: !prev ? 'never generated' : prev.hash !== hash ? 'sources changed' : 'previous output is gone',
        });
      }
    }
    return { fresh, stale };
  }

  /** Record immediately per artefact, so a run that dies partway still helps the next one. */
  function record(scope, key, file, tag = null) {
    const m = readManifest();
    m[`${scope}-${key}`] = { hash: hashOf(key), file, tag };
    writeManifest(m);
    return m;
  }

  return { hashOf, readManifest, writeManifest, plan, record };
}

/** Build a `depsFor` from a global list plus per-key extras, with the safe unknown default. */
export function dependencyTable(global, perKey) {
  const everything = [...new Set([...global, ...Object.values(perKey).flat()])].sort();
  return (key) => {
    const extra = perKey[key];
    if (!extra) return everything;
    return [...new Set([...global, ...extra])].sort();
  };
}
