/**
 * png.mjs — read and write PNGs with no dependencies at all.
 *
 * `node:fs` and `node:zlib`, nothing else. That matters more than it sounds: two other
 * tools in the survey (`survival/tools/lumastats.mjs`, `game2/tools/contact-sheet.mjs`)
 * boot an entire Chromium purely to borrow a 2D canvas for `getImageData`. This replaces
 * both, and a measurement tool that needs no browser can run inside the harness that is
 * measuring the browser.
 *
 * Why decode a saved PNG rather than read the canvas in-page: the WebGL context is created
 * with `preserveDrawingBuffer: false`, so `drawImage` outside the paint window yields a
 * cleared buffer and **every shot measures as pure black**. That failure is silent — it
 * produces a plausible histogram of a frame that was never there.
 * (`game2/tools/luma.mjs:4-8`)
 *
 * Supported: 8-bit, non-interlaced, colour types 0 (grey), 2 (RGB), 3 (palette), 4
 * (grey+alpha) and 6 (RGBA). Output is always normalised to packed RGB or RGBA, so callers
 * can index `(y * width + x) * channels` and read R, G, B without caring what was on disk.
 * The original in `game2/tools/luma.mjs` handled only 2 and 6, which is fine for Playwright
 * screenshots and useless against the 94 palette-encoded sprites in the other repositories.
 *
 * Anything outside that set throws rather than guessing. A wrong guess here becomes a wrong
 * measurement, which becomes a wrong finding.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Paeth predictor, per the PNG spec. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * @param {Buffer} buf
 * @returns {{width: number, height: number, channels: number, data: Buffer}}
 */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, transparency = null;

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(body);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(body);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') break;
    off += 12 + len;                       // length + type + data + CRC
  }

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  // Samples stored per pixel on disk — this drives the un-filter, and is not the same as
  // the channel count we hand back.
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!samples) throw new Error(`unsupported colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('palette PNG has no PLTE chunk');
  if (!idat.length) throw new Error('PNG has no IDAT data');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * samples;
  if (raw.length < height * (stride + 1)) throw new Error('PNG IDAT stream is short');
  const flat = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= samples ? flat[dst + x - samples] : 0;
      const b = y > 0 ? flat[prev + x] : 0;
      const c = x >= samples && y > 0 ? flat[prev + x - samples] : 0;
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter} on row ${y}`);
      }
      flat[dst + x] = r & 0xff;
    }
  }

  return expand({ width, height, colorType, samples, flat, palette, transparency });
}

/** Normalise whatever was on disk into packed RGB or RGBA. */
function expand({ width, height, colorType, samples, flat, palette, transparency }) {
  if (colorType === 2 || colorType === 6) {
    return { width, height, channels: samples, data: flat };
  }

  const n = width * height;
  if (colorType === 0 || colorType === 4) {
    const channels = colorType === 4 ? 4 : 3;
    const data = Buffer.alloc(n * channels);
    for (let i = 0; i < n; i++) {
      const g = flat[i * samples];
      const d = i * channels;
      data[d] = g; data[d + 1] = g; data[d + 2] = g;
      if (channels === 4) data[d + 3] = flat[i * samples + 1];
    }
    return { width, height, channels, data };
  }

  // Palette. tRNS, when present, gives alpha per index and may be shorter than the palette;
  // indices past its end are fully opaque.
  const channels = transparency ? 4 : 3;
  const data = Buffer.alloc(n * channels);
  const entries = palette.length / 3;
  for (let i = 0; i < n; i++) {
    const index = flat[i];
    if (index >= entries) throw new Error(`palette index ${index} is outside a ${entries}-entry PLTE`);
    const s = index * 3;
    const d = i * channels;
    data[d] = palette[s]; data[d + 1] = palette[s + 1]; data[d + 2] = palette[s + 2];
    if (channels === 4) data[d + 3] = index < transparency.length ? transparency[index] : 255;
  }
  return { width, height, channels, data };
}

export function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Minimal RGB writer — filter 0 rows, one IDAT. Input is tightly packed `w*h*3` bytes. */
export function encodePNG(width, height, rgb) {
  if (rgb.length < width * height * 3) throw new Error('encodePNG: buffer is short for w*h*3');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
