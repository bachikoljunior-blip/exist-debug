---
name: balance-audit
description: Audit a game's numeric economy by simulating headless play policies rather than reasoning about the formulas — detect dead upgrades, collapsed cost ladders, saturated or NaN values, dead currencies, and unreachable content, and report the pass rate per policy. Use when asked about game balance, progression pacing, whether an upgrade is worth taking, economy tuning, or why progress stalls. バランス調整・経済設計・進行の詰まり・死に要素の洗い出しにも使う。
---

# Simulate the play, do not reason about the formula

An economy is an emergent system. Reading the cost table tells you what a purchase costs, not
whether anyone would ever make it. The audits that found real defects here all worked the
same way: define several play **policies**, run each for many simulated hours, and report per
policy.

One project ran 16 policies for 400 simulated hours to establish that unlock intervals stayed
above 30 seconds and every run beat its predecessor. That result could not have been derived
from the parameters; several plausible-looking fixes were measured as no-ops and reverted.

## The defect classes worth hunting

These recur, and every one was found by measurement rather than inspection:

| Defect | Real instance |
|---|---|
| **Collapsed cost ladder** | the top 8 research costs had all been flattened to the same `1.00e+90` placeholder while their effects ranged ×1.03 to ×280 |
| **Dead upgrade** | a bonus added outside the drop formula, so one craft erased the material economy |
| **Dead currency** | prestige points ran out of sinks at 1.55e9 total; from run 97 onward the currency is permanently unspendable |
| **Numeric saturation** | production saturating to `Infinity` at ~1.79e308 while the cookie counter stayed unbounded — production simply stops |
| **NaN leak** | one `NaN` multiplier made every facility free; `typeof NaN === 'number'` and `clamp()` passes it straight through |
| **Timer masquerading as a goal** | a "reach-linked" quota where the terms cancelled, making it purely a function of elapsed time |
| **Reversed tier costs** | stage 2 costing more than stage 3 |

## How to run one

1. **Write the policies, not one bot.** A single optimal player hides everything a hoarder, a
   rusher or a specialist would hit. Give each policy an explicit behaviour model.
2. **Run long.** The failures above appear at run 97, or at 1e90, or after 60 hours. A
   ten-minute sample proves nothing about the shape of the curve.
3. **Report per policy, not in aggregate.** "16/16 policies reach full unlock" is a result;
   "average progress is healthy" is not.
4. **Sweep, then fix, then re-measure.** Keep the sweep scripts — they are how you show a fix
   moved the number rather than looked like it should.
5. **Port the fix, then verify the port.** One project tuned in the simulator and shipped the
   game separately; the checklist of every parameter, cost table and mechanism that had to
   cross over is the reason the two did not diverge.

## Report the number, not the impression

"Upgrades feel better now" is not a result. "Dead effects: 0 of 199, measured by comparing
each effect's marginal value against its cost at the run length where it unlocks" is.

State what the simulation cannot see: input feel, readability, whether the numbers are *fun*.
A balanced economy and a good game are different claims.
