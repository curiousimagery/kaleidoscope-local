// shell/overlay.js
//
// renders the slice overlay on top of the source image, and dispatches drag
// gestures (move / scale / rotate / segments / square-edge / square-corner)
// based on cursor classification.
//
// the overlay reads form-specific behavior from the active form's `spokeRule`
// and `buildPolygon` — adding a new form to the registry automatically gets
// correct overlay behavior as long as the form module fills in those fields.
//
// architecture:
//   - drawSourceOverlay(env): draws once. env carries DOM refs + state.
//   - classifyPointer(env, x, y, isTouch): returns mode + diagnostics.
//   - setupSourceInteraction(env): wires mouse/touch events on the wrap.
//
// `env` is the runtime container — { state, engine, sourceOverlayCanvas, ... }
// — assembled by main.js and threaded through. this avoids module-level
// mutable globals while keeping the call sites readable.

import { sliceVecToSourceUV, polygonRadiusAt, pointInPolygon, sliceBoxCenter, placeSliceBox, sliceDet, foldSliceIntoSource } from '../engine/geometry.js';
import { getActiveForm } from '../engine/forms/index.js';
import { rotateCursorForAngle, scaleCursorForAngle } from './cursors.js';
import { perfFlags } from './perf-flags.js';
import { holdGesture, releaseGesture, clearGestures, gestureSettling, IDLE_MS } from '../kit/gesture-gate.js';

// ⚠️ B635 — THE ORIGIN GUARDRAIL IS GONE. IT IS A FOLD NOW, AND THE DIFFERENCE IS THE WHOLE POINT.
//
// B630→B634 defended the bound from inside this file's drag handler, and it leaked five times from
// five different writers (the scale branch, the phone's cover crop, the bus's translation mapping,
// droste's centre-offset handle, the original move drag). Each was patched where it was found. The
// pattern was the finding: **a bound enforced in the view can only govern the one writer it sits
// inside**, and autoplay, the tween, the follower, the bus and the remote all write `sliceCx/Cy`
// without ever passing through here.
//
// `foldSliceIntoSource` (engine/geometry.js) replaces the clamp with an IDENTITY. Mirror-mode
// sampling repeats with period 2 and reflects about every source edge, so the state can be
// re-expressed as its own reflection with the pixels bit-identical — and folding into the
// representative whose SAMPLED box centre lies in [0,1] makes "the slice is off the image"
// unrepresentable rather than defended. There is nothing left to leak through, because the fold
// runs on the state about to be shown rather than at each point of write.
//
// It is called from exactly two kinds of place, both meaning "we are about to show this to
// someone": here after a drag, and each chrome's render schedule. Read the long note in
// geometry.js for the arithmetic.
// ⚠️ B636 — WHEN THE FOLD FIRES. Daniel expected it at the END of a gesture and B635 did it live:
// *"the direction you're moving an overlay reverses midway through a movement when the flip occurs,
// which isn't desirable."* Correct — mid-drag the reflection takes over under a moving finger, so
// the slice starts travelling against you for the rest of the stroke.
//
// Deferring to release keeps the whole stroke in one frame of reference, and because the fold is
// pixel-preserving there is nothing to catch up on: the render was already showing the reflection
// the entire time. Only the outline's identity settles late.
//
// **The gate is DRAGS ONLY.** A knob, an encoder, autoplay and the tween have no "release", so
// suppressing the fold for them would restore exactly the leak this whole build removed. That is
// why the test is `overlayDragging` and not a mode flag.
//
//   ?fold=live     fold continuously, the B635 behaviour, for A/B
//   ?fold=release  (default) fold when the gesture ends
const FOLD_LIVE = new URLSearchParams(location.search).get('fold') === 'live';

// ⚠️ B638 — MODULE-LEVEL, NOT `env.overlayDragging`, AND THAT DISTINCTION IS THE ENTIRE BUG.
//
// B636 gated the fold on `env.overlayDragging`. That flag is real, but it lives on the PRIVATE
// `view` object `components/source-overlay.js` builds — which its own comment describes as
// *"replaces the global desktop env"*. The drag sets it there; each chrome's render schedule calls
// `normalizeSliceMirror(env)` with the CHROME's env, where the flag is permanently `undefined`. So
// the gate held at the drag site and did nothing at the render site, and the fold ran every frame
// mid-drag after all.
//
// That produced Daniel's report exactly: `move` re-derives its target from the pointer each event,
// so the pointer wrote the unfolded position, the next frame's fold reflected it, the next pointer
// event wrote it straight back — **alternating at frame rate**. Half those frames carried a folded
// handedness on an unfolded position, which is a genuinely different picture, which is why the
// flicker reached the OUTPUT panel too: *"the orientation of the slice flips back and forth 180
// degrees very quickly... sometimes perceptibly showing two solid wedges at the same time."* A fold
// alone can never do that — it is pixel-preserving — so the output flickering was the evidence that
// state was oscillating rather than merely being re-described.
//
// **This is the two-`env` divergence CLAUDE.md warns about, in a new disguise:** not desktop vs
// mobile this time, but chrome vs component. The durable answer is that a gesture on THE one source
// overlay is a module-global fact, so it belongs somewhere every caller sees regardless of which
// object it is holding.
//
// ⚠️ B639 GENERALISED THAT AGAIN, and the reason is worth keeping: **a held gamepad joystick is a
// gesture too** — it just arrives as a stream of writes rather than pointer events. Daniel:
// *"when translating the slice location using a gamepad joystick the switch still occurs mid-push
// causing the direction to reverse."* B636 asked "is a pointer down" when the question that
// matters is "is an input still moving this". `kit/gesture-gate` owns that fact for every input
// surface now, so the bus and the overlay answer the same question instead of the overlay's answer
// being the only one that counts.

// ⚠️ B641 — A DEFERRED FOLD MUST RE-ARM, OR IT IS A FOLD THAT NEVER HAPPENS.
//
// Daniel: *"on release, specifically when using the MIDI/gamepad input, the reflection doesn't flip
// to the solid form... this is corrected if using a mouse."* Exactly the split you would expect
// once you notice **the render loop is ON-DEMAND**. A pointer drag ends with `onUp`, which calls
// this again explicitly. A knob has no release: its final write renders immediately, that render
// lands INSIDE the idle window and is gated — and then nothing ever asks again, because nothing
// changed. The gate was not wrong, it was terminal.
//
// So declining schedules the retry. One timer for the module, re-armed if the input is still live
// when it fires, which converges by itself the moment the hardware goes quiet. This is the project
// rule about anything that can decline to act — an absence is not evidence, and here it was not
// even a decision, just a dropped intention.
let refoldTimer = 0;

// ⚠️ B642 — CROSSFADE THE ROLE SWAP. Daniel: *"the color flip is a bit jarring... even a ~.5-1.5
// second fade between states would improve the visual feel and clarify what's happening."*
//
// The elegant part is that **no identity tracking is needed**. At the fold, the primary copy and
// one reflection swap membership: what was solid white becomes amber-dashed and vice versa. So
// fading the two CLASS STYLES past each other reproduces the crossfade exactly — the incoming
// primary starts amber and resolves to white, the outgoing one starts white and resolves to amber,
// because each is drawn by the class it now belongs to.
//
// Colour and alpha only. Dash patterns do not interpolate meaningfully, and the colour is what
// Daniel named. 900ms sits in the middle of the range he gave.
export let foldFadeT = 0;
// Stamp a fold that happened somewhere other than normalizeSliceMirror — motion's sampler folds
// each played frame itself, so without this a fold during playback would swap colours with no
// transition even though the live overlay is perfectly capable of animating it (B643).
export function markSliceFold() { foldFadeT = performance.now(); }

// PURE — expiry is done once per draw in drawSourceOverlayInner. A read that also cleared the
// timer would be a trap here, because the draw both reads it and decides whether to schedule the
// next frame from it: whichever call site happened to run first would end the animation.
const foldFadeP = () => (foldFadeT ? Math.min(1, (performance.now() - foldFadeT) / LIVE_FOLD_FADE_MS) : 1);
// eased, and mixed toward the OTHER class's look at p=0
const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const PRIMARY_RGB = [255, 255, 255];
const REFLECT_RGB = [255, 196, 80];

// ⚠️ B645 — THE WHOLE STYLE CROSSFADES, NOT JUST THE COLOUR. Daniel, with a screenshot: *"the lines
// have different shapes and different thicknesses... the smooth transition only applies to the
// color but the shape still changes instantly so visually it still feels quite abrupt."*
//
// Right, and it was half a feature. The two classes differ in four ways — colour, WEIGHT, DASH and
// opacity — and animating one of four leaves the other three cutting on the same frame, which is
// all the eye needs to read it as a jump.
//
// The dash is the one that looks impossible and is not: a dash pattern cannot be interpolated, but
// its GAP can go to zero, and `[len, 0]` renders solid. So dashed→solid is a continuous morph
// through shrinking gaps rather than a swap between two states.
//
// `p` runs 0 → 1 as a copy becomes PRIMARY, so a copy losing the role passes the same ramp
// backwards and the two cross in the middle.
// ⚠️ B647 — TWO DURATIONS, AND THE DISTINCTION IS THE POINT. Daniel: *"it should be near instant
// when you're actually manipulating the slice. the slow ease transition is specifically for the
// companion video."*
//
// Right, and the reason they differ is not taste. While you are working the slice, the swap is
// FEEDBACK — you caused it, you already know why it happened, and a long ease just delays the
// overlay agreeing with your hands. In a rendered take there is no hand: the viewer needs the
// transition to explain a change nobody performed. Same event, opposite jobs.
//
// The baked value is exported because motion's baker derives its own progress from the TIMELINE
// (see bakeFoldFade) and must use the same window the fade was designed around.
export const FOLD_FADE_MS = 900;    // baked / companion render
const LIVE_FOLD_FADE_MS = 130;      // on-screen manipulation — present, not slow
const DASH_LEN = 4, DASH_GAP = 3;
function roleStyle(p, strokeScale) {
  const gap = DASH_GAP * (1 - p);
  return {
    rgb: mixRGB(REFLECT_RGB, PRIMARY_RGB, p),
    width: (1.0 + 0.5 * p) * strokeScale,
    alpha: 0.6 + 0.3 * p,
    dash: gap < 0.05 ? [] : [DASH_LEN, gap],
    // B646 — the tinted FILL rides the same ramp and passes through zero. Daniel: *"the reflection
    // has a low opacity fill but we turn it off and on abruptly. Can we have the fill crossfade
    // through 0% to truly ease out and in across layers?"*
    //
    // It was the last property still switching, and it switched because only the reflection CLASS
    // drew a fill at all — so the copy being promoted lost its tint in one frame. Making the fill a
    // function of the role (full at p=0, gone at p=1) means the outgoing primary grows its tint in
    // as the incoming one loses it, and both pass through 0 rather than blinking.
    fill: 0.10 * (1 - p),
  };
}

export function normalizeSliceMirror(env) {
  const state = env?.state;
  if (!state) return null;
  if (gestureSettling() && !FOLD_LIVE) {
    if (!refoldTimer) {
      refoldTimer = setTimeout(() => {
        refoldTimer = 0;
        env.scheduleRender?.();       // the render schedule is where the fold runs; see main.js
      }, IDLE_MS + 20);
    }
    return null;
  }
  const fold = foldSliceIntoSource(state, getActiveForm(state),
    env.engine?.getSourceAspect?.() || 1, visibleUVRect(env));
  // Perform holds a spring over sliceCx/Cy. A fold rewrites those numbers without changing what
  // they mean, so the spring has to be carried into the new frame or it chases a target that moved
  // out from under it — a full sweep of the live output, mid-show. See follow.js `remap`.
  if (fold) {
    env.onSliceFold?.(fold);
    foldFadeT = performance.now();     // B642 — start the role-swap crossfade
    env.scheduleOverlayDraw?.();
  }
  return fold;
}

