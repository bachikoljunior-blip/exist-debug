---
name: probe
description: Write and run a headless-browser measurement against a web app or game — screenshots, pixel/luma statistics, draw-call and triangle budgets, WebGL capability dumps, boot timing. Checks the measurement rig itself before trusting any number it produces. Use when asked to measure, photograph, capture, screenshot, profile, or verify something visually in a running page, or when a claim about rendering needs a number behind it. 計測・実測・スクリーンショット・キャプチャ・ヒストグラム・描画負荷の確認にも使う。
---

# Measure it. Do not assert it.

Almost every defect on these projects was **silent**: no exception, no log, plausible-looking
configuration. Telemetry once read `intensity 3.41, castShadow true, 4 cascades active` while
a pixel measurement showed 0.00% of sunward flagstone carried any warm bias — the key light
was contributing nothing.

So: "it looks better" is not a result. Give the number that moved and how you got it.

## Check the apparatus first — it has broken five times

Every one of these turned a correct critique into a wrong fix:

| Apparatus failure | What it looked like |
|---|---|
| Five rounds reviewed at the wrong quality tier | a passing review |
| Histogram measuring a cleared canvas | a plausible black frame |
| Draw-call counter frozen from a frame that died before rendering | a healthy build |
| Review set mixed across two builds | a fixed bug refiled as a regression |
| A desktop retry erasing the phone baseline | a round with nothing to compare against |

Before sending any number onward, assert: **booted**, **no dead shaders**, **the tier you
asked for**, **one build across the whole set**, **native resolution**. If the run writes a
report, gate on the report — do not eyeball it.

## Building the script

Import from the kit rather than re-writing the boilerplate. Six copies of the static server
and four dialects of the Chromium flags existed before this.

```js
import { serveStatic }            from './.kit/lib/browser/serve.mjs';
import { launchHeadless }         from './.kit/lib/browser/launch.mjs';
import { attachPageDiagnostics }  from './.kit/lib/browser/diagnostics.mjs';
import { waitForBoot }            from './.kit/lib/browser/boot.mjs';
import { acquireLock, releaseOnExit } from './.kit/lib/browser/lock.mjs';
import { measureLuma, regionStats, region, compareRegion } from './.kit/lib/image/measure.mjs';
```

Four things that are not optional:

- **`waitForBoot` polls on a timer, not rAF.** rAF does not tick inside `renderer.compile()`,
  and under SwiftShader that window is long enough that a healthy page looks hung.
- **Take the rig lock, and take it lazily.** SwiftShader saturates one thread, so two runs
  starve each other — a 200 s boot was measured at 639 s under contention, past its own
  timeout, producing nothing. A run with nothing to do must not queue for permission to do
  nothing.
- **Measure the saved PNG, not the canvas.** The WebGL context has
  `preserveDrawingBuffer: false`, so reading the canvas outside the paint window yields a
  cleared buffer and every shot reports pure black. `lib/image` decodes PNGs with no
  dependencies and no browser.
- **Watch all four channels** — console, pageerror, requestfailed, HTTP ≥ 400. A tool that
  only listens for `pageerror` reports a clean pass on a run whose assets 404.

## Reading the result

- **Judge at native resolution.** A downscaled view already produced "no cast shadows
  anywhere" against a frame that plainly had them.
- **Before and after, same region.** `compareRegion` labels a byte-identical result for you:
  it means the branch you edited does not draw those pixels. That is a failed edit, not a
  subtle one.
- **State the box.** `regionStats` returns `box`, `meanRGB`, `bOverR`, `lumaSpread` and
  `detail` (mean |Laplacian|) so a finding reads as evidence: not "the shadow is too warm"
  but "shaded facade (760,515,127,47) meanRGB [47.7,35.2,27.6], bOverR 0.58 against a 1.30
  target".
- **Never quote fps from SwiftShader.** It is software rendering. Use draw calls, triangles,
  program count, and CPU step cost.

## Before you finish

Say which apparatus checks you ran. A measurement whose rig was not checked is a claim, and
this project has been burned by five of them.
