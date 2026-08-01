---
name: critic
description: Run an independent, hostile review of work against a named quality bar, then have a second pass try to refute each finding so only survivors are reported. Separates observed symptom from proposed mechanism, requires evidence per finding, and writes results to disk as structured JSON. Use when asked to critique, review, audit, judge, or find what is wrong with something — code, a build, a design, art, or game balance. 批評・レビュー・監査・指摘出し・反証にも使う。
---

# Default verdict: FAIL

Three of these repositories independently invented the same thing, which is the strongest
evidence it is right: a hostile independent reviewer, then a **separate** pass that tries to
refute each finding, keeping only what survives.

Two rules make it work, and both are non-negotiable:

- **The author never judges their own work.** Independence is the whole mechanism.
- **A finding without evidence is not a finding.** One repository's checker discards any
  entry whose evidence or recommended-action column is empty, and it is right to.

Do not be encouraging. Do not praise what is merely competent. Do not grade on a curve of
"this is impressive for the constraints" — the person receiving the work does not know or
care about the constraints.

## Symptom and mechanism are not the same claim

Across the measured rounds on these projects the critic's **symptom** calls were right 6 out
of 6, and its **mechanism** guesses were wrong 4 out of 4. One unverified mechanism —
"raise the god-ray weight 4–6×" — was acted on and made the result worse. Another round
shipped a fix the next round measured as a no-op and reverted.

So every finding separates:

- `problem` — what is observably wrong, with the measurement.
- `hypothesis` — why you think it happens. **Labelled, and never acted on until disproved
  or confirmed.** Reporting a disproof is a result worth as much as a fix: it stops the next
  round building on a wrong cause.

## The blind comparison

The central question, for anything with a quality bar: *shown unlabelled beside the
reference, which would a stranger pick, and why?* Name the specific reason. "Looks less
detailed" is not a reason; "the shadow terminator is a hard line with no contact softening,
so every object looks pasted onto the ground" is.

If you are comparing from memory, **say so**, and never write it up as a measured comparison.

## Scope honestly

Say what the evidence you were given cannot judge. Five still frames cannot see combat feel,
animation, camera behaviour, touch or audio; a code read cannot see runtime behaviour. File
those as observations against the element they belong to, and do not pass or fail them. A
passing review of one element is not a passing product.

## Output

Write JSON to disk — never relay findings through the coordinator's reply, which pays for
the same text three times. Validate before anything consumes it:

```js
import { validateFindings } from './.kit/lib/plan/findings.mjs';
validateFindings(review, { strict: true, knownOwners });
```

Required per finding: `severity` (blocker|major|minor), `shot`, `problem`, `why`, `owner`
(the repo-relative path that owns the fix), `fix` (a verifiable target — the number and the
command that reads it). Plus `hypothesis` where you have one. Top level needs `verdict`,
`score`, `blindComparison`, and — for a new round — `round`, `profile`, `tier`,
`nativeResolution`.

That last group is not bookkeeping. Nothing validated this format before, and four real
review files had already drifted apart without anyone noticing.

## The refutation pass

Hand each finding to someone who did not write it, with the instruction to **refute** it.
Keep it only if refutation fails. Where a finding could be wrong in more than one way, give
each refuter a different lens — correctness, reproducibility, whether it matters — rather
than three identical attempts.
