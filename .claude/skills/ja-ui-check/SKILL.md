---
name: ja-ui-check
description: Check a Japanese-language UI as it actually renders — text overflowing its box, labels crushed or clipped, elements colliding, untranslated strings, and inconsistent terminology across screens. Drives the real page rather than reading the strings file. Use when reviewing Japanese UI, checking text fit, chasing layout breakage on narrow screens, or auditing wording consistency. 日本語UIの崩れ・はみ出し・重なり・用語ゆれの検査にも使う。
---

# Japanese text breaks layouts that Latin text survives

One repository accumulated twelve separate `probe_ja_*.mjs` scripts — cold boot, dialogue,
examine, HUD, save, end screen, fit — plus a glossary checker and a terminology report.
Another repository's commit log is full of the same class of fix: overlapping place-name
labels, crushed tabs, text that had to be shortened to fit.

None of these are visible in the strings file. They only exist once the text is rendered at a
real viewport, so **drive the page**; do not read the resource bundle and reason about widths.

## What to measure

Use `getBoundingClientRect` and `scrollWidth`/`scrollHeight` against the containing box, per
element, at each viewport you support:

| Symptom | Test |
|---|---|
| **Overflow** | `scrollWidth > clientWidth` on any text node's container |
| **Clipping** | rendered text differs from the source string, or ends in an ellipsis that was not authored |
| **Crushing** | computed font-size below the design floor, or a flex item stuck at `min-content` |
| **Collision** | two labels' rects intersect |
| **Wrap points** | a line broken mid-word — Japanese needs `word-break` / `line-break` and `overflow-wrap` set deliberately, and the browser default is not it |
| **Untranslated** | a Latin-only string on a screen that should be fully localised |

Narrow phone widths and the largest system font scale are where these appear. Test both; a
check at one comfortable viewport proves nothing.

## Terminology

A glossary check is cheap and catches what a visual pass cannot: the same concept named three
different ways across three screens. Extract every user-facing string, group by concept, and
report the divergence. Wording drift is invisible to anyone who has read the strings a hundred
times and obvious to a first-time player.

## Building the check

```js
import { serveStatic }           from './.kit/lib/browser/serve.mjs';
import { launchHeadless }        from './.kit/lib/browser/launch.mjs';
import { attachPageDiagnostics } from './.kit/lib/browser/diagnostics.mjs';
import { waitForBoot }           from './.kit/lib/browser/boot.mjs';
```

Reach each screen through the **production path** — the real navigation, the real touch
handlers — not by setting state directly. A screen posed by assignment can look fine while the
route that reaches it is broken, and the layout you are judging may never occur in play.

Capture a screenshot alongside the numbers. The measurement says a box overflows by 14 px; the
image says whether that reads as broken or as fine.

## Report

Per finding: the screen, the element, the string, the measured overflow or overlap in pixels,
and the viewport it appeared at. "Text is cramped" is not actionable. "`#quest-title` at
390×844: scrollWidth 268 against clientWidth 214, string 「古代の炉に火を入れる」" is.
