---
name: dispatch
description: Turn a review's findings into the minimal set of parallel agents to spawn — route each finding to the file's owning team, skip teams nothing was filed against and say so out loud, and assemble prompts cache-first. Use when fanning out fixes across a codebase after a review, deciding which agents to run, or when a parallel repair pass needs planning. 並列担当への割り当て・エージェントの起動範囲決めにも使う。
---

# Spawn the owners the review named, and no others

One round dispatched all fourteen owners against roughly six findings. Eight of them read
their files, found nothing to do, and returned — **about 1.6M tokens for zero change**.

The instinct to keep the fan-out wide is right, but it is aimed at the wrong stage. The
independence that makes this method work lives in the **reviewing**: the critic looks at the
whole thing with fresh eyes each round. An owner with no finding against its files has
nothing to be independent about. So the review stays as wide as it ever was, and only the
repair fleet is gated.

```js
import { buildPlan, formatPlan } from './.kit/lib/plan/dispatch.mjs';
import { validateFindings }      from './.kit/lib/plan/findings.mjs';
```

Validate the findings before routing them. Nothing checked this format before and four real
review files had already drifted apart; the router keys on `owner` and `severity`, and a
finding missing either is one nobody will act on.

## Print the skips

`buildPlan` returns `skipped` as well as `dispatch`, and the skips go in the output
prominently — not as a footnote. **A silent gate looks exactly like a gate that is broken and
letting nothing through.** Say which teams were not spawned and why.

`unrouted` is the other half: a finding whose owner no team claims, or whose path no longer
exists, is surfaced for a human to place. Never dropped. A misrouted finding gets bounced
back; an evaporated one is invisible.

## Keep the ownership map honest

`buildPlan` refuses a file claimed by two teams — that is how one source file ended up
assigned to two live agents at once, caught only because the second noticed a write landing
between its read and its edit.

Run `node .kit/tools/check-ownership.mjs --repo=.` alongside it. The dispatcher's team map is
a hand-transcribed copy of the architecture document and nothing had been enforcing the copy:
run against `game2` the first time, it found `src/core/Cinematic.js` and
`src/world/Constants.js` owned in the map and absent from the contract — the second being a
file the project's own instructions call the authoritative source nothing may re-implement.

## Assemble prompts cache-first

Caching is a prefix match, and one changed byte invalidates everything after it. Build every
dispatch prompt in this order:

1. the binding contract, in full, byte-identical every time;
2. the fixed agent preamble, byte-identical every time;
3. the team name and its file list;
4. **last**, the variable tail: round number, findings, dates.

An earlier version put the round number near the top and threw the whole cache away once per
round for nothing.

## Model routing

Top tier at full effort for diagnosis, repair and the critic — every defect that mattered
here was silent, and finding those took reading linked uniforms, ablating a light and
checking a winding order numerically. What drops to a cheap model is only work with one
checkable right answer: histograms, budget counts, table updates, file moves. A wrong answer
there is caught immediately instead of becoming the next round's false premise.

## One agent per team, never two on one file.