// What the operator can SEE of the source: the drawn image rect intersected with the panel. Under
// `contain` this is [0,1] and changes nothing; under the phone's `cover` it is the crop. Kept from
// B633 — the derivation was always right, it was being used for the wrong job. It fed a per-chrome
// BOUND then (which is what leaked); it feeds the fold's TRIGGER now, while the fold itself works
// in the source's own domain. One derivation, both chromes, which is why it lives here.
function visibleUVRect(env) {
  const cv = env.sourceOverlayCanvas;
  const g = cv?._geom;
  if (!cv || !g || !g.imgW || !g.imgH) return null;
  // ⚠️ B636 — `canvas.width`, NOT `clientWidth`. This function used to run only inside a drag, and
  // B635 moved it onto every frame via the render-schedule fold — where `clientWidth` forces a
  // LAYOUT FLUSH before each render. That is Daniel's iPad report: *"the slice now has a bit of a
  // stutter and latency compared to before."* The backing-store size is an attribute read with no
  // layout cost, and `drawSourceOverlayInner` sets it from the same measurement this used to take,
  // so the value is identical — it is the reflow that is gone, not the accuracy.
  const dpr = overlayDpr();
  const w = cv.width / dpr, h = cv.height / dpr;
  if (!w || !h) return null;
  const u0 = Math.max(0, -g.imgX / g.imgW), u1 = Math.min(1, (w - g.imgX) / g.imgW);
  const v0 = Math.max(0, -g.imgY / g.imgH), v1 = Math.min(1, (h - g.imgY) / g.imgH);
  // a degenerate rect (mid-layout, zero-size panel) must not become a reference
  return (u1 - u0 > 0.05 && v1 - v0 > 0.05) ? { u0, u1, v0, v1 } : null;
}

// touch-surface detection — used to decide whether to render always-visible
// direct-manipulation handles (touch) vs cursor-only affordances (mouse).
const IS_TOUCH = matchMedia('(hover: none)').matches;

// hit-test bands in display pixels. mouse and touch have different sizes; the
// touch versions meet HIG 44pt minimum target sizing.
const HIT = {
  CENTER_DOT_MOUSE:     15,
  SCALE_BAND_IN_MOUSE:  20,
  SCALE_BAND_OUT_MOUSE: 20,
  SPOKE_BAND_IN_MOUSE:   4,
  SPOKE_BAND_OUT_MOUSE: 12,   // was 20 — tightened (M3): the segment-grab band was fat enough to catch scale/rotate intents
  CENTER_DOT_TOUCH:     30,
  SCALE_BAND_IN_TOUCH:  28,
  SCALE_BAND_OUT_TOUCH: 28,
  SPOKE_BAND_IN_TOUCH:  10,
  SPOKE_BAND_OUT_TOUCH: 20,   // was 32 — tightened (M3) to cut accidental segment-count grabs on touch (still a wide along-spoke target)
  // Rhombus (triangle) scale band — dedicated so the interior stays mostly a
  // MOVE target. Thin interior band, slightly larger exterior. (The shared
  // SCALE_BAND_* above ate ~16-28px of the interior, leaving small rhombi with
  // no move zone.) See classifyPointer's rhombus branch.
  RHOMBUS_SCALE_IN_MOUSE:  4,
  RHOMBUS_SCALE_OUT_MOUSE: 16,
  RHOMBUS_SCALE_IN_TOUCH:  4,
  RHOMBUS_SCALE_OUT_TOUCH: 16,
};

// REFLECTION DENSITY-LOD (Build 4, Daniel: "reflected states go crazy all over" at extreme
// zoom-out). The mirror-reflection copies are honest, but when the sampled region grows far past
// the source (radial's wedge scales ×1/canvasZoom, B453) the copies sprawl + overlap into amber
// noise. Fade them out as the sampled polygon's UV bounding box exceeds the source (1 = one
// source-dimension): full at ≤ START, gone by ≥ END. The PRIMARY outline is never faded. Tiling
// forms don't grow their footprint with zoom, so their coverage stays ~1 and they never fade —
// the LOD self-targets exactly the radial/large-slice case. TUNE these two on-device.
const REFLECT_FADE_START = 1.6, REFLECT_FADE_END = 4.0;

// ===========================================================================
// drawing
// ===========================================================================

// rAF-coalesced wrapper. multiple calls within a single frame collapse into
// one redraw on the next animation frame.
export function makeOverlayDrawer(env) {
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  }
  // An EXPLICIT schedule is an invalidation: someone changed something the overlay draws and
  // said so. It always redraws. The change-detection gate in drawSourceOverlay exists for the
  // OTHER kind of caller — the render loops that call render() every frame regardless — so a
  // lock toggle or a hover can never be swallowed by a signature that failed to notice it.
  function draw() { drawSourceOverlay(env, { force: true }); }
  return { draw, schedule };
}

// displayed image rect inside the wrap. `contain` (default) letterboxes; `cover`
// fills the panel and crops the overflow (the displayed source's CSS fit must
// match — see mountSourceView). Cover is the contain branch inverted. Shared by
// the main overlay draw and the perform-mode ghost pass.
function imageRect(env, w, h, sourceAspect) {
  const coverMode = env.fit === 'cover';
  const wrapAspect = w / h;
  let imgW, imgH, imgX, imgY;
  if ((sourceAspect > wrapAspect) !== coverMode) {
    imgW = w;
    imgH = w / sourceAspect;
    imgX = 0;
    imgY = (h - imgH) / 2;
  } else {
    imgH = h;
    imgW = h * sourceAspect;
    imgX = (w - imgW) / 2;
    imgY = 0;
  }
  return { imgX, imgY, imgW, imgH };
}

// Remote (phone) finger echo — drawn INSIDE the overlay pass with the exact
// geometry it just computed, so the dots can never disagree with the outline
// (a separate fixed-position layer drifted: dpr/border/origin mismatches put
// Daniel's fingers down-right of his touches). env.remoteFingers = [[u,v],..].
function drawRemoteFingers(env) {
  const pts = env.remoteFingers;
  if (!pts?.length || !env.sourceOverlayCanvas) return;
  const g = env.sourceOverlayCanvas._geom;
  if (!g) return;
  const ctx = env.sourceOverlayCanvas.getContext('2d');
  const r = Math.max(5, g.imgW * 0.022);   // ~finger-pad, proportional to the panel
  ctx.save();
  for (const [u, v] of pts) {
    const x = g.imgX + u * g.imgW, y = g.imgY + v * g.imgH;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
}

// Perform-mode ONION SKIN (Arc 4): ghost wedge outlines for where the live
// output is / recently was, painted as part of EVERY overlay draw (the perform
// runtime sets env.performGhosts; drawSourceOverlay calls this at its exits) —
// so the camera loop's own per-frame draws and the perform loop's never fight
// (drawing them from outside strobed). Outlines only, low alpha: older samples
// nearly invisible; the runtime fades the whole trail as the live output
// catches up (Daniel's onion-skin spec). A form can override the outline with
// ghostPaths(state) → [pts, ...] when its sampled region isn't its buildPolygon
// (droste: the placeholder polygon is a full circle, but the real region is the
// annular wedge / ring — the "ghosts show a complete circle" bug).
function drawGhostWedges(env, ghosts) {
  const { engine } = env;
  if (!env.sourceOverlayCanvas || !engine.getSourceImage() || !ghosts?.length) return;
  const canvas = env.sourceOverlayCanvas;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  // CAP AT 2, matching every other canvas in the app (preview, PiP, phone output, filmstrip).
  // This was the one surface reading the raw ratio, so on a 3x phone it drew 2.25x the pixels
  // of a capped one — for vector line work, which gains nothing visible past 2x.
  const dpr = overlayDpr();
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sourceAspect = engine.getSourceAspect();
  const { imgX, imgY, imgW, imgH } = imageRect(env, w, h, sourceAspect);
  for (const g of ghosts) {
    const st = g.snap;
    const form = getActiveForm(st);
    const paths = form.ghostPaths ? form.ghostPaths(st)
      : form.buildPolygon ? [form.buildPolygon(st)] : [];
    if (!paths.length) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha));
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    for (const pts of paths) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, st, sourceAspect);
        const x = imgX + (st.sliceCx + dx) * imgW;
        const y = imgY + (st.sliceCy + dy) * imgH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
}

const overlayDpr = () => (perfFlags.overlayDprCap
  ? Math.min(window.devicePixelRatio || 1, 2)
  : (window.devicePixelRatio || 1));

// What a draw's OUTPUT depends on. If none of it moved, the pixels would be identical and the
// draw is pure waste. Built over EVERY primitive in state rather than a hand-listed set of
// slice fields, because a missed field means a stale overlay — a visible bug — and forty
// property reads are nothing next to clearing and re-stroking a DPR-scaled canvas.
function overlaySignature(env) {
  let s = '';
  for (const k in env.state) {
    const v = env.state[k];
    if (v === null || typeof v !== 'object') s += k + v + ';';
  }
  const wrap = env.sourceOverlayCanvas?.parentElement;
  s += `|${wrap?.clientWidth}x${wrap?.clientHeight}|${env.engine.getSourceAspect()}|${env.fit}`;
  s += `|${overlayDpr()}|${env.overlayStrokeScale || 1}|${env.hoverMode}${env.hoverOnSpoke}${env.hoverHandle}`;
  s += `|${env.overlayDragging}${env.overlayDragMode}`;
  try { s += `|${env.hideAffordances?.()}${env.editLocked?.()}`; } catch { /* not wired on every host */ }
  return s;
}

// `force` = an explicit invalidation (see makeOverlayDrawer). Without it this is the per-frame
// path from the render loops, and it redraws only when something it draws actually changed.
//
// WHY (Daniel, 2026-08-05): "this genuinely shouldn't be re-rendering at all unless it is
// actively being manipulated." It was redrawing on every frame of camera preview and video
// playback — precisely when the device is busiest — to produce identical vector line work.
// Motion playback and perform still redraw every frame, correctly, because there the state IS
// changing per frame; the signature notices that by itself rather than needing a mode check.
export function drawSourceOverlay(env, { force = false } = {}) {
  // the perform ghost trail animates independently of state (it fades and shifts every frame),
  // so it opts out of the gate rather than trying to sign a moving array of snapshots
  // a fold crossfade animates on the CLOCK, not on state — so it opts out of the change gate for
  // its window the same way the perform ghost trail does (B642)
  //
  // ⚠️ B648 — AND THE GATE MAY NEVER SKIP WHEN THERE IS NO CACHED GEOMETRY. The gate's whole premise
  // is "the pixels would be identical, so the draw is waste" — which is false on a canvas that has
  // never been drawn. `_geom` is written at the END of a draw and read by `classifyPointer`, so a
  // canvas without it hit-tests as `mode: null` and every cursor falls back to `default`.
  //
  // That is the shape of Daniel's Firefox report — *"only seeing a pointer most of the time"* — and
  // his follow-up that it has since stopped reproducing is what makes this the likely cause rather
  // than a cursor-encoding problem: **an encoding failure is deterministic, and this is not.** A
  // re-mount hands over a fresh canvas with no `_geom`; if state has not changed since the last
  // draw, the signature matches and the draw is skipped, so the new canvas never gets geometry —
  // and it stays that way until something unrelated moves a value. Intermittent, and self-healing
  // the moment you touch a control, which is exactly what was described.
  if (!force && !env.performGhosts && !foldFadeT && env.sourceOverlayCanvas?._geom && perfFlags.overlayGated) {
    const sig = overlaySignature(env);
    if (sig === env.lastOverlaySig) return;
    env.lastOverlaySig = sig;
  } else {
    env.lastOverlaySig = null;   // a forced/ghost draw leaves no valid cache to compare against
  }
  if (env.perfItem) { env.perfItem.begin(); try { drawSourceOverlayInner(env); } finally { env.perfItem.end(); } }
  else drawSourceOverlayInner(env);
  // keep the crossfade running. Terminates because Inner clears foldFadeT the moment the progress
  // reaches 1, so this cannot become a permanent redraw loop even if a form draws nothing.
  if (foldFadeT) env.scheduleOverlayDraw?.();
}

