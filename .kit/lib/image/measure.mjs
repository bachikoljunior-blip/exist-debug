/**
 * measure.mjs — make a claim about an image against the image.
 *
 * "It looks better" is not a result. These functions produce the number that moved and the
 * box it was read from, so a finding can be written as evidence rather than as an opinion.
 *
 * Two rules the callers keep getting wrong:
 *
 * - **Measure at native resolution.** A downscaled view already caused "no cast shadows
 *   anywhere" to be filed as a blocker against a frame that plainly had them.
 * - **Byte-identical before/after means the branch you edited does not draw those pixels.**
 *   It does not mean the change was subtle. Treat an unmoved number as a failed edit until
 *   an ablation proves the apparatus is live.
 *
 * Merged from `game2/tools/luma.mjs` (percentiles, masking) and `game2/tools/probe.mjs`
 * (region stats, Laplacian detail), plus the warm/cool counters and IQR that only
 * `survival/tools/lumastats.mjs` had.
 */

import { readFileSync } from 'node:fs';
import { decodePNG } from './png.mjs';

const REC709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Load a PNG path or pass through an already-decoded image. */
export function loadImage(source) {
  return typeof source === 'string' ? decodePNG(readFileSync(source)) : source;
}

/**
 * Rec.709 luma percentiles over a whole frame.
 *
 * `exclude` masks screen-space rectangles in **fractional** coordinates. Mask the HUD: it is
 * authored ink on near-black, and left in it supplies the "true blacks" the grade is being
 * judged on — the check then passes for the wrong reason.
 *
 * `ignoreTransparent` skips near-invisible pixels. It is a no-op on a **fully opaque** frame
 * — which `page.screenshot()` produces unless you pass `omitBackground` — and it is the
 * difference between a real number and a meaningless one anywhere alpha is doing work.
 * Measured on `08_upgrade_finger.png` (512×512, 142,367 of 262,144 pixels transparent):
 * counting the surround reports p50 0, skipping it reports p50 113. The first number
 * describes the padding, not the artwork, and nothing about it looks wrong.
 *
 * @param {string|object} source PNG path, or a decoded image.
 * @param {Array<{x:number,y:number,w:number,h:number}>} [exclude]
 * @param {object} [options]
 * @param {boolean} [options.ignoreTransparent]
 * @param {number}  [options.alphaFloor]
 */
export function measureLuma(source, exclude = [], { ignoreTransparent = true, alphaFloor = 8 } = {}) {
  const { width, height, channels, data } = loadImage(source);
  const hist = new Uint32Array(256);
  const hasAlpha = channels === 4;
  let n = 0, warm = 0, cool = 0, transparent = 0;

  const boxes = exclude.map((e) => ({
    x0: e.x * width, x1: (e.x + e.w) * width,
    y0: e.y * height, y1: (e.y + e.h) * height,
  }));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let masked = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) { masked = true; break; }
      }
      if (masked) continue;
      const p = (y * width + x) * channels;
      if (hasAlpha && ignoreTransparent && data[p + 3] < alphaFloor) { transparent++; continue; }
      const R = data[p], G = data[p + 1], B = data[p + 2];
      hist[REC709(R, G, B) | 0]++;
      // A frame where key and fill sit at one temperature reads as amateur before a viewer
      // consciously notices anything. The ±6 threshold is survival/tools/lumastats.mjs:38-39.
      if (R - B > 6) warm++; else if (B - R > 6) cool++;
      n++;
    }
  }
  if (!n) throw new Error('measureLuma: every pixel was masked or transparent');

  const at = (frac) => {
    let acc = 0;
    const target = n * frac;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  let below = 0, above = 0;
  for (let v = 0; v < 16; v++) below += hist[v];
  for (let v = 241; v < 256; v++) above += hist[v];
  const p25 = at(0.25), p75 = at(0.75);

  return {
    width, height, samples: n,
    p01: at(0.001), p1: at(0.01), p10: at(0.10), p25, p50: at(0.5),
    p75, p90: at(0.90), p99: at(0.99), p999: at(0.999),
    iqr: p75 - p25,
    pctBelow16: +(100 * below / n).toFixed(3),
    pctAbove240: +(100 * above / n).toFixed(3),
    pctWarm: +(100 * warm / n).toFixed(3),
    pctCool: +(100 * cool / n).toFixed(3),
    transparentSkipped: transparent,
  };
}

