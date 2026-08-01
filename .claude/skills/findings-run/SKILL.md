---
name: findings-run
description: Work through a numbered list of reported issues one at a time — one commit per finding, each message naming the number that moved, bisecting any regression down to the single finding that caused it and recording the retraction. Use when handed a list of bugs, an issue table, a review's findings, or an audit report to fix. 指摘一覧・課題リスト・レビュー結果の消化にも使う。
---

# One finding, one commit

Nineteen of one repository's sixty-one commits are `一覧#N: …` — a numbered issue list worked
through one entry at a time. That discipline is why, when a fix later turned out to be wrong,
it could be bisected to a single entry and retracted without unpicking anything else:

> `一覧#5の修正を撤回する（原因は二分法で#5単独と確定）`

That is the shape to reproduce.

## The loop

1. **Take the next finding by severity**, not by ease. Blockers poison everything under them.
2. **Reproduce it first.** A finding you cannot reproduce is either fixed already, mis-stated,
   or about a different build — all three are results worth reporting, and none is a fix.
3. **Disprove the mechanism before building on it.** Where the report separates `problem` from
   `hypothesis`, the hypothesis is a guess: on this project symptom calls held 6/6 and
   mechanism guesses failed 4/4. Confirm or rule it out, and **report the disproof** — ruling
   out a wrong cause stops the next round rebuilding around it.
4. **Fix, then measure the same thing the finding measured.** A byte-identical number means
   the branch you edited does not run, not that the change was subtle.
5. **Commit alone.** Stage the exact paths you changed — never `git add -A`, which once swept
   three owners' work into a commit whose message named one system. The message names the
   measurement that moved: `Ground roughness floor 0.569 -> 0.129 (cobble)`, not
   `improve ground materials`.
6. **Drop it from the list**, and keep a short "already fixed" section so nobody re-reports it.

## When a fix causes a regression

Bisect to the single finding. Do not revert the batch, and do not guess which one it was —
the retraction commit should be able to say *how* it was established. Then record the
retraction in the list itself with the reason, because a finding that was fixed and then
un-fixed will otherwise be re-found and re-fixed by someone else.

## What belongs in the list, and what does not

Separate three kinds of entry, because they need different people:

- **Confirmed defects** — reproduced, with the measurement and the location.
- **Policy decisions** — where the code is doing what it says and the question is whether it
  should. These need the owner's judgement first; implementing one as a bug is how a
  deliberate design gets silently reverted.
- **Already fixed** — kept visible so the list stays trustworthy.

A good report says what it did *not* verify. "Read the code and calculated the real numbers,
but did not verify in actual play" is an honest and useful statement; leaving it out turns a
calculation into a claim about the game.