function drawSourceOverlayInner(env) {
  const { state, engine } = env;
  // THE one expiry point for the fold crossfade (see foldFadeP).
  //
  // ⚠️ B643 — `env.foldFadeP` OVERRIDES THE CLOCK, because a BAKED render has no clock to read.
  // The companion source video is composed frame by frame at whatever speed the encoder manages,
  // so `performance.now()` says nothing about where that frame sits in the take — every frame
  // would read almost the same elapsed time, or race past the window entirely. Daniel: *"the
  // crossfade doesn't show on the companion video, the color swap is still instant."*
  //
  // So the baker supplies progress derived from the TIMELINE (see renderSourcePreviewFrame), and
  // the live overlay keeps the wall clock. The override must not expire the shared timer either —
  // that belongs to the live overlay, and a bake would otherwise cancel a fade running on screen.
  const overrideFade = env.foldFadeP;
  const foldFade = (typeof overrideFade === 'number')
    ? Math.max(0, Math.min(1, overrideFade))
    : foldFadeP();
  if (overrideFade == null && foldFade >= 1) foldFadeT = 0;
  if (!env.sourceOverlayCanvas || !engine.getSourceImage()) return;
  // outline stroke multiplier — 1 for the live overlay; the companion source-preview
  // render bumps it so the wedge lines read at 1920² instead of hairline.
  const sw = env.overlayStrokeScale || 1;

  const canvas = env.sourceOverlayCanvas;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;

  // CAP AT 2, matching every other canvas in the app (preview, PiP, phone output, filmstrip).
  // This was the one surface reading the raw ratio, so on a 3x phone it drew 2.25x the pixels
  // of a capped one — for vector line work, which gains nothing visible past 2x.
  const dpr = overlayDpr();
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // ROUND CAPS for the whole overlay pass — the scale-proof seam seal. Butt
  // ends leave gaps wherever separate strokes meet (spokes at the apex/mouth,
  // droste's arcs meeting its wedge sides): invisible at the live 1.5px
  // hairline, glaring at the companion video's ~5px overlayStrokeScale. Set
  // HERE, in the one shared drawer, so every borrower (companion render,
  // phone stream, live) and every form inherits it.
  ctx.lineCap = 'round';

  const sourceAspect = engine.getSourceAspect();
  const { imgX, imgY, imgW, imgH } = imageRect(env, w, h, sourceAspect);

  const form = getActiveForm(state);

  // form-overridable overlay path — used by forms whose sample region isn't a
  // polygon (droste's annulus, future hyperbolic disc, etc.). the form takes
  // over from here: drawing its own dim background / holes / outlines /
  // affordances and populating canvas._geom with whatever its classifyPointer
  // needs.
  if (form.drawOverlay) {
    const cxPx = imgX + state.sliceCx * imgW;
    const cyPx = imgY + state.sliceCy * imgH;
    // B645 — droste paints its own geometry across the whole canvas; clip it to the image for the
    // same reason the polygon path is clipped (the companion frame letterboxes into a square).
    ctx.save();
    ctx.beginPath();
    ctx.rect(imgX, imgY, imgW, imgH);
    ctx.clip();
    form.drawOverlay(env, ctx, {
      w, h, imgX, imgY, imgW, imgH,
      cx: cxPx, cy: cyPx,
      sourceAspect,
      IS_TOUCH: IS_TOUCH || !!env.forceTouchAffordances,   // the phone-frame render forces touch styling
      strokeScale: sw,
      // B652 — the role-swap crossfade, handed to bespoke overlays. A form draws its PRIMARY with
      // roleStyle(foldFade) and its REFLECTIONS with roleStyle(1 - foldFade); one function, two
      // directions, so the two classes can never drift apart. Passing the function rather than
      // resolved styles keeps this the single source of the ramp without the engine layer reaching
      // into the shell for it.
      foldFade,
      roleStyle,
    });
    ctx.restore();
    if (env.performGhosts?.length) drawGhostWedges(env, env.performGhosts);
    drawRemoteFingers(env);
    return;
  }

  // build polygon in source-UV space, then transform to screen pixels.
  const pts = form.buildPolygon(state);
  let oobAnyAxis = false;
  let oobLeft = false, oobRight = false, oobTop = false, oobBottom = false;
  const uvPts = pts.map(p => {
    const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, state, sourceAspect);
    const u = state.sliceCx + dx;
    const v = state.sliceCy + dy;
    if (u < 0) oobLeft = true;
    if (u > 1) oobRight = true;
    if (v < 0) oobTop = true;
    if (v > 1) oobBottom = true;
    if (u < 0 || u > 1 || v < 0 || v > 1) oobAnyAxis = true;
    return { u, v };
  });
  const uvToScreen = (u, v) => ({ x: imgX + u * imgW, y: imgY + v * imgH });
  const screenPts = uvPts.map(({ u, v }) => uvToScreen(u, v));

  // Optional secondary polygon: the actual fold sample region, drawn alongside
  // the main polygon when the two don't match (currently only triangle). Its
  // hole is unioned with the main polygon's; outline is drawn after the main
  // outline so it sits on top.
  let sampleScreenPts = null;
  if (form.buildSampleRegion) {
    const samplePts = form.buildSampleRegion(state);
    sampleScreenPts = samplePts.map(p => {
      const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, state, sourceAspect);
      return uvToScreen(state.sliceCx + dx, state.sliceCy + dy);
    });
  }

  // ⚠️ B645 — THE OVERLAY STOPS AT THE IMAGE EDGE. Daniel, on the companion video: *"in our actual
  // app we don't show the overlay as it extends off the canvas, we only show the slice up to the
  // edge and its reflection. this makes it easier for your brain to complete the shape and see the
  // reflection for what it is. somehow in the companion video we didn't do the same and it's
  // visually noisy to see the full shape and the reflected portion."*
  //
  // The reflections were always clipped; the PRIMARY outline never was. It goes unnoticed on the
  // live panel, where the image fills nearly the whole box — and it is glaring in the companion
  // frame, which letterboxes a non-square source into a square, so the wedge draws its off-image
  // half across the black bars. Same code, different container, and only one of them told us.
  //
  // Affordances are drawn AFTER the restore on purpose: a rotation arc legitimately sits outside
  // the shape, and clipping it would hide the handle just as the slice reaches the edge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(imgX, imgY, imgW, imgH);
  ctx.clip();

  // dim background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, w, h);

  // cut hole for slice region (the primary wedge). The hole DISSOLVES with the role swap (B645) —
  // it was the loudest of the instant changes, since it is a filled region rather than a line.
  ctx.globalAlpha = foldFade;
  ctx.beginPath();
  screenPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill();

  // also cut the sample-region hole so the wedge's poke-out (beyond the main
  // polygon) reveals source image too.
  if (sampleScreenPts) {
    ctx.beginPath();
    sampleScreenPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // DENSITY-LOD: fade the reflected copies as the sampled region outgrows the source, so extreme
  // zoom-out doesn't fill the panel with overlapping amber (Daniel). coverage = the wedge's UV
  // bounding-box span in source-dimensions; 1 ≈ source-sized. Full opacity ≤ START, gone ≥ END.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const { u, v } of uvPts) {
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }
  const coverage = Math.max(uMax - uMin, vMax - vMin);
  const reflectFade = Math.max(0, Math.min(1, (REFLECT_FADE_END - coverage) / (REFLECT_FADE_END - REFLECT_FADE_START)));

  // mirror reflection visualization — when OOB mode is mirror AND the wedge
  // crosses an image edge, draw the reflected polygons (where the kaleidoscope
  // ACTUALLY pulls color from in mirror mode). drawn faintly + dashed, and
  // faded out (reflectFade) once the sampled region sprawls past the source.
  if (state.oobMode === 1 && oobAnyAxis && reflectFade > 0.01) {
    const refFadeP = foldFade;
    const transforms = [];
    if (oobLeft)   transforms.push(({ u, v }) => ({ u: -u, v }));
    if (oobRight)  transforms.push(({ u, v }) => ({ u: 2 - u, v }));
    if (oobTop)    transforms.push(({ u, v }) => ({ u, v: -v }));
    if (oobBottom) transforms.push(({ u, v }) => ({ u, v: 2 - v }));
    // diagonal corner reflections (compose two)
    if (oobLeft && oobTop)     transforms.push(({ u, v }) => ({ u: -u, v: -v }));
    if (oobLeft && oobBottom)  transforms.push(({ u, v }) => ({ u: -u, v: 2 - v }));
    if (oobRight && oobTop)    transforms.push(({ u, v }) => ({ u: 2 - u, v: -v }));
    if (oobRight && oobBottom) transforms.push(({ u, v }) => ({ u: 2 - u, v: 2 - v }));

    ctx.save();
    ctx.beginPath();
    ctx.rect(imgX, imgY, imgW, imgH);
    ctx.clip();
    for (const tf of transforms) {
      const reflected = uvPts.map(tf).map(({ u, v }) => uvToScreen(u, v));
      ctx.beginPath();
      reflected.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      // the copy LOSING the primary role keeps its hole for the length of the fade, so the two
      // regions dissolve past each other instead of one blinking out (B645)
      if (foldFade < 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1 - foldFade;
        ctx.fill();
        ctx.restore();
      }
      // ...and the reflections run the SAME ramp backwards, since one of them was the primary a
      // moment ago. One function, two directions — so the two can never drift apart (B645).
      const rs = roleStyle(1 - refFadeP, sw);
      ctx.fillStyle = `rgba(${rs.rgb[0]}, ${rs.rgb[1]}, ${rs.rgb[2]}, ${rs.fill * reflectFade})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rs.rgb[0]}, ${rs.rgb[1]}, ${rs.rgb[2]}, ${rs.alpha * reflectFade})`;
      ctx.setLineDash(rs.dash);
      ctx.lineWidth = rs.width;
      ctx.stroke();
    }
    ctx.restore();
  }

  // outline of primary wedge — solid white inside image bounds, dashed amber
  // when the polygon crosses the image edge. edge-specific highlight: scale-on-arc
  // brightens outer edges; scale-on-spoke brightens spokes; rotate brightens all.
  const cxPx = imgX + state.sliceCx * imgW;
  const cyPx = imgY + state.sliceCy * imgH;
  const SPOKE_EPS_DRAW = 1.0;
  const spokeEdges = [];
  const outerEdges = [];
  // Only split edges into spokes vs outer when the form has a functional spoke
  // distinction (radial: spokes = segments handle; hex: spokes = visual artifact
  // suppressed for scale). For spokeRule:'none' forms, treat all edges as outer
  // so they all highlight on scale-drag (e.g. triangle's rhombus, where the apex
  // sits at slice center but all edges are still cell boundaries).
  const splitSpokes = form.spokeRule !== 'none';
  for (let i = 0; i < screenPts.length; i++) {
    const a = screenPts[i];
    const b = screenPts[(i + 1) % screenPts.length];
    if (splitSpokes) {
      const aIsCenter = Math.hypot(a.x - cxPx, a.y - cyPx) < SPOKE_EPS_DRAW;
      const bIsCenter = Math.hypot(b.x - cxPx, b.y - cyPx) < SPOKE_EPS_DRAW;
      if (aIsCenter || bIsCenter) { spokeEdges.push({ a, b }); continue; }
    }
    outerEdges.push({ a, b });
  }

  // `closed` (Build 223): draw the boundary as ONE continuous path so its corners JOIN.
  // The per-edge moveTo/lineTo path (used for spokes) leaves butt-ended, unjoined corners
  // at the polygon vertices — the "rough corners" cleanup. Assumes the edges are sequential
  // around the loop (e[i].b === e[i+1].a), which holds for the slice polygon boundary.
  // REVERT: drop the `closed` branch + the `true` arg at the outerEdges call.
  function strokeEdges(edges, highlighted, closed) {
    const fadeP = foldFade;
    if (edges.length === 0) return;
    // primary outline is ALWAYS solid white — "as if there were no reflection" (Daniel). The
    // fact that the wedge crosses the source edge is communicated by the reflected copies
    // (dashed amber + fill) and the dashed EDGE SEAM on the source boundary (drawn below), not
    // by dashing the whole primary. Reads honestly + form-agnostically.
    // B642/B645 — the primary eases in FROM the reflection's whole look (colour, weight, dash,
    // opacity), which is what this same copy was wearing a moment ago as a reflection.
    const st = roleStyle(fadeP, sw);
    ctx.strokeStyle = `rgba(${st.rgb[0]}, ${st.rgb[1]}, ${st.rgb[2]}, ${highlighted ? 1.0 : st.alpha})`;
    ctx.setLineDash(st.dash);
    ctx.lineWidth = highlighted ? 2.5 * sw : st.width;
    const prevJoin = ctx.lineJoin;
    ctx.beginPath();
    if (closed) {
      ctx.lineJoin = 'round';
      ctx.moveTo(edges[0].a.x, edges[0].a.y);
      for (const e of edges) ctx.lineTo(e.b.x, e.b.y);
      // Close the loop ONLY if the chain actually returns to its start (a true closed
      // polygon: square/hex/triangle). Radial's outerEdges is an OPEN arc (the spokes
      // close the shape) — closing it would draw a chord across the wedge mouth.
      const f = edges[0].a, l = edges[edges.length - 1].b;
      if (Math.hypot(l.x - f.x, l.y - f.y) < 1.5) ctx.closePath();
    } else {
      for (const e of edges) {
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
      }
    }
    ctx.stroke();
    ctx.lineJoin = prevJoin;
    ctx.setLineDash([]);
  }

  // B646 — the promoted copy keeps the reflection's tint until the crossfade retires it. Without
  // this the fill only ever eased on ONE side of the swap: the copy gaining the primary role lost
  // its tint instantly, which is the abrupt half Daniel could still see.
  const primaryFill = roleStyle(foldFade, sw).fill * reflectFade;
  if (primaryFill > 0.002) {
    ctx.save();
    ctx.beginPath();
    screenPts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    const pf = mixRGB(REFLECT_RGB, PRIMARY_RGB, foldFade);
    ctx.fillStyle = `rgba(${pf[0]}, ${pf[1]}, ${pf[2]}, ${primaryFill})`;
    ctx.fill();
    ctx.restore();
  }

  const isRotateHover = env.hoverMode === 'rotate';
  const isScaleArcHover = env.hoverMode === 'scale' && !env.hoverOnSpoke;
  const isScaleSpokeHover = env.hoverMode === 'scale' && env.hoverOnSpoke;
  // On touch, hoverMode is always null (no hover events). Mirror the highlight
  // using the active drag mode so the outline lights up during touch gestures.
  const dm = env.overlayDragMode;
  const dragHL      = dm === 'rotate' || dm === 'scale' || dm === 'square-edge' || dm === 'square-corner' || dm === 'pinch';
  const dragHLSpoke = dm === 'segments' || dm === 'pinch';
  strokeEdges(outerEdges, isRotateHover || isScaleArcHover || dragHL, true);   /* closed loop → joined corners */
  strokeEdges(spokeEdges, isRotateHover || isScaleSpokeHover || dragHLSpoke);

  // EDGE SEAM — where the primary wedge crosses a source edge, draw a dashed line along that edge
  // segment (clamped to the visible edge). It's the honest "the fold reflects/clips here" marker
  // AND the scale-drag handle when the true (reflected / off-source) edge is unreachable (Daniel's
  // spec, replacing the fake in-bounds arc). The segments are stashed in _geom.seams so
  // classifyPointer can treat a drag on the seam as a scale (the seam sits at a reachable distance;
  // the ratio-based scale drag handles the rest). The whole highlight scales when the seam is the
  // active/hovered scale target.
  const seamSegs = [];   // {p0,p1} screen segments of the edge seam → stashed in _geom for hit-testing
  const seamActive = env.overlayDragMode === 'scale' || (env.hoverMode === 'scale' && !env.hoverOnSpoke);
  if (oobAnyAxis) {
    // The seam sits at the VISIBLE source boundary = source [0,1] ∩ the canvas viewport. In COVER
    // fit (mobile default) the source overflows the panel, so a source edge can be off-canvas — draw
    // the seam at the reachable PANEL edge instead. In CONTAIN fit this reduces to the source edges
    // (uLo/vLo=0, uHi/vHi=1). Fixes top/bottom seams invisible on mobile cover (Daniel).
    const uLo = Math.max(0, -imgX / imgW), uHi = Math.min(1, (w - imgX) / imgW);
    const vLo = Math.max(0, -imgY / imgH), vHi = Math.min(1, (h - imgY) / imgH);
    const edges = [
      { on: oobLeft,   axis: 'u', at: uLo, sLo: vLo, sHi: vHi },
      { on: oobRight,  axis: 'u', at: uHi, sLo: vLo, sHi: vHi },
      { on: oobTop,    axis: 'v', at: vLo, sLo: uLo, sHi: uHi },
      { on: oobBottom, axis: 'v', at: vHi, sLo: uLo, sHi: uHi },
    ];
    ctx.save();
    ctx.strokeStyle = seamActive ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = (seamActive ? 2.5 : 1.5) * sw;
    for (const e of edges) {
      if (!e.on) continue;
      const hits = [];
      for (let i = 0; i < uvPts.length; i++) {
        const a = uvPts[i], b = uvPts[(i + 1) % uvPts.length];
        const av = e.axis === 'u' ? a.u : a.v, bv = e.axis === 'u' ? b.u : b.v;
        if ((av - e.at) * (bv - e.at) < 0) {            // segment straddles the edge line
          const t = (e.at - av) / (bv - av);
          hits.push(e.axis === 'u' ? a.v + t * (b.v - a.v) : a.u + t * (b.u - a.u));
        }
      }
      if (hits.length < 2) continue;
      const lo = Math.max(e.sLo, Math.min(...hits)), hi = Math.min(e.sHi, Math.max(...hits));  // clamp to visible span
      if (hi <= lo) continue;
      const p0 = e.axis === 'u' ? uvToScreen(e.at, lo) : uvToScreen(lo, e.at);
      const p1 = e.axis === 'u' ? uvToScreen(e.at, hi) : uvToScreen(hi, e.at);
      seamSegs.push({ p0, p1 });
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.restore();
  }

  // sample-region outline: indicator showing the actual fold sample region.
  // Subtler than the main outline (1px @ 0.7 opacity vs 1.5px @ 0.9) so it
  // reads as informational rather than competing with the interactive frame.
  if (sampleScreenPts && sampleScreenPts.length >= 2) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1 * sw;
    ctx.setLineDash([]);
    ctx.beginPath();
    sampleScreenPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // ⚠️ B645 — NO ORIGIN DOTS. They were added at B636 to answer "which copy is about to become
  // primary", and scaling them at B639 so they survived the video made the answer worse than the
  // question: *"we can land in a state with both origin points showing at the same time and their
  // colors are mismatched to the colors of the lines that connect them. also the origin points are
  // conspicuously huge. lets just remove them entirely."*
  //
  // The mismatch was structural rather than a tuning miss — a dot is a fill and the outline is a
  // stroke, so they were being crossfaded by two different rules and could not agree mid-swap. With
  // the whole outline style now morphing, the dot has nothing left to tell you.

  ctx.restore();   // end the image-rect clip opened before the dim (B645) — affordances follow it

  // Touch-only persistent affordances — drawn at ~60% opacity, fading to ~25%
  // during active drag so they don't compete with the active-state stroke highlights.
  if ((IS_TOUCH || env.forceTouchAffordances) && !(env.hideAffordances && env.hideAffordances())) {
    // when segments is locked the spoke/arms grab is inert — suppress its affordance so it doesn't
    // read as draggable (Daniel). Scale/rotate affordances still draw.
    const spokesLocked = !!env.isLocked?.('segments')?.locked;
    drawTouchAffordances(ctx, screenPts, cxPx, cyPx, outerEdges, spokeEdges, form,
      !!env.overlayDragging, env.overlayDragMode ?? null, spokesLocked);
  }

  // store geometry for hit testing
  canvas._geom = { imgX, imgY, imgW, imgH, screenPts, cx: cxPx, cy: cyPx, seams: seamSegs };

  // perform-mode onion skin rides every draw (see drawGhostWedges)
  if (env.performGhosts?.length) drawGhostWedges(env, env.performGhosts);
  drawRemoteFingers(env);
}

