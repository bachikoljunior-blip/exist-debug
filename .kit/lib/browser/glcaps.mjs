/**
 * probeWebGL — what does the headless browser actually expose?
 *
 * Run this before believing anything about a render. Half the silent defects on these
 * projects were a feature the code assumed and the software rasteriser did not have; the
 * shader linked, no exception was thrown, and the pass drew nothing.
 *
 * Verbatim in behaviour from `game2/tools/probe-gl.mjs`, which needed no project code at all
 * and was the most portable file in the survey.
 */

import { launchHeadless } from './launch.mjs';

export async function probeWebGL({ browser, ...launchOptions } = {}) {
  const owned = !browser;
  const driver = browser || await launchHeadless(launchOptions);
  try {
    const page = await driver.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<canvas id=c width=400 height=300></canvas><script>
const gl = document.getElementById('c').getContext('webgl2')
  || document.getElementById('c').getContext('webgl');
window.__caps = gl ? {
  ok: true,
  webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
  version: gl.getParameter(gl.VERSION),
  renderer: gl.getParameter(gl.RENDERER),
  vendor: gl.getParameter(gl.VENDOR),
  shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
  halfFloatLinear: !!gl.getExtension('OES_texture_half_float_linear'),
  colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
  floatLinear: !!gl.getExtension('OES_texture_float_linear'),
  depthTexture: !!gl.getExtension('WEBGL_depth_texture'),
  maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS ?? 0x8824) ?? null,
  maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
  maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
} : { ok: false };
// Clear to a non-black colour: a caps dump that reports fine against a context which cannot
// actually rasterise is exactly the apparatus failure this tool exists to catch.
if (gl) { gl.clearColor(0.9, 0.3, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
<\/script>`);
    return await page.evaluate(() => window.__caps);
  } finally {
    if (owned) await driver.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await probeWebGL(), null, 2));
}
