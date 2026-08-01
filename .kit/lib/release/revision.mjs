/**
 * revision.mjs — a self-verifying identity for a published artifact.
 *
 * The trick, from `Gptgame/scripts/artifact-revision.mjs`, is that the revision is the
 * SHA-256 of the document **with the revision field blanked out**. That makes it a fixed
 * point: given the served bytes alone you can recompute the digest and check it against the
 * one embedded in them. No git, no build metadata, no sidecar file, nothing external to
 * trust. If a CDN, a Jekyll pass or a rewrite proxy changes one byte, verification fails on
 * *content* rather than merely on a mismatch against something you wrote down.
 *
 * Of the four public-verification strategies found across the repositories, this was the only
 * one with that property, and the only one that would have caught
 * "README rendered over the published game" without being told what to look for.
 */

import { createHash } from 'node:crypto';

const PLACEHOLDER = '__ARTIFACT_REVISION__';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {object} [options]
 * @param {string} [options.metaName]       Meta tag carrying the digest.
 * @param {string} [options.legacyMetaName] A previous tag name to migrate from, accepted
 *   only when `allowLegacy` is passed. Gptgame needed this to re-stamp historical commits
 *   when building a rollback artifact from `git show <sha>:index.html`.
 */
export function createRevisionCodec({
  metaName = 'artifact-revision',
  legacyMetaName = null,
} = {}) {
  const canonical = (value) => `<meta name="${metaName}" content="${value}">`;
  const pattern = new RegExp(
    `<meta\\s+name="${escape(metaName)}"\\s+content="([0-9a-f]{64}|${escape(PLACEHOLDER)})"\\s*/?>`,
    'i',
  );
  const legacyPattern = legacyMetaName
    ? new RegExp(`<meta\\s+name="${escape(legacyMetaName)}"\\s+content="[0-9a-f]{40,64}|__[A-Z_]+__"\\s*/?>`, 'i')
    : null;

  /** Replace the digest with the placeholder so the hash is stable across stampings. */
  function normalize(source, { allowLegacy = false } = {}) {
    let text = String(source);
    const found = text.match(new RegExp(pattern.source, 'ig')) || [];
    const legacyFound = legacyPattern ? (text.match(new RegExp(legacyPattern.source, 'ig')) || []) : [];

    if (found.length === 0 && legacyFound.length === 1 && allowLegacy) {
      return text.replace(legacyPattern, canonical(PLACEHOLDER));
    }
    if (legacyFound.length) throw new Error(`legacy ${legacyMetaName} metadata is not allowed`);
    // Exactly one. Zero means the artifact cannot be identified; two means a stamp would
    // pick one arbitrarily and the other would silently disagree with it forever.
    if (found.length !== 1) {
      throw new Error(`source must contain exactly one ${metaName} meta tag, found ${found.length}`);
    }
    return text.replace(pattern, canonical(PLACEHOLDER));
  }

  function compute(source, options) {
    return createHash('sha256').update(normalize(source, options)).digest('hex');
  }

  /** @returns {{revision: string, source: string}} the stamped, publishable document. */
  function stamp(source, options) {
    const normalized = normalize(source, options);
    const revision = createHash('sha256').update(normalized).digest('hex');
    return { revision, source: normalized.replace(PLACEHOLDER, revision) };
  }

  /** Recompute from the document itself and require the embedded digest to agree. */
  function verify(source) {
    const match = String(source).match(pattern);
    if (!match) throw new Error(`${metaName} metadata is missing`);
    if (!/^[0-9a-f]{64}$/i.test(match[1])) throw new Error(`${metaName} must be a SHA-256 digest`);
    const expected = compute(source);
    if (match[1].toLowerCase() !== expected) {
      throw new Error(`embedded ${metaName} does not match the document content (embedded ${match[1]}, computed ${expected})`);
    }
    return expected;
  }

  return { PLACEHOLDER, metaName, canonical, normalize, compute, stamp, verify };
}

/** Default codec, byte-compatible with Gptgame's tag name. */
export const revision = createRevisionCodec();
export const { normalize: normalizeArtifactSource, compute: computeArtifactRevision,
  stamp: stampArtifactRevision, verify: verifyArtifactRevision } = revision;