// ===========================================================================
// touch affordance drawing
// ===========================================================================

// Persistent touch affordances drawn on top of the polygon outline.
// Only called when IS_TOUCH is true (hover-none devices).
//
// Opacity rules:
//   rest (not dragging)       → 0.55 at 1.5px stroke
//   dragging, affordance active  → 1.00 at 2.5px stroke
//   dragging, affordance inactive → 0.25 at 1.5px stroke
//
// Pinch gestures dim all affordances — the form outline highlight (via dragHL
// in strokeEdges) provides the gesture feedback instead.
function drawTouchAffordances(ctx, screenPts, cx, cy, outerEdges, spokeEdges, form, isDragging, dragMode, spokesLocked = false) {
  const SPOKE_EPS = 2;

  function afStyle(isActive) {
    if (!isDragging) return { op: 0.55, lw: 1.5 };
    return isActive ? { op: 1.00, lw: 2.5 } : { op: 0.25, lw: 1.5 };
  }

  // Pinch excluded: affordances all dim during pinch; outline handles the feedback.
  const rotateActive = isDragging && dragMode === 'rotate';
  const scaleActive  = isDragging && (dragMode === 'scale' || dragMode === 'square-edge');
  const spokesActive = isDragging && dragMode === 'segments';
  const cornerActive = isDragging && dragMode === 'square-corner';

  ctx.save();
  ctx.lineCap = 'round';

  if (form.id === 'square') {
    if (screenPts.length < 4) { ctx.restore(); return; }

    // Screen-relative affordance placement (orientation-independent): one
    // cluster only — a scale arrow on the TOP edge (height), one on the RIGHT
    // edge (width), a diagonal on the TOP-RIGHT corner, and the rotation arc
    // just beyond the right edge. Hit-testing still accepts all edges/corners;
    // this is only which handles we draw (per Daniel: drop the 5 redundant
    // mirror duplicates that crowded the chrome).
    const edgeMids = [];
    for (let i = 0; i < 4; i++) {
      const a = screenPts[i], b = screenPts[(i + 1) % 4];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let nx = -(b.y - a.y) / el, ny = (b.x - a.x) / el;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      edgeMids.push({ mx, my, nx, ny });
    }
    const topEdge   = edgeMids.reduce((p, c) => (c.my < p.my ? c : p));
    const rightEdge = edgeMids.reduce((p, c) => (c.mx > p.mx ? c : p));
    const trVtx     = screenPts.reduce((p, c) => ((c.x - c.y) > (p.x - p.y) ? c : p));

    // Rotation arc beyond the right edge (24px clears its scale arrow).
    const reAng = Math.atan2(rightEdge.my - cy, rightEdge.mx - cx);
    const reR   = Math.hypot(rightEdge.mx - cx, rightEdge.my - cy);
    const { op: rop, lw: rlw } = afStyle(rotateActive);
    afRotationArc(ctx, cx, cy, reAng, reR + 24, rop, rlw);

    // Scale arrows: top edge + right edge.
    const { op: sop, lw: slw } = afStyle(scaleActive);
    afScaleArrow(ctx, topEdge.mx, topEdge.my, topEdge.nx, topEdge.ny, sop, slw);
    afScaleArrow(ctx, rightEdge.mx, rightEdge.my, rightEdge.nx, rightEdge.ny, sop, slw);

    // Diagonal scale arrow: top-right corner.
    const { op: cop, lw: clw } = afStyle(cornerActive);
    const cdx = trVtx.x - cx, cdy = trVtx.y - cy;
    const cLen = Math.hypot(cdx, cdy) || 1;
    afScaleArrow(ctx, trVtx.x, trVtx.y, cdx / cLen, cdy / cLen, cop, clw);

  } else if (form.id === 'triangle') {
    // Triangle's polygon is a horizontal 60-120 rhombus with the slice center
    // at the apex. All 4 edges are scale targets via spokeRule:'none'. Show
    // arrows on the 2 NON-APEX edges (the edges that don't touch slice
    // center). Per Daniel's feedback: dragging away from the apex grows the
    // rhombus, and the apex-incident edges have an asymmetric scale-grace
    // zone (Build 63 mitigated this but the natural grab point is still the
    // far side). Placing arrows on the non-apex edges makes the affordance
    // align with the natural drag direction.
    if (screenPts.length < 4) { ctx.restore(); return; }

    const edges = [];
    for (let i = 0; i < screenPts.length; i++) {
      const a = screenPts[i];
      const b = screenPts[(i + 1) % screenPts.length];
      const aIsApex = Math.hypot(a.x - cx, a.y - cy) < 1;
      const bIsApex = Math.hypot(b.x - cx, b.y - cy) < 1;
      const isApex = aIsApex || bIsApex;
      edges.push({ a, b, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, isApex });
    }
    const nonApexEdges = edges.filter(e => !e.isApex);
    const targetEdges = nonApexEdges.length >= 2
      ? nonApexEdges
      : edges.slice().sort((e1, e2) => e1.my - e2.my).slice(0, 2);

    const { op: sop, lw: slw } = afStyle(scaleActive);
    for (let i = 0; i < Math.min(2, targetEdges.length); i++) {
      const e = targetEdges[i];
      const ex = e.b.x - e.a.x;
      const ey = e.b.y - e.a.y;
      const el = Math.hypot(ex, ey) || 1;
      let nx = -ey / el, ny = ex / el;
      if ((e.mx - cx) * nx + (e.my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      afScaleArrow(ctx, e.mx, e.my, nx, ny, sop, slw);
    }

    let topVtx = screenPts[0];
    for (const p of screenPts) {
      if (p.y < topVtx.y) topVtx = p;
    }
    const topAng = Math.atan2(topVtx.y - cy, topVtx.x - cx);
    const topR   = Math.hypot(topVtx.x - cx, topVtx.y - cy);
    let maxVD = 0;
    for (const p of screenPts) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxVD) maxVD = d;
    }
    const { op: rop, lw: rlw } = afStyle(rotateActive);
    afRotationArc(ctx, cx, cy, topAng, Math.max(topR + 20, maxVD + 16), rop, rlw);

  } else {
    // Wedge forms (radial, hex): centroid of outer edge midpoints gives a stable
    // direction (bisector for radial, outer edge midpoint for hex) without jumps.
    if (outerEdges.length === 0) { ctx.restore(); return; }
    let ocx = 0, ocy = 0;
    for (const edge of outerEdges) {
      ocx += (edge.a.x + edge.b.x) / 2;
      ocy += (edge.a.y + edge.b.y) / 2;
    }
    ocx /= outerEdges.length;
    ocy /= outerEdges.length;
    const outerDist  = Math.hypot(ocx - cx, ocy - cy) || 1;
    const outerAngle = Math.atan2(ocy - cy, ocx - cx);
    const outNx = Math.cos(outerAngle);
    const outNy = Math.sin(outerAngle);

    // Exact polygon boundary at the centroid direction (so the arrow lands on the edge).
    const R = polygonRadiusAt(outerAngle, cx, cy, screenPts) ?? outerDist;

    // Scale arrow — centered on the outer boundary, intersecting the path.
    const { op: sop, lw: slw } = afStyle(scaleActive);
    afScaleArrow(ctx, cx + R * outNx, cy + R * outNy, outNx, outNy, sop, slw);

    // Rotation arc — adaptive gap so it clears the shape at all sizes.
    //   At least 20px beyond the boundary at the centroid direction.
    //   At least 16px beyond the outermost vertex (prevents clipping through corners
    //   on hex, where the vertex is farther from center than the edge midpoint).
    let maxVD = 0;
    for (const p of screenPts) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxVD) maxVD = d;
    }
    const { op: rop, lw: rlw } = afStyle(rotateActive);
    afRotationArc(ctx, cx, cy, outerAngle, Math.max(R + 20, maxVD + 16), rop, rlw);

    // Spoke double-line — radial only, hints at segment-count adjustment.
    // Draw on ALL spoke edges (both sides of the wedge) so the affordance is
    // visible regardless of which side the user looks at. Pre-Build 61 only
    // the first spoke got the marker; after the Y-flip changed which spoke
    // appears at the screen-top, the single marker felt inconsistent.
    if (form.spokeRule === 'radial' && spokeEdges.length > 0 && !spokesLocked) {
      const { op: spop, lw: splw } = afStyle(spokesActive);
      ctx.lineWidth = spokesActive ? splw : 1;
      ctx.strokeStyle = `rgba(255,255,255,${spop * 0.7})`;
      for (const spk of spokeEdges) {
        const aIsCenter = Math.hypot(spk.a.x - cx, spk.a.y - cy) < SPOKE_EPS;
        const origin = aIsCenter ? spk.a : spk.b;
        const tip    = aIsCenter ? spk.b : spk.a;
        const sx = tip.x - origin.x, sy = tip.y - origin.y;
        const slen = Math.hypot(sx, sy) || 1;
        const ux = sx / slen, uy = sy / slen;
        const perpX = -uy, perpY = ux;
        const GAP = 2.5, t0 = slen * 0.2, t1 = slen * 0.68;
        for (const sign of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(origin.x + ux * t0 + perpX * GAP * sign, origin.y + uy * t0 + perpY * GAP * sign);
          ctx.lineTo(origin.x + ux * t1 + perpX * GAP * sign, origin.y + uy * t1 + perpY * GAP * sign);
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
}

// Bidirectional scale arrow at (mx, my) oriented along (nx, ny).
// HALF=14 gives 28px total line (Issue 2: was 14px, too short).
// Exported so the UI Lab can render the REAL affordance primitive (no divergent
// reproduction). Pure: draws on the given 2D context at the given coords.
export function afScaleArrow(ctx, mx, my, nx, ny, op, lw) {
  const HALF = 14, HEAD = 5;
  ctx.strokeStyle = `rgba(255,255,255,${op})`;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(mx - nx * HALF, my - ny * HALF);
  ctx.lineTo(mx + nx * HALF, my + ny * HALF);
  ctx.stroke();
  for (const [tx, ty, dx, dy] of [
    [mx + nx * HALF, my + ny * HALF,  nx,  ny],
    [mx - nx * HALF, my - ny * HALF, -nx, -ny],
  ]) {
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(a + 2.6) * HEAD, ty + Math.sin(a + 2.6) * HEAD);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(a - 2.6) * HEAD, ty + Math.sin(a - 2.6) * HEAD);
    ctx.stroke();
  }
}

