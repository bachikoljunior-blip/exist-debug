---
name: resume
description: Pick up a project where the last session left it — read the protocol and state files, reconcile them against actual git, runtime and remote state, run the smallest health check, and continue from the recorded stopping point. Also writes the truthful handoff when stopping. Use when asked to continue, resume, carry on, or when a session opens on a project with recorded state. 「続けて」「再開」「引き継ぎ」「今どうなってる」にも使う。
---

# Reconcile before you continue

The recorded state is a claim. Git, the runtime and the remote are the facts. Where they
disagree, **verified reality wins** and both records get corrected — do not continue on a
record you have not checked, and do not quietly overwrite a record that turned out to be
right.

## Read in this order

1. The operating protocol, whatever the repo calls it (`PROJECT_OPERATING_PROTOCOL.md`,
   `AI_DEVELOPMENT/PROTOCOL.md`, or `AGENTS.md` → `START_HERE.md`).
2. The canonical state (`STATE.yaml`, or `PROJECT_STATE` + `SESSION_STATE`).
3. The detailed workstream record the state points at — but only the one it points at.
4. Requirements, criteria, decisions, failures, and the reusable-workflow index.

Then **inspect reality**: current branch, its base ref and SHA, uncommitted changes, the
remote ref, open PRs, whether CI is green, and whether the published surface matches what
the record claims. `git status` and `git log` before any conclusion about where things stand.

## What to reconcile, specifically

- The branch and SHA in the record against the branch and SHA on disk and on the remote. A
  new session often starts on the default branch, so state left only on a feature branch is
  invisible until you look for it.
- Anything the record calls verified, against the evidence file it names. If the evidence is
  not there, it is not verified — downgrade it and say so.
- Anything the record calls pushed, against the actual remote ref. **Never repeat a "pushed"
  claim you have not inspected.**

`lib/state/graph.mjs` does the mechanical half: duplicate ids, dangling references,
dependency cycles, exactly-one-active-task, and `antiFabrication` for criteria marked
verified with no apparatus, no evidence state, or no measured value.

## One record, one owner

The worst failure mode here is not a stale record but two live ones. This project carried
three competing handoff documents, and the duplication cost two sessions independently
solving the same problem. If a second record has started describing the same thing, collapse
it to a pointer rather than keeping both current.

## The session does not end when the reply does

A logical session ends only when a human says so. A reply boundary, a new chat, a closed app,
a tool failure, context compression, or a finished round do not end it. Keep the session
record active and update the exact continuation point after every verified iteration — not
after every action, and not only at the end.

## When you do stop

Write, truthfully:

- branch, local SHA, and pushed SHA (with what you actually inspected on the remote);
- the last verified action and its measurement;
- the single next action;
- the rollback point;
- **the trap the next session would otherwise walk into.**

That last line is the one that pays for the rest. If nothing is pushed, say nothing is
pushed. A handoff that overstates where things stand costs more than no handoff at all.
