---
name: bootstrap
description: Install or update the shared development kit inside a repository — the measurement harness, release verification, state gates, and the skills that use them. Also checks whether an already-installed copy has drifted from the kit. Use when setting up a new repository, when a repo should gain the shared tooling or skills, or when asked whether a repo's vendored kit is current. 新しいリポジトリの初期設定・キットの導入と更新・ドリフト確認にも使う。
---

# Install the kit into a repository

Sessions here run in disposable containers: `~/.claude/` is rebuilt every time and nothing
outside git survives. So the tooling has to travel **in the repository**, and this is how it
gets there.

```bash
node tools/bootstrap.mjs --target=/path/to/repo            # install or update
node tools/bootstrap.mjs --target=/path/to/repo --check    # is it current?
node tools/bootstrap.mjs --target=/path/to/repo --skills=probe,publish   # a subset
node tools/bootstrap.mjs --target=/path/to/repo --template # + protocol, state and CI
```

What lands:

```
.kit/lib/…              vendored modules (browser, image, release, state, plan)
.kit/tools/…            check-ownership, bootstrap itself
.kit/KIT_VERSION        the version stamp --check compares against
.claude/skills/…        the skills, loaded by Claude Code automatically
```

Vendored on purpose rather than a submodule or a registry dependency: whatever is committed
is everything the next session gets, and a fetch that can fail is a session that starts
broken. The cost is drift, which is what `KIT_VERSION` and `--check` exist to make loud.

## After installing

1. **Run `--check`.** It must pass immediately. Then run it twice — the second install must
   report `idempotent: nothing changed`. An installer that is not idempotent cannot be put in
   CI.
2. **Wire `--check` into CI**, next to the other gates. A vendored copy nobody verifies is a
   fork nobody declared.
3. **Do not edit anything under `.kit/` in place.** Change it in the kit and re-install;
   `--check` reports an in-place edit as `stale`, and an orphaned file the kit no longer
   ships as `orphaned`.

## Adding a repository that has no protocol yet

Three of the eight repositories have no operating protocol, no state files and no CI at all.
Installing the kit gives them the tooling but not the discipline. `--template` adds the
scaffolding: a product-neutral `PROJECT_OPERATING_PROTOCOL.md`, `AI_DEVELOPMENT/` with two
YAML state files and the decision and failure ledgers, `tools/validate-state.mjs`, and CI
that runs the gates *and proves they can fail* before running them.

`--template` behaves differently from the rest of the installer, deliberately:

- **It never overwrites.** A file that already exists is left alone and named in the output,
  so the output is the reconciliation list. A repository that already has a protocol has one
  for a reason.
- **It is not in the ledger and `--check` says nothing about it.** `.kit/` is vendored and
  must not be edited in place; the template exists to be edited. Reporting an edited template
  file as drift would train people to ignore drift.
- **It always installs alongside the kit, never instead of it.** `tools/validate-state.mjs`
  imports from `.kit/lib/state/`.

**Read `template/README.md` before adopting it.** The existing repositories genuinely
disagree on fifteen points and the template settles each one, with the cost recorded. Three
will bite: state files become real YAML with snake_case keys; `review_outcome` must be
`complete_verified`, so one of the two existing floor gates fails until its state file is
updated; and CI pins Node 22, because `.kit/` needs `node:fs.globSync` and one repository's
CI pins 20 and therefore cannot run the kit it has installed.

Expect the first `node tools/validate-state.mjs` against real state to fail. It normally
finds a criterion marked verified with no apparatus, a dependency naming a task id that no
longer exists, or an evidence path that was deleted.

## Before you report success

Say which files changed, whether `--check` passes, and whether the second run was clean.
"Installed" means `--check` exited 0 and you saw it. With `--template`, add: the placeholder
state validates, and `node tools/validate-state.mjs --selftest` reported every case behaving
as specified — including the control, which must *not* fire.