// Rotation arc: bidirectional curved arc, centered at (cx,cy), pointing toward
// cAngle direction, at explicit radius arcR. Arrowheads at both ends.
// Exported for the UI Lab (renders the real affordance primitive).
export function afRotationArc(ctx, cx, cy, cAngle, arcR, op, lw) {
  const HSPAN = 11 * Math.PI / 180;
  const HEAD  = 5;
  ctx.strokeStyle = `rgba(255,255,255,${op})`;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, cAngle - HSPAN, cAngle + HSPAN, false);
  ctx.stroke();
  // Arrowheads at both ends: clockwise end (+HSPAN) and counterclockwise end (-HSPAN).
  // Tangent direction at angle a on a clockwise arc (y-down) = a + π/2.
  // Reverse tangent (counterclockwise) = a - π/2.
  for (const [a, tang] of [
    [cAngle + HSPAN, cAngle + HSPAN + Math.PI / 2],
    [cAngle - HSPAN, cAngle - HSPAN - Math.PI / 2],
  ]) {
    const tipX = cx + arcR * Math.cos(a);
    const tipY = cy + arcR * Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(tang + 2.6) * HEAD, tipY + Math.sin(tang + 2.6) * HEAD);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(tang - 2.6) * HEAD, tipY + Math.sin(tang - 2.6) * HEAD);
    ctx.stroke();
  }
}

// ===========================================================================
// hit testing
// ===========================================================================

// The bisector ("middle line") of a radial wedge in SCREEN space, derived from the two
// drawn center-incident spoke edges. Convention-independent (reads the actual geometry,
// not sliceRotation's sign). Antiparallel spokes (the 2-segment half-plane) fall back to a
// perpendicular of one spoke — either is acceptable there by the wedge's symmetry.
function wedgeBisectorRad(g) {
  if (!g || !g.screenPts) return 0;
  const { cx, cy, screenPts: pts } = g;
  const EPS = 1.0;
  const dirs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const aC = Math.hypot(a.x - cx, a.y - cy) < EPS;
    const bC = Math.hypot(b.x - cx, b.y - cy) < EPS;
    if (!aC && !bC) continue;
    const tip = aC ? b : a;
    const dx = tip.x - cx, dy = tip.y - cy, L = Math.hypot(dx, dy) || 1;
    dirs.push({ x: dx / L, y: dy / L });
  }
  if (dirs.length === 0) return 0;
  if (dirs.length === 1) return Math.atan2(dirs[0].y, dirs[0].x);
  let sx = 0, sy = 0;
  for (const d of dirs) { sx += d.x; sy += d.y; }
  if (Math.hypot(sx, sy) < 1e-3) return Math.atan2(dirs[0].x, -dirs[0].y);   // antiparallel → ⟂ to a spoke
  return Math.atan2(sy, sx);
}