/** Parse `"x,y,w,h"` fractions, or an object, into a pixel box clamped to the frame. */
export function region(img, spec) {
  const [fx, fy, fw, fh] = typeof spec === 'string'
    ? spec.split(',').map(Number)
    : [spec.x, spec.y, spec.w, spec.h];
  const x0 = Math.max(0, Math.round(fx * img.width));
  const y0 = Math.max(0, Math.round(fy * img.height));
  return {
    x0, y0,
    w: Math.min(img.width - x0, Math.round(fw * img.width)),
    h: Math.min(img.height - y0, Math.round(fh * img.height)),
  };
}

/** Absolute pixel box — use when a finding already quotes pixel coordinates. */
export function pixelRegion(img, x0, y0, w, h) {
  const cx = Math.max(0, Math.min(img.width - 1, Math.round(x0)));
  const cy = Math.max(0, Math.min(img.height - 1, Math.round(y0)));
  return { x0: cx, y0: cy, w: Math.min(img.width - cx, Math.round(w)), h: Math.min(img.height - cy, Math.round(h)) };
}

/** Tightly packed RGB copy of a box — feed straight to `encodePNG`. */
export function cut(img, r) {
  const out = Buffer.alloc(r.w * r.h * 3);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const s = ((y + r.y0) * img.width + (x + r.x0)) * img.channels;
      const d = (y * r.w + x) * 3;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2];
    }
  }
  return out;
}

/**
 * What a hostile eye is reacting to when it calls a region "flat putty": how far the luma
 * spreads inside it and how much high-frequency energy the surface carries.
 *
 * `detail` is mean |Laplacian|. `bOverR` is the single number that settles warm-vs-cool
 * arguments about a shadow — a shaded surface that should read cool but measures 0.58 is a
 * finding, not a preference.
 */
export function regionStats(img, r) {
  if (r.w < 1 || r.h < 1) throw new Error('regionStats: empty region');
  const px = cut(img, r);
  const n = r.w * r.h;
  const lum = new Float64Array(n);
  let rs = 0, gs = 0, bs = 0, satSum = 0;
  for (let i = 0; i < n; i++) {
    const R = px[i * 3], G = px[i * 3 + 1], B = px[i * 3 + 2];
    lum[i] = REC709(R, G, B);
    rs += R; gs += G; bs += B;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
  }
  const sorted = Float64Array.from(lum).sort();
  const q = (f) => sorted[Math.min(n - 1, Math.floor(f * n))];

  let detail = 0, dn = 0;
  for (let y = 1; y < r.h - 1; y++) {
    for (let x = 1; x < r.w - 1; x++) {
      const i = y * r.w + x;
      detail += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - r.w] - lum[i + r.w]);
      dn++;
    }
  }

  const meanR = rs / n, meanG = gs / n, meanB = bs / n;
  return {
    box: `${r.x0},${r.y0} ${r.w}x${r.h}`,
    meanRGB: [meanR, meanG, meanB].map((v) => +v.toFixed(1)),
    bOverR: +(meanR === 0 ? 0 : meanB / meanR).toFixed(3),
    gOverR: +(meanR === 0 ? 0 : meanG / meanR).toFixed(3),
    saturation: +(satSum / n).toFixed(3),
    luma: { p1: +q(0.01).toFixed(1), p50: +q(0.5).toFixed(1), p99: +q(0.99).toFixed(1) },
    lumaSpread: +(q(0.99) - q(0.01)).toFixed(1),
    detail: dn ? +(detail / dn).toFixed(2) : null,
  };
}

/**
 * Before/after on the same box, with the no-op case called out.
 *
 * This exists because the failure it names has happened repeatedly: a fix lands, the numbers
 * do not move at all, and the round records it as "subtle". It was not subtle — the edited
 * branch never ran.
 */
export function compareRegion(beforeSource, afterSource, spec) {
  const a = loadImage(beforeSource);
  const b = loadImage(afterSource);
  const ra = typeof spec === 'string' || spec.x !== undefined ? region(a, spec) : spec;
  const rb = typeof spec === 'string' || spec.x !== undefined ? region(b, spec) : spec;
  const before = regionStats(a, ra);
  const after = regionStats(b, rb);
  const identical = JSON.stringify(before) === JSON.stringify(after);
  return {
    before,
    after,
    identical,
    note: identical
      ? 'byte-identical: the branch you edited does not draw these pixels — this is a failed edit, not a subtle one'
      : null,
  };
}
