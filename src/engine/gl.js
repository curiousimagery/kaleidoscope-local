// engine/gl.js
//
// WebGL2 plumbing. owns:
//   - context creation
//   - shader compilation + linking
//   - uniform location lookup
//   - position buffer (full-screen quad)
//   - texture upload from an HTMLImageElement
//   - FBO export at arbitrary size up to gl.MAX_TEXTURE_SIZE
//
// everything here is pure infrastructure — no knowledge of forms, state, or
// the shell. consumers pass a `state` object and a `ctx` with sourceAspect +
// formIndex; this module pushes uniforms accordingly.

import {
  VERT_SRC,
  buildFragmentSource,
  collectUniformSpecs,
  collectAllUniformNames,
} from './shader-builder.js';

// create a WebGL2 context on the provided canvas. returns an object with the
// active GL handle, program, uniform location map, and helper methods. throws
// on init failure with a descriptive message.
export function createGLContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error('WebGL2 not supported');

  const fragSrc = buildFragmentSource();
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('shader link error: ' + gl.getProgramInfoLog(program));
  }

  // uniform locations — looked up once at init.
  const uniformLocs = {};
  for (const name of collectAllUniformNames()) {
    uniformLocs[name] = gl.getUniformLocation(program, name);
  }
  const uniformSpecs = collectUniformSpecs();

  // full-screen quad
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1, -1, 1,
    -1,  1,  1, -1,  1, 1,
  ]), gl.STATIC_DRAW);

  const renderer = gl.getParameter(gl.RENDERER);
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxFBOSize = probeMaxFBOSize(gl, maxTextureSize);

  return {
    gl,
    program,
    uniformLocs,
    uniformSpecs,
    positionBuffer,
    diagnostics: { renderer, maxTextureSize, maxFBOSize },
  };
}

// Probe the actual largest square export size the full pipeline can handle.
// Two separate limits can bite us independently:
//
//   GPU side: driver may report MAX_TEXTURE_SIZE = 16384 but refuse to commit
//   GPU memory when we actually render to and read from the FBO (lazy alloc).
//   Caught by: clear + single-pixel readPixels + gl.getError().
//
//   CPU side: Safari/WebKit limits the canvas size that toBlob() can encode.
//   A canvas may be created and drawn into at full size, but toBlob returns
//   null if the browser's internal encoder can't handle that many pixels.
//   Caught by: create a canvas at this size, write one pixel, read it back.
//   If the browser silently clips or returns a null context, the pixel won't
//   round-trip correctly, revealing the limit.
function probeMaxFBOSize(gl, maxTextureSize) {
  for (const size of [16384, 8192, 4096, 2048]) {
    if (size > maxTextureSize) continue;

    // — GPU path —
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const texErr = gl.getError();

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let gpuOk = (texErr === gl.NO_ERROR) &&
                (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
    if (gpuOk) {
      // Force the driver to commit memory and verify the read-back pipeline.
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gpuOk = gl.getError() === gl.NO_ERROR;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(tex);
    if (!gpuOk) continue;

    // — CPU / canvas path —
    // Verify that a 2D canvas at this size can actually round-trip pixel data,
    // which is required for the putImageData + toBlob encoding step.
    let canvasOk = false;
    try {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx2d = c.getContext('2d');
      if (ctx2d) {
        ctx2d.fillStyle = 'rgba(127, 0, 0, 255)';
        ctx2d.fillRect(0, 0, 1, 1);
        const sample = ctx2d.getImageData(0, 0, 1, 1);
        // If the canvas is too large for this platform the fill silently fails
        // and the pixel comes back as zero.
        canvasOk = sample?.data[0] > 0;
      }
    } catch { /* canvas too large for this platform */ }
    if (canvasOk) return size;
  }
  return 2048;
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(sh);
    throw new Error('shader compile error: ' + err);
  }
  return sh;
}

// upload an HTMLImageElement (or any TexImageSource) to a fresh GL_TEXTURE_2D.
// disposes any prior texture passed in. returns the new texture handle.
// throws if the image is too large for the GPU (caller catches).
export function uploadTexture(gl, image, prevTexture) {
  if (prevTexture) gl.deleteTexture(prevTexture);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// push uniforms + bind program + bind position buffer. used by both preview
// and FBO export render paths. `state` is the kaleidoscope state object;
// `ctx` carries non-state values (sourceAspect, formIndex).
export function setUniforms(glCtx, state, ctx) {
  const { gl, program, uniformLocs, uniformSpecs, positionBuffer } = glCtx;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // bind the source texture to unit 0; u_source uniform is set to 0 by the spec.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, ctx.sourceTexture);

  for (const [name, spec] of Object.entries(uniformSpecs)) {
    const loc = uniformLocs[name];
    if (loc == null) continue;  // uniform not actively used (optimized out by GLSL compiler)
    const value = spec.get(state, ctx);
    switch (spec.type) {
      case '1f': gl.uniform1f(loc, value); break;
      case '1i': gl.uniform1i(loc, value); break;
      case '2f': gl.uniform2f(loc, value[0], value[1]); break;
      default: throw new Error(`unknown uniform type ${spec.type} for ${name}`);
    }
  }

  // blend mode for transparent OOB
  if (state.oobMode === 2) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.disable(gl.BLEND);
  }
}

// render to the default framebuffer (the canvas). caller is responsible for
// bind/viewport/clear; this just pushes uniforms and draws.
export function renderToCanvas(glCtx, state, ctx, width, height) {
  const { gl } = glCtx;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  setUniforms(glCtx, state, ctx);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// render to an offscreen FBO at `size × size`, read back pixels, return the
// pixel buffer + timing info. caller handles encoding to PNG/JPG.
//
// returns: { pixels: Uint8Array, size, renderMs, readMs }
// throws on framebuffer-incomplete.
export async function renderToFBO(glCtx, state, ctx, size) {
  const { gl } = glCtx;

  const fb = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    throw new Error(`framebuffer incomplete at ${size}×${size}`);
  }

  const t0 = performance.now();
  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  setUniforms(glCtx, state, ctx);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.finish();
  const renderMs = performance.now() - t0;

  const t1 = performance.now();
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const readMs = performance.now() - t1;

  // restore default framebuffer + free FBO resources
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);

  return { pixels, size, renderMs, readMs };
}