// classify pointer position into 'move' | 'scale' | 'rotate' | form-specific | null.
// consults the active form's spokeRule for behavior switching, OR defers to a
// form-supplied classifyPointer override when the form's sample region doesn't
// fit the standard polygon model (droste's annulus, etc.).
function classifyPointer(env, x, y, isTouch = false) {
  const { state, sourceOverlayCanvas } = env;
  const g = sourceOverlayCanvas?._geom;
  if (!g) return { mode: null };

  const form = getActiveForm(state);

  // form-overridable hit testing. forms with bespoke overlays (droste) own
  // their hit-test math too — the built-in polygon-radius logic doesn't apply.
  if (form.classifyPointer) {
    return form.classifyPointer(env, x, y, isTouch, g);
  }
  const { cx, cy, screenPts: pts } = g;
  const px = x - cx;
  const py = y - cy;
  const r = Math.hypot(px, py);
  const theta = Math.atan2(py, px);

  const CENTER = isTouch ? HIT.CENTER_DOT_TOUCH : HIT.CENTER_DOT_MOUSE;
  if (r <= CENTER) return { mode: 'move', r, theta, R: null };

  const SCALE_IN  = isTouch ? HIT.SCALE_BAND_IN_TOUCH  : HIT.SCALE_BAND_IN_MOUSE;
  const SCALE_OUT = isTouch ? HIT.SCALE_BAND_OUT_TOUCH : HIT.SCALE_BAND_OUT_MOUSE;
  const SPOKE_IN  = isTouch ? HIT.SPOKE_BAND_IN_TOUCH  : HIT.SPOKE_BAND_IN_MOUSE;
  const SPOKE_OUT = isTouch ? HIT.SPOKE_BAND_OUT_TOUCH : HIT.SPOKE_BAND_OUT_MOUSE;

  let R = polygonRadiusAt(theta, cx, cy, pts);
  let outsideAngular = false;
  if (R == null) {
    R = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.y - cy)));
    outsideAngular = true;
  }

  // EDGE-SEAM scale handle: when the wedge crosses the source edge, its true outer boundary is
  // off-source/unreachable — so a drag on the dashed edge seam (drawn along the source boundary in
  // drawSourceOverlay) scales instead (Daniel). Priority near the seam; the generic ratio-based
  // scale drag (startR = pointer distance) does the rest. Segments come from _geom.seams.
  if (g.seams && g.seams.length) {
    for (const seg of g.seams) {
      const ex = seg.p1.x - seg.p0.x, ey = seg.p1.y - seg.p0.y;
      const elen = Math.hypot(ex, ey) || 1;
      const ux = ex / elen, uy = ey / elen;
      const projT = (x - seg.p0.x) * ux + (y - seg.p0.y) * uy;
      if (projT < -SCALE_OUT || projT > elen + SCALE_OUT) continue;   // within the seam span (+grace)
      const perp = Math.abs((x - seg.p0.x) * (-uy) + (y - seg.p0.y) * ux);
      if (perp <= SCALE_OUT) return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: theta };
    }
  }

  // Per-edge proximity check — for forms whose slice center sits at a polygon
  // vertex (e.g., triangle's rhombus apex). The standard CASE A check measures
  // "distance from outer angular boundary," which misses apex-incident edges
  // that lie INTERIOR to the polygon's angular range. For these forms, treat
  // any polygon edge within SCALE_OUT as a scale target. When the cursor is
  // angularly outside the polygon (outsideAngular), only apex-incident edges
  // count — those edges form the polygon's angular boundary, so cursor close
  // to one perpendicular-wise is the natural scale-grace zone on the outside.
  // Without that allowance, the apex-incident edge had only HALF the grace
  // zone of a non-apex edge (inside-perpendicular only).
  const sliceCenterAtVertex = pts.some(p => Math.hypot(p.x - cx, p.y - cy) < 1);
  if (form.spokeRule === 'none' && sliceCenterAtVertex) {
    // Rhombus (triangle): thin interior scale band so most of the interior is a
    // MOVE target. Signed perpendicular per edge (positive = outside the
    // polygon): scale only within a small interior band or a modest exterior
    // band; everything else inside is move, outside is rotate. Self-contained —
    // we don't fall through to CASE A, whose radial scale band would re-inflate
    // the interior scale region this branch is meant to trim.
    const APEX_EPS = 1.0;
    const SC_IN  = isTouch ? HIT.RHOMBUS_SCALE_IN_TOUCH  : HIT.RHOMBUS_SCALE_IN_MOUSE;
    const SC_OUT = isTouch ? HIT.RHOMBUS_SCALE_OUT_TOUCH : HIT.RHOMBUS_SCALE_OUT_MOUSE;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIsCenter = Math.hypot(a.x - cx, a.y - cy) < APEX_EPS;
      const bIsCenter = Math.hypot(b.x - cx, b.y - cy) < APEX_EPS;
      const isApexEdge = aIsCenter || bIsCenter;
      // Skip non-apex edges when angularly outside the polygon — those edges
      // are interior to the polygon's angular range, so cursor outside the
      // range can't be perpendicular-close to one in a useful way.
      if (outsideAngular && !isApexEdge) continue;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const elen = Math.hypot(ex, ey) || 1;
      const ux = ex / elen, uy = ey / elen;
      const projT = (x - a.x) * ux + (y - a.y) * uy;
      if (projT < 0 || projT > elen) continue;
      // outward normal (away from polygon center) → signed distance from edge.
      let nx = -uy, ny = ux;
      const mxE = (a.x + b.x) / 2, myE = (a.y + b.y) / 2;
      if ((mxE - cx) * nx + (myE - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const signed = (x - a.x) * nx + (y - a.y) * ny;
      if (signed >= -SC_IN && signed <= SC_OUT) {
        return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: theta };
      }
    }
    if (!outsideAngular && r <= R) return { mode: 'move', r, theta, R };
    return { mode: 'rotate', r, theta, R };
  }

  // square form helper: classify cursor as near a CORNER or EDGE of the rect.
  const CORNER_ZONE = isTouch ? 44 : 28;
  function squareHandle() {
    if (form.id !== 'square' || pts.length !== 4) return null;
    let bestVtx = null;
    for (let i = 0; i < 4; i++) {
      const v = pts[i];
      const d = Math.hypot(v.x - x, v.y - y);
      if (bestVtx == null || d < bestVtx.d) bestVtx = { d, v };
    }
    let bestEdge = null;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = Math.hypot(mx - x, my - y);
      if (bestEdge == null || d < bestEdge.d) bestEdge = { d, mx, my, a, b };
    }
    if (bestVtx.d < CORNER_ZONE && bestVtx.d < bestEdge.d) {
      const vsx = bestVtx.v.x - cx, vsy = bestVtx.v.y - cy;
      return {
        kind: 'corner',
        signX: Math.sign(vsx) || 1,
        signY: Math.sign(vsy) || 1,
        vx: bestVtx.v.x, vy: bestVtx.v.y,
      };
    }
    const ex = bestEdge.b.x - bestEdge.a.x;
    const ey = bestEdge.b.y - bestEdge.a.y;
    const elen = Math.hypot(ex, ey) || 1;
    const tx = ex / elen, ty = ey / elen;
    let nx = -ty, ny = tx;
    const out = (bestEdge.mx - cx) * nx + (bestEdge.my - cy) * ny;
    if (out < 0) { nx = -nx; ny = -ny; }
    return {
      kind: 'edge',
      tx, ty, nx, ny,
      mx: bestEdge.mx, my: bestEdge.my,
    };
  }

  const SPOKE_EPS = 1.0;
  function nearestSpoke() {
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIsCenter = Math.hypot(a.x - cx, a.y - cy) < SPOKE_EPS;
      const bIsCenter = Math.hypot(b.x - cx, b.y - cy) < SPOKE_EPS;
      if (!aIsCenter && !bIsCenter) continue;
      const tip = aIsCenter ? b : a;
      const sx = tip.x - cx, sy = tip.y - cy;
      const slen = Math.hypot(sx, sy) || 1;
      const ux = sx / slen, uy = sy / slen;
      const t = px * ux + py * uy;
      if (t < -SPOKE_OUT || t > slen + SPOKE_OUT) continue;
      const perp = px * (-uy) + py * ux;
      const absPerp = Math.abs(perp);
      if (best == null || absPerp < best.absPerp) {
        best = { ux, uy, t, slen, perp, absPerp };
      }
    }
    return best;
  }

  // for hex: closest polygon edge by perpendicular distance — if it's a spoke
  // edge (long side of the wedge representation), suppress scale classification.
  function isClosestEdgeSpoke() {
    let bestPerp = Infinity;
    let bestIsSpoke = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const elen = Math.hypot(ex, ey) || 1;
      const ux = ex / elen, uy = ey / elen;
      const projT = (x - a.x) * ux + (y - a.y) * uy;
      if (projT < 0 || projT > elen) continue;
      const perpDist = Math.abs((x - a.x) * (-uy) + (y - a.y) * ux);
      if (perpDist < bestPerp) {
        bestPerp = perpDist;
        const aIsCenter = Math.hypot(a.x - cx, a.y - cy) < SPOKE_EPS;
        const bIsCenter = Math.hypot(b.x - cx, b.y - cy) < SPOKE_EPS;
        bestIsSpoke = aIsCenter || bIsCenter;
      }
    }
    return bestIsSpoke;
  }

  function spokePerpAngle(sp) {
    return Math.atan2(sp.ux, -sp.uy);
  }

  // CASE A: cursor angle is INSIDE the polygon's angular range
  if (!outsideAngular) {
    // radial: spoke proximity = scale-on-spoke (= segments) — but the outer
    // arc's scale band OUTRANKS the spoke. A pointer within the arc band (where
    // the scale arrow sits) must scale, never change segments: the touch-width
    // spoke band otherwise claims the arc's ends (spoke tips) and, on narrow
    // wedges, the whole arc including the arrow. Segments keep the spoke's
    // interior length.
    if (form.spokeRule === 'radial' && Math.abs(r - R) > (r <= R ? SCALE_IN : SCALE_OUT)) {
      const sp = nearestSpoke();
      if (sp && sp.absPerp <= Math.max(SPOKE_IN, SPOKE_OUT)) {
        const allowable = (r <= R) ? SPOKE_IN : SPOKE_OUT;
        if (sp.absPerp <= allowable && sp.t >= 0 && sp.t <= sp.slen + SPOKE_OUT) {
          return {
            mode: 'scale', r, theta, R,
            onSpoke: true, spoke: sp,
            cursorTheta: spokePerpAngle(sp),
          };
        }
      }
    }
    // hex: skip scale if closest edge is a spoke (visual artifact, not a cell boundary).
    const skipScaleForSpokeOnHex = form.spokeRule === 'hex' && isClosestEdgeSpoke();
    if (r <= R) {
      if (R - r <= SCALE_IN && !skipScaleForSpokeOnHex) {
        const sh = squareHandle();
        const ct = sh ? squareHandleCursorAngle(sh, cx, cy) : theta;
        return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: ct, square: sh };
      }
      return { mode: 'move', r, theta, R };
    }
    if (r - R <= SCALE_OUT && !skipScaleForSpokeOnHex) {
      const sh = squareHandle();
      const ct = sh ? squareHandleCursorAngle(sh, cx, cy) : theta;
      return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: ct, square: sh };
    }
    return { mode: 'rotate', r, theta, R };
  }

  // CASE B: cursor angle is OUTSIDE the polygon's angular range (radial wedges).
  // most space here is rotate; spoke-adjacent regions retain spoke-scale band.
  if (form.spokeRule === 'radial') {
    const sp = nearestSpoke();
    if (sp && sp.absPerp <= SPOKE_OUT && sp.t >= 0 && sp.t <= sp.slen + SPOKE_OUT) {
      return {
        mode: 'scale', r, theta, R,
        onSpoke: true, spoke: sp,
        cursorTheta: spokePerpAngle(sp),
      };
    }
  }
  return { mode: 'rotate', r, theta, R };
}

// for square form: handle hit → angle that should drive cursor selection.
// EDGE: the edge normal direction — cursor stays perpendicular to the edge as
//   the cursor moves along it.
// CORNER: a fixed 45° diagonal aligned with the corner's quadrant. uses the
//   SIGNS (not magnitudes) of the corner's offset from cell center, so the
//   cursor stays diagonal regardless of cell aspect ratio. without this, a
//   wide rectangle's corner would sit at a near-horizontal angle and the
//   cursor would discretize to ew-resize — visually breaking the "this is a
//   uniform-scale gesture" affordance.
function squareHandleCursorAngle(handle, cx, cy) {
  if (handle.kind === 'edge') {
    return Math.atan2(handle.ny, handle.nx);
  }
  if (handle.kind === 'corner') {
    return Math.atan2(handle.signY, handle.signX);
  }
  return 0;
}

// ===========================================================================
// drag dispatch
// ===========================================================================

// Handlers attached by the most recent mount — tracked so we remove them before
// re-binding. mountSourceView re-runs on every swap / fit-toggle / divider re-fit
// / source change with the SAME persistent slot element (`wrap`), and clearing
// the slot's innerHTML drops the canvas but NOT the slot's own listeners. Both
// the wrap-level AND window-level listeners must be removed: a leaked wrap
// `mousemove`/`touchmove` makes the accumulative rotate gesture fire N times per
// move, multiplying a 90° drag into 2-3× the rotation (it's the only gesture
// that sums deltas; absolute move/scale are immune, which is why only rotate ran
// away). Single active source overlay per chrome, so a module singleton is fine.
let _attachedHandlers = null;

