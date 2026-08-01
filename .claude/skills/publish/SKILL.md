---
name: publish
description: Build, publish and then prove the public surface actually serves the new build — stamp a content-addressed revision, mirror it to the Pages root, push, fetch the served bytes back, verify they recompute to the expected digest, boot the live URL, and record the evidence. Use when asked to deploy, publish, release, ship, update GitHub Pages, or confirm that a site is live and current. 公開・デプロイ・リリース・Pages更新・公開面の確認にも使う。
---

# A push is not a publication

"The push succeeded" says nothing about what the site serves. Two failures in exactly that
gap are on record in these repositories:

- a Pages race after a state-only `main` update served the previous build;
- a legacy branch-source deployment overwrote the uploaded artifact with a **rendered
  README**, and nothing in the build noticed.

Never name a remote commit as pushed, or a surface as published, until you have inspected it.

## The five steps, in order

```js
import { revision }      from './.kit/lib/release/revision.mjs';
import { writeMirror, checkMirror } from './.kit/lib/release/mirror.mjs';
import { verifyServed }  from './.kit/lib/release/verifyServed.mjs';
import { verifyLive }    from './.kit/lib/release/verifyLive.mjs';
```

1. **Build**, then **stamp**. `revision.stamp(html)` returns the digest and the stamped
   document. The digest is the SHA-256 of the document *with the revision field blanked*, so
   it is a fixed point: the served bytes can be checked against themselves with nothing
   external to trust. The page needs exactly one
   `<meta name="artifact-revision" content="__ARTIFACT_REVISION__">`; zero or two are refused.
2. **Mirror** to the publication root with `writeMirror`, then `checkMirror`. It requires
   exactly one hashed bundle and fails on an obsolete one left behind — a leftover bundle is
   a second, older copy of the application sitting on the public surface.
3. **Push**, and read back the exact ref and SHA that landed.
4. **`verifyServed`** — fetch the public URL with a per-attempt cache-busting nonce and
   `no-store`, require the content markers, and recompute the digest from the served bytes.
   It retries 12 × 5 s because Pages propagation is not instant and a single check is a coin
   flip. This is the step that catches "wrong bytes".
5. **`verifyLive`** — boot the published URL in a real browser and require ready, an
   interaction, and zero errors on all four channels. This catches "right bytes, does not
   run". The two checks are **orthogonal**; a deploy can pass either and fail the other.

Write the result to an evidence file. A verification nobody can re-read is a memory.

## Prove the gate can fail

Before trusting a green publish, make it go red once: change one byte of the served document
and confirm `verifyServed` rejects it. A gate that is silently inert looks exactly like a
gate that is passing — both print nothing and exit 0. Two migrations on record ended with
gates installed but never observed failing, and their state files honestly say
`prepared_not_applied` for that reason.

## Rollback belongs to the same step

Build the rollback artifact from the last known-good revision, re-stamp it, and **run the
test suite against it** before it is ever needed. An untested rollback is a plan, not a
recovery.

## Authorisation

Publishing is outward-facing. Proceed without asking only where the project records standing
authorisation for it — `game2` has that as of 2026-07-31 for pushing verified checkpoints,
integrating to `main` and publishing Pages. Paid, destructive, account, credential and
production-data actions are outside it everywhere. When in doubt, do the build and the local
verification, then ask.

## Report

State the branch, the local and pushed SHA, the served digest you measured, the URL, and
which of the two verifications passed. If one was skipped, say so — do not let a passing
`verifyServed` stand in for a boot that never happened.