export function setupSourceInteraction(env, wrap) {
  if (_attachedHandlers) {
    // A re-mount mid-gesture never delivers the pointerup that would clear this, and a stranded
    // `true` would disable the fold for the whole session with nothing said — the "anything that
    // can decline to act must publish why" rule, answered by making it unable to strand.
    clearGestures();
    const h = _attachedHandlers;
    h.wrap.removeEventListener('mousedown', h.onDown);
    h.wrap.removeEventListener('mousemove', h.onMove);
    h.wrap.removeEventListener('touchstart', h.onDown);
    h.wrap.removeEventListener('touchmove', h.onMove);
    h.wrap.removeEventListener('wheel', h.onWheel);
    window.removeEventListener('mouseup', h.onUp);
    window.removeEventListener('touchend', h.onUp);
    window.removeEventListener('touchcancel', h.onUp);
  }

  let drag = null;

  function localCoords(e) {
    const rect = wrap.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x, y };
  }

  function uvFromXY(x, y) {
    const g = env.sourceOverlayCanvas?._geom;
    if (!g) return null;
    const u = (x - g.imgX) / g.imgW;
    const v = (y - g.imgY) / g.imgH;
    return { u, v };
  }

  function setCursor(c) {
    wrap.style.cursor = c;
  }

  function cursorForMode(mode, theta) {
    if (mode === 'move')          return 'grab';
    if (mode === 'scale')         return scaleCursorForAngle(theta);
    if (mode === 'rotate')        return rotateCursorForAngle(theta);
    if (mode === 'droste-arms')   return scaleCursorForAngle(theta);
    if (mode === 'droste-offset') return 'grab';
    return 'default';
  }

  function onMove(e) {
    const isTouch = !!e.touches;

    // two-finger pinch: scale + rotate + reposition the slice.
    if (drag?.mode === 'pinch' && e.touches?.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
      const { state } = env;
      state.sliceScale    = Math.max(0.05, Math.min(10, drag.startScale * (dist / drag.startDist)));
      let da = (angle - drag.startAngle) * 180 / Math.PI;
      // Y-flip in overlay means sliceRotation must be negated to keep the
      // wedge graphic rotating in the same screen direction as the fingers.
      // The apex-orbit below uses da_rad as-is (it's a position rotation in
      // screen y-down, unaffected by the wedge-direction flip).
      //
      // B635 — and the determinant on top, for the same reason as the one-finger rotate: a
      // reflected wedge turns the other way for the same `sliceRotation` step. The ORBIT below
      // takes no determinant, because it moves a point in UV and UV→screen has no mirror in it —
      // only slice→UV does.
      state.sliceRotation = ((drag.startRotation - sliceDet(state) * da) % 360 + 360) % 360;
      // Rotate the apex around the finger midpoint — the standard two-finger
      // rigid-body transform. This keeps the midpoint as the true pivot so the
      // wedge tracks naturally under the fingers. Without this, rotation orbits
      // the apex (the wedge tip), which feels disconnected from where you're
      // actually touching.
      const g = env.sourceOverlayCanvas?._geom;
      if (g && drag.startPivotUV) {
        const rect = wrap.getBoundingClientRect();
        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
        const curMid = uvFromXY(midX, midY);
        if (curMid) {
          const da_rad = da * Math.PI / 180;
          const cosA = Math.cos(da_rad);
          const sinA = Math.sin(da_rad);
          // B635 — orbit the SAMPLED BOX, not the origin, for the same reason `move` does: the
          // fold rewrites the origin mid-gesture, so a transform anchored on `startCx` would fight
          // it every frame. The box centre is absolute and re-solved from the current scale and
          // handedness each frame, so a fold partway through a pinch costs nothing.
          const dx = drag.startBoxU - drag.startPivotUV.u;
          const dy = drag.startBoxV - drag.startPivotUV.v;
          Object.assign(state, placeSliceBox(getActiveForm(state), state, env.engine.getSourceAspect(),
            curMid.u + dx * cosA - dy * sinA,
            curMid.v + dx * sinA + dy * cosA));
          // Re-baseline the pinch on a fold, for the same reason the move drag re-anchors: this
          // branch recomputes its target from `startBox`/`startPivot` every frame, so a stale
          // baseline would undo the fold on the very next touch event. Rebasing on the current
          // fingers is "let go and re-pinch", which is what the operator perceives anyway.
          if (normalizeSliceMirror(env)) {
            const nb = sliceBoxCenter(getActiveForm(state), state, env.engine.getSourceAspect());
            if (nb) { drag.startBoxU = nb.x; drag.startBoxV = nb.y; }
            drag.startPivotUV = curMid;
            drag.startAngle = angle;
            drag.startDist = dist;
            drag.startScale = state.sliceScale;
            drag.startRotation = state.sliceRotation;
          }
        }
      }
      env.syncControls();
      env.scheduleRender();
      env.scheduleOverlayDraw();
      e.preventDefault();
      return;
    }

    const { x, y } = localCoords(e);

    if (drag) {
      const { state } = env;
      const g = env.sourceOverlayCanvas?._geom;

      if (drag.mode === 'move') {
        const newCxPx = x + drag.dragOffsetX;
        const newCyPx = y + drag.dragOffsetY;
        const uv = uvFromXY(newCxPx, newCyPx);
        if (!uv) return;
        // ⚠️ B635 — MOVE DRAGS THE SAMPLED BOX, NOT THE ORIGIN. Writing the origin straight from
        // the pointer fights the fold: the fold reflects the origin, the next pointer event puts it
        // straight back, and the two alternate every frame — a strobing slice. Worse, after a
        // reflection the origin and the box travel in OPPOSITE directions, so an origin-space drag
        // would send the visible slice away from the finger, which is the exact disorientation the
        // fold exists to remove.
        //
        // The box centre is the thing the operator is actually pointing at and the thing the fold
        // bounds, so targeting it makes the two agree by construction. `placeSliceBox` solves for
        // the origin in one step, so this stays a direct manipulation, not a search.
        Object.assign(state, placeSliceBox(getActiveForm(state), state, env.engine.getSourceAspect(), uv.u, uv.v));
      } else if (drag.mode === 'scale') {
        if (!g) return;
        const r = Math.hypot(x - g.cx, y - g.cy);
        if (drag.startR < 1) return;
        let newScale = drag.startScale * (r / drag.startR);
        newScale = Math.max(0.05, Math.min(5, newScale));
        state.sliceScale = newScale;
      } else if (drag.mode === 'square-edge') {
        if (!g) return;
        const perpNow = (x - g.cx) * drag.nx + (y - g.cy) * drag.ny;
        if (Math.abs(drag.startPerp) < 1) return;
        let r = perpNow / drag.startPerp;
        if (r < 0.05) r = 0.05;
        const newAspect = drag.axis === 'x'
          ? drag.startAspect * r
          : drag.startAspect / r;
        const newScale  = drag.startSliceScale * Math.sqrt(r);
        state.squareAspect = Math.max(0.25, Math.min(4, newAspect));
        state.sliceScale   = Math.max(0.05, Math.min(5, newScale));
      } else if (drag.mode === 'square-corner') {
        if (!g) return;
        const startDx = drag.startVx - drag.startCx;
        const startDy = drag.startVy - drag.startCy;
        const nowDx   = x - g.cx;
        const nowDy   = y - g.cy;
        if (e.shiftKey) {
          const rx = Math.abs(startDx) > 1 ? nowDx / startDx : 1;
          const ry = Math.abs(startDy) > 1 ? nowDy / startDy : 1;
          const rx2 = Math.max(0.05, rx);
          const ry2 = Math.max(0.05, ry);
          const newAspect = drag.startAspect * (rx2 / ry2);
          const newScale  = drag.startSliceScale * Math.sqrt(rx2 * ry2);
          state.squareAspect = Math.max(0.25, Math.min(4, newAspect));
          state.sliceScale   = Math.max(0.05, Math.min(5, newScale));
        } else {
          const startD = Math.hypot(startDx, startDy);
          const nowD   = Math.hypot(nowDx, nowDy);
          if (startD < 1) return;
          let r = nowD / startD;
          r = Math.max(0.05, r);
          state.sliceScale = Math.max(0.05, Math.min(5, drag.startSliceScale * r));
        }
      } else if (drag.mode === 'segments') {
        if (!g) return;
        // half-wedge = the pointer's angular distance from the wedge bisector. Pull the
        // spoke AWAY from the middle → wider half-wedge → fatter wedge → fewer segments;
        // pull it toward the middle → skinnier → more segments. Symmetric for either spoke.
        let rel = Math.atan2(y - g.cy, x - g.cx) - drag.bisectorRad;
        while (rel > Math.PI)  rel -= 2 * Math.PI;
        while (rel < -Math.PI) rel += 2 * Math.PI;
        const halfWedge = Math.min(Math.PI / 2, Math.max(Math.PI / 48, Math.abs(rel)));
        let newSegs = Math.round(Math.PI / halfWedge);   // segments = π / halfWedge (full wedge = 2·halfWedge)
        if (newSegs % 2 !== 0) newSegs += 1;
        newSegs = Math.max(2, Math.min(48, newSegs));
        if (newSegs !== state.segments) {
          state.segments = newSegs;
        }
      } else if (drag.mode === 'rotate') {
        // Compute the pointer angle in the FROZEN frame snapshotted at drag start
        // (drag.rect + drag.cx0/cy0), not the live panel rect. If the source
        // panel reflows mid-drag (e.g. iPhone Safari hiding its address bar fires
        // resize), the live rect would shift under the snapshot center and inject
        // spurious angle that accumulates — the wedge then spins far faster than
        // the finger. Freezing the frame keeps rotation tracking the finger 1:1.
        const fx = (e.touches ? e.touches[0].clientX : e.clientX) - drag.rect.left;
        const fy = (e.touches ? e.touches[0].clientY : e.clientY) - drag.rect.top;
        const a = Math.atan2(fy - drag.cy0, fx - drag.cx0);
        let delta = a - drag.prevAngle;
        if (delta > Math.PI)  delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        drag.prevAngle = a;
        // B635 — a reflected slice turns the other way. `sliceRotation` is applied BEFORE the
        // handedness flip, so under an odd number of mirrors a positive step rotates the drawn
        // wedge counter to the finger. Multiplying by the determinant is the whole correction, and
        // skipping it would re-create the "gestures do the opposite of what you'd expect" report
        // that motivated this feature in the first place.
        state.sliceRotation = state.sliceRotation - sliceDet(state) * delta * 180 / Math.PI;
      } else if (drag.mode === 'droste-ratio') {
        // inner-ring radial drag — feel matches outer-ring scale-drag (relative,
        // r_now / r_start), but moves the inner ring instead of the outer.
        // dragging inward shrinks the inner ring, raising drosteZoom.
        if (!g) return;
        const r = Math.hypot(x - g.cx, y - g.cy);
        if (drag.startR < 1 || r < 1) return;
        const ratio = drag.startR / r;
        const newZoom = Math.max(1.1, Math.min(16, drag.startZoom * ratio));
        state.drosteZoom = newZoom;
      } else if (drag.mode === 'droste-arms') {
        // drag a wedge boundary line angularly to change the arms count. the
        // cursor's |relative angle from sliceRotation| becomes the new
        // halfWedge; arms = π / halfWedge, snapped to the valid set {1, 2, 4,
        // 6, 8, 10, 12}. arms change cascades into the twist snap step via
        // env.applyArmsSnap.
        if (!g) return;
        const cursorAngle = Math.atan2(y - g.cy, x - g.cx);
        let rel = cursorAngle - drag.sliceRotationRad;
        while (rel > Math.PI)  rel -= 2 * Math.PI;
        while (rel < -Math.PI) rel += 2 * Math.PI;
        const newHalfWedge = Math.max(Math.PI / 12, Math.min(Math.PI, Math.abs(rel)));
        const armsFloat = Math.PI / newHalfWedge;
        let newArms;
        if (armsFloat < 1.5) newArms = 1;
        else newArms = Math.max(2, Math.min(12, Math.round(armsFloat / 2) * 2));
        if (newArms !== state.drosteArms) {
          state.drosteArms = newArms;
          env.applyArmsSnap?.();
        }
      } else if (drag.mode === 'droste-offset') {
        // direct manipulation: cursor → canvas-NDC offset (drives Möbius
        // pre-comp + source-side per-tier drift). drosteOffset is in
        // canvas-NDC y-up; screen is y-down, so negate dys. No sliceRotation
        // applied: diamond's overlay-screen position corresponds directly to
        // the spiral pole's canvas-screen position regardless of wedge angle.
        if (!g || g.rOut < 1) return;
        // B635 — invert droste's own mirrored placement of the diamond (see its drawOverlay). The
        // signs are ±1 and self-inverse, so the same multiply serves both directions.
        state.drosteOffsetX = ((x - g.cx) / g.rOut) * (g.mx ?? 1);
        state.drosteOffsetY = -((y - g.cy) / g.rOut) * (g.my ?? 1);
      }
      // ONE site every drag branch falls through to (kept from B633 — a call each branch has to
      // remember is a call some future branch forgets, and that already happened once). What runs
      // here changed at B635: no longer a clamp fighting the drag, but the fold, which re-expresses
      // the state as the reflection you can actually see.
      // ⚠️ RE-ANCHOR THE DRAG ON A FOLD, or the gesture strobes. `move` derives its target from the
      // pointer every frame, so without this the next event would put the slice straight back where
      // the fold just took it from, and the two would alternate at frame rate. Re-deriving the grab
      // offset from where the slice now IS makes the fold behave exactly like letting go and
      // re-grabbing at the same finger position — the drag simply continues.
      if (normalizeSliceMirror(env) && drag.mode === 'move') {
        const gg = env.sourceOverlayCanvas?._geom;
        const box = gg && sliceBoxCenter(getActiveForm(state), state, env.engine.getSourceAspect());
        if (box) {
          drag.dragOffsetX = (gg.imgX + box.x * gg.imgW) - x;
          drag.dragOffsetY = (gg.imgY + box.y * gg.imgH) - y;
        }
      }
      env.syncControls();
      env.scheduleRender();
      e.preventDefault();
    } else {
      // hover — set cursor based on what mode this position would activate.
      const cls = classifyPointer(env, x, y, isTouch);
      // the segment/arms grab (droste-arms, or a radial spoke) is inert while segments is locked,
      // so present it as NON-interactive — default cursor, no spoke highlight — instead of a resize
      // cursor over a control that won't move (Daniel: it "appears interactable" while locked).
      const discreteGrab = cls.mode === 'droste-arms' || (cls.mode === 'scale' && cls.onSpoke);
      if (discreteGrab && env.isLocked?.('segments')?.locked) {
        setCursor('default');
        if (env.hoverMode !== null || env.hoverOnSpoke || env.hoverHandle !== null) {
          env.hoverMode = null; env.hoverOnSpoke = false; env.hoverHandle = null;
          env.scheduleOverlayDraw();
        }
      } else {
        const cursorAngle = cls.cursorTheta != null ? cls.cursorTheta : cls.theta;
        setCursor(cursorForMode(cls.mode, cursorAngle));
        // discoverability: redraw if hover mode changed for stroke highlighting.
        const newHandle = cls.handle || null;
        if (cls.mode !== env.hoverMode
            || (cls.onSpoke || false) !== env.hoverOnSpoke
            || newHandle !== env.hoverHandle) {
          env.hoverMode = cls.mode;
          env.hoverOnSpoke = cls.onSpoke || false;
          env.hoverHandle = newHandle;
          env.scheduleOverlayDraw();
        }
      }
    }
  }

  function onDown(e) {
    if (!env.engine.getSourceImage()) return;
    // read-only while an animation drives the state (playback/scrub): the edit would
    // be clobbered next tick and would leak into the live-output broadcast. Bail
    // before pushHistory so we don't log a no-op undo entry.
    if (env.editLocked && env.editLocked()) return;
    env.pushHistory?.();
    const isTouch = !!e.touches;

    // two-finger touch: enter pinch mode regardless of hit zone.
    if (e.touches?.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const rect = wrap.getBoundingClientRect();
      env.overlayDragging = true;
      holdGesture('overlay');        // B638/B639 — see kit/gesture-gate
      env.overlayDragMode = 'pinch';
      const pinchBox = sliceBoxCenter(getActiveForm(env.state), env.state, env.engine.getSourceAspect());
      drag = {
        mode: 'pinch',
        startDist:     Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        startAngle:    Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
        startScale:    env.state.sliceScale,
        startRotation: env.state.sliceRotation,
        startCx:       env.state.sliceCx,
        startCy:       env.state.sliceCy,
        // B635 — the pinch orbits this, not the origin (see onMove's pinch branch). Measured ONCE
        // (B636): the two axes came from two separate calls, which built the polygon twice.
        startBoxU:     pinchBox?.x ?? env.state.sliceCx,
        startBoxV:     pinchBox?.y ?? env.state.sliceCy,
        startPivotUV:  uvFromXY((t0.clientX + t1.clientX) / 2 - rect.left,
                                (t0.clientY + t1.clientY) / 2 - rect.top),
      };
      e.preventDefault();
      return;
    }

    const { x, y } = localCoords(e);
    const cls = classifyPointer(env, x, y, isTouch);
    if (!cls.mode) return;

    // discrete edits are blocked when the host says so (motion mode after a keyframe):
    // droste-arms drag becomes a no-op; the radial spoke falls through to a scale drag.
    const allowDiscrete = env.canEditDiscrete ? env.canEditDiscrete() : true;
    // droste-arms IS the droste segment count → honor the 'segments' lock (no-op when locked)
    if ((!allowDiscrete || env.isLocked?.('segments')?.locked) && cls.mode === 'droste-arms') return;

    env.overlayDragging = true;
    holdGesture('overlay');          // B638/B639
    const g = env.sourceOverlayCanvas._geom;
    const { state } = env;
    const form = getActiveForm(state);

    if (cls.mode === 'move') {
      // B635 — the grab offset is measured to the SAMPLED BOX centre, matching what onMove now
      // drives. `g.cx/cy` is the ORIGIN in screen px, which is a different point on droste (its
      // origin sits at the middle of the annulus while the wedge you grabbed is off to one side)
      // and after a fold moves the opposite way. Falling back to the origin keeps a form with no
      // measurable outline behaving exactly as before.
      const box = sliceBoxCenter(form, state, env.engine.getSourceAspect());
      const boxPx = box ? { x: g.imgX + box.x * g.imgW, y: g.imgY + box.y * g.imgH } : { x: g.cx, y: g.cy };
      drag = {
        mode: 'move',
        dragOffsetX: boxPx.x - x,
        dragOffsetY: boxPx.y - y,
      };
      setCursor('grabbing');
    } else if (cls.mode === 'scale' && cls.onSpoke && form.spokeRule === 'radial' && allowDiscrete && !env.isLocked?.('segments')?.locked) {
      // locked → this falls through to the scale drag below (same as the !allowDiscrete path)
      drag = {
        mode: 'segments',
        startSegments: state.segments,
        spoke: cls.spoke,
        // the wedge bisector (its "middle line") in screen space, from the two drawn
        // spoke directions. Measuring the pointer's angle from THIS makes widen/narrow
        // symmetric no matter which spoke you grabbed — fixes the inverted-direction feel.
        bisectorRad: wedgeBisectorRad(g),
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta));
    } else if (cls.mode === 'scale' && form.id === 'square' && cls.square && cls.square.kind === 'edge') {
      drag = {
        mode: 'square-edge',
        startSliceScale: state.sliceScale,
        startAspect:     state.squareAspect,
        startCursor:     { x, y },
        nx: cls.square.nx,
        ny: cls.square.ny,
        startPerp: (cls.square.mx - g.cx) * cls.square.nx + (cls.square.my - g.cy) * cls.square.ny,
        axis: (() => {
          // cls.square.ny is the edge normal in screen y-down (post-Y-flip
          // overlay coords). sliceRotation is in raw shader convention.
          // Negate ny to compensate for the overlay's Y-flip so the rel angle
          // correctly classifies whether this edge's normal aligns with the
          // rectangle's local x-axis (long dim) or y-axis (short dim).
          // Without this, rotating the rectangle inverted which edge was
          // labeled 'x' vs 'y', causing aspect drag to adjust the wrong axis.
          const normalAngle = Math.atan2(-cls.square.ny, cls.square.nx);
          const rotRad = state.sliceRotation * Math.PI / 180;
          const rel = normalAngle - rotRad;
          let r = ((rel % (2 * Math.PI)) + 2 * Math.PI + Math.PI) % (2 * Math.PI) - Math.PI;
          return Math.abs(Math.cos(r)) > Math.abs(Math.sin(r)) ? 'x' : 'y';
        })(),
      };
      setCursor(scaleCursorForAngle(Math.atan2(cls.square.ny, cls.square.nx)));
    } else if (cls.mode === 'scale' && form.id === 'square' && cls.square && cls.square.kind === 'corner') {
      drag = {
        mode: 'square-corner',
        startSliceScale: state.sliceScale,
        startAspect:     state.squareAspect,
        startCursor:     { x, y },
        startCx:         g.cx,
        startCy:         g.cy,
        startVx:         cls.square.vx,
        startVy:         cls.square.vy,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'scale' && form.id === 'droste' && cls.handle === 'inner') {
      drag = {
        mode: 'droste-ratio',
        startR: cls.r,
        startZoom: state.drosteZoom,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'scale') {
      drag = {
        mode: 'scale',
        startR: cls.r,
        startScale: state.sliceScale,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'droste-arms') {
      drag = {
        mode: 'droste-arms',
        // a SEAM grab (arms=1) measures the half-wedge from the opposite
        // direction: the seam is the wedge CENTER, so flipping the reference
        // by π makes the grab start at halfWedge=π (arms 1, no jump) and fold
        // upward as the cursor pulls away around the ring
        sliceRotationRad: env.sourceOverlayCanvas._geom.sliceRotationRad + (cls.seamGrab ? Math.PI : 0),
        boundarySign: cls.boundarySign,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'droste-offset') {
      if (env.isLocked?.('drosteOffset')?.locked) return;   // locked → the pole can't be dragged (M3)
      drag = { mode: 'droste-offset' };
      setCursor('grabbing');
    } else if (cls.mode === 'rotate') {
      // Snapshot the rotation center AND the panel rect at drag start, then orbit
      // that fixed point in that frozen frame. The wedge center can't move during
      // a rotate (only sliceRotation changes), so if the source panel reflows
      // mid-drag — e.g. iPhone Safari hiding its address bar, which doesn't happen
      // on desktop/iPad — reading the live geom/rect each move corrupts the
      // accumulated angle delta and the wedge spins far faster than the finger.
      // prevAngle is seeded with the same atan2 the move uses (not cls.theta,
      // which a form's custom classifyPointer may compute in another convention),
      // so there's no first-move jump on any form.
      drag = {
        mode: 'rotate',
        rect: wrap.getBoundingClientRect(),
        cx0: g.cx,
        cy0: g.cy,
        prevAngle: Math.atan2(y - g.cy, x - g.cx),
      };
      setCursor(rotateCursorForAngle(cls.theta));
    }
    env.overlayDragMode = drag?.mode ?? null;
    e.preventDefault();
  }

  function onUp() {
    if (!drag) return;
    drag = null;
    env.overlayDragging = false;
    releaseGesture('overlay');       // released BEFORE the fold below, or it gates itself out
    env.overlayDragMode = null;
    setCursor('default');
    // THE FOLD LANDS HERE (B636), after the flag clears so it is no longer suppressed. This is the
    // one call that makes deferring safe: a stroke may end anywhere, so if the gesture left the
    // slice off the image it is re-expressed now, before the next input reads the state.
    normalizeSliceMirror(env);
    env.updateUndoUI?.();
    env.scheduleRender?.();
    env.scheduleOverlayDraw?.();
  }

  // Trackpad pinch-to-scale the SLICE. macOS browsers deliver a trackpad pinch as a
  // `wheel` event with ctrlKey (no real multi-touch on a Mac — see memory), so this
  // is the one pinch gesture that works on desktop incl. our Electron build. Scales
  // sliceScale (same clamp as the two-finger pinch); one undo entry per burst.
  let wheelTimer = 0;
  function onWheel(e) {
    if (!e.ctrlKey) return;
    if (env.editLocked && env.editLocked()) return;   // read-only while playback/scrub drives state
    e.preventDefault();
    if (!wheelTimer) env.pushHistory?.();
    const factor = Math.exp(-e.deltaY * 0.01);
    env.state.sliceScale = Math.max(0.05, Math.min(10, env.state.sliceScale * factor));
    env.syncControls?.();
    env.scheduleRender?.();
    env.scheduleOverlayDraw?.();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelTimer = 0; env.updateUndoUI?.(); }, 250);
  }

  // Claim multi-touch on the source surface so the browser doesn't swallow a
  // two-finger pinch as a page zoom (it was reaching the browser, not our pinch
  // handler — most visibly on desktop touchscreens like the Movink). Mobile already
  // wants this; it's harmless where there's no touch (a mouse is single-pointer).
  wrap.style.touchAction = 'none';
  wrap.addEventListener('mousedown', onDown);
  wrap.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  wrap.addEventListener('touchstart', onDown, { passive: false });
  wrap.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);
  // iOS ends two-finger gestures with touchcancel when a system gesture cuts
  // in — without this the pinch drag STICKS (dimmed affordances, stale writes)
  window.addEventListener('touchcancel', onUp);
  wrap.addEventListener('wheel', onWheel, { passive: false });

  _attachedHandlers = { wrap, onDown, onMove, onUp, onWheel };
}

// mount the source view (image div + overlay canvas) into a slot element.
// returns the new overlay canvas; caller assigns to env.sourceOverlayCanvas.
export function mountSourceView(env, slotEl) {
  slotEl.innerHTML = '';

  const sourceImage = env.engine.getSourceImage();
  env.sourceVideoCanvas = null;   // reset; set below only for a loaded source video
  if (env.liveVideo) {
    // Live camera: mount the actual <video> element (it can't be painted via
    // background-image like a still). object-fit: contain matches the still
    // path's letterboxing so the wedge overlay geometry still aligns. Set layout
    // props individually so the camera's mirror transform survives. (The engine
    // may be sampling a mirrored canvas, not this element — but the mirrored
    // preview + texture share an orientation, so the overlay still lines up.)
    const v = env.liveVideo;
    v.style.position = 'absolute';
    v.style.top = '0'; v.style.left = '0';
    v.style.width = '100%'; v.style.height = '100%';
    v.style.objectFit = env.fit === 'cover' ? 'cover' : 'contain';
    v.style.pointerEvents = 'none';
    v.style.opacity = '';
    slotEl.appendChild(v);
  } else if (env.sourceVideo) {
    // Loaded source video: a <video> used as a WebGL texture source renders BLACK
    // when displayed directly on Blink/Gecko (works on WebKit). So keep the
    // <video> in the DOM but occluded (opacity 0) — it must stay live to decode +
    // serve the texture — and paint a 2D-canvas COPY on top that the render loop
    // refreshes each frame. A canvas composites reliably on every engine, and it
    // also avoids the native-video color/rotation display quirks.
    const sv = env.sourceVideo;
    sv.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; object-fit:contain; pointer-events:none; opacity:0;';
    slotEl.appendChild(sv);
    const c = document.createElement('canvas');
    const s = Math.min(1, 640 / Math.max(sv.videoWidth || 1, sv.videoHeight || 1));   // small thumbnail res
    c.width = Math.max(16, Math.round((sv.videoWidth || 16) * s));
    c.height = Math.max(16, Math.round((sv.videoHeight || 16) * s));
    c.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; object-fit:${env.fit === 'cover' ? 'cover' : 'contain'}; pointer-events:none;`;
    slotEl.appendChild(c);
    env.sourceVideoCanvas = c;
    env.sourceVideoCtx = c.getContext('2d');
  } else if (sourceImage && !sourceImage.src) {
    // CANVAS still source (the native camera's captured photo after its
    // stabilization center-crop / selfie mirror — freezeFromUrl hands the engine
    // a canvas, which has no .src): background-image: url(undefined) painted
    // BLACK under the wedge (Daniel's iPhone capture bug — the engine still had
    // the real texture, so the output kept working). Paint a downscaled 2D copy
    // instead (the source-video thumbnail pattern; never the full 48MP as a
    // data URL).
    const c = document.createElement('canvas');
    const s = Math.min(1, 1280 / Math.max(sourceImage.width || 1, sourceImage.height || 1));
    c.width = Math.max(16, Math.round((sourceImage.width || 16) * s));
    c.height = Math.max(16, Math.round((sourceImage.height || 16) * s));
    c.getContext('2d').drawImage(sourceImage, 0, 0, c.width, c.height);
    c.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; object-fit:${env.fit === 'cover' ? 'cover' : 'contain'}; pointer-events:none;`;
    slotEl.appendChild(c);
  } else {
    // div with background-image (vs <img>) avoids load-event race conditions on
    // remount (cache state varies across browsers).
    const imgDiv = document.createElement('div');
    imgDiv.className = 'src-img';
    imgDiv.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      background-image: url("${sourceImage.src}");
      background-size: ${env.fit === 'cover' ? 'cover' : 'contain'};
      background-repeat: no-repeat;
      background-position: center;
      pointer-events: none;
    `;
    slotEl.appendChild(imgDiv);
  }

  // overlay canvas — drawn ON TOP of the image div. explicit transparent
  // background to defeat the .main-slot canvas { background: #1a1a1a } rule
  // that would otherwise cover the imgDiv when swapped.
  const overlay = document.createElement('canvas');
  overlay.className = 'overlay-canvas';
  overlay.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; background: transparent !important; border: none !important;`;
  slotEl.appendChild(overlay);
  env.sourceOverlayCanvas = overlay;

  setupSourceInteraction(env, slotEl);
  // schedule a draw — by next frame, layout is settled
  // forced: a remount rebuilt the canvas, so there is nothing on it regardless of what the
  // signature would say about the state
  requestAnimationFrame(() => drawSourceOverlay(env, { force: true }));
  return overlay;
}
