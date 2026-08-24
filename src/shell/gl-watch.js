// gl-watch.js — ONE place that watches a canvas's WebGL context across loss and restore.
//
// ⚠️ B705 — THIS EXISTS BECAUSE THE ABSENCE OF A MARK WAS READ AS EVIDENCE OF A FAILURE.
//
// Two device reports on 2026-08-21 (`docs/temp/8-21-contextLoss-01.json`, `821-contextLoss-02.json`)
// showed `live-pip` restoring its context every time and `preview` restoring never, across two
// independent runs. That reading was WRONG, and wrong by construction: `main.js` marked
// `gl-context-lost` for the preview and **never marked `gl-context-restored` at all**. The mobile
// chrome had the same hole. `live-pip`, `output` and `external` all marked both edges, so the
// asymmetry in the report was an asymmetry in the INSTRUMENT, not in the app.
//
// That is the standing rule failing in the most expensive direction — *an absence is not evidence* —
// and it is also the two-chrome divergence in textbook form: the two surfaces missing the mark were
// `preview` (desktop/iPad) and `mobile-preview` (phone), one per chrome, while every surface owned
// by a shared module was correct. A sixth surface added tomorrow would have been free to forget
// again. So the wiring moves here, and a caller supplies only what is genuinely its own.
//
// ⚠️ AND MARKING THE EVENT IS NOT THE SAME AS KNOWING THE CONTEXT IS USABLE (the wrong-noun test:
// *this counts restore events, which equals "the surface recovered" only if the handler firing
// implies a usable context*). It does not — `reinitGL()` can throw, and it can return while the
// context is still lost. So this reports FOUR distinct outcomes, and the report can tell them apart:
//
//   gl-context-restored    the event fired and the context came back usable
//   gl-restore-failed      the caller's rebuild threw          → carries `why`
//   gl-restore-incomplete  rebuild returned, context STILL lost
//   gl-restore-timeout     no restore event within RESTORE_TIMEOUT_MS of the loss
//
// The timeout is what separates "the event never fired" from "the process died before it could".
// **A loss with none of the four means the app died inside the window**, which is itself an answer —
// so read the interval between the loss and the last trail entry before concluding anything.
//
// Marks land via `vitals.mark`, so they reach `priorTrail` and SURVIVE THE KILL. That is the only
// channel that works here: both reports were read after a reload, so anything held on the engine
// (`lastReinitWhy`) was already gone, and console output does not reach Daniel at all.

const RESTORE_TIMEOUT_MS = 3000;   // generous: the longest observed restore was live-pip at 982ms

// ⚠️ B723 — THE PROVOCATION REGISTRY. WHY IT LIVES HERE AND NOT ON `env`.
//
// Which GL surfaces exist, and how to kill one, is a fact about the ONE shared rendering surface —
// not about a chrome. There are three env-shaped objects in this app (`main.js`, `mobile/chrome.js`,
// and `source-overlay.js`'s private `view`), and B638 was a flag written to one and read from
// another. A module-level map is visible to every caller regardless of which env they hold, which is
// the pattern CLAUDE.md prescribes for exactly this shape.
//
// It also puts registration where it cannot be forgotten: **every watched surface registers by
// construction.** B705's whole lesson was that a sixth surface added tomorrow would have been free
// to skip the wiring, and `yuv-renderer` proved it by having no handler at all for months.
const surfaces = new Map();   // surface name → { canvas, glOf, mark, ext, extWhy, armed }

// The extension MUST be cached while the context is ALIVE. On a lost context `getExtension` returns
// null in WebKit, which is precisely how the Build-230 restore silently never fired. The cached
// object stays valid across loss/restore cycles because extensions belong to the context object,
// and that object survives a loss.
function cacheLoseExt(glOf) {
  let gl = null;
  try { gl = glOf?.(); } catch { /* a throwing accessor is a missing context */ }
  if (!gl) return { ext: null, why: 'no GL context at registration' };
  try {
    const ext = gl.getExtension('WEBGL_lose_context');
    return ext ? { ext, why: '' } : { ext: null, why: 'WEBGL_lose_context not exposed by this runtime' };
  } catch (e) { return { ext: null, why: String(e?.message || e) }; }
}

// What can be provoked, and — for anything that cannot — WHY NOT. An absence is not evidence, and a
// control that silently does nothing is worse than one that is missing: it reads as a PASS.
export function listGLSurfaces() {
  return [...surfaces.entries()].map(([surface, e]) => ({
    surface,
    canProvoke: !!e.ext,
    why: e.ext ? '' : e.extWhy,
    armed: !!e.armed,
  }));
}

// Kill `surface`'s context on purpose, now or after `delayMs`.
//
// **The delay is the point.** The losses worth testing are the ones that land DURING work — mid-bake,
// mid-broadcast, mid-scrub — and the operator cannot hold a panel button and scrub a 4K crossfade at
// the same time. Arm it, go do the thing, let it fire.
//
// Every provocation is marked, so the trail can tell a TEST from an organic failure. Without that
// the reports become unreadable the moment we start provoking on purpose, and the whole exercise
// poisons the evidence it is meant to produce.
export function provokeGLLoss(surface, { delayMs = 0 } = {}) {
  const e = surfaces.get(surface);
  if (!e) return { ok: false, why: `no watched surface named "${surface}"` };
  if (!e.ext) return { ok: false, why: e.extWhy || 'this runtime cannot force a context loss' };
  if (e.armed) return { ok: false, why: 'already armed' };
  const fire = () => {
    e.armed = null;
    try { e.mark?.('gl-loss-provoked', { surface, delayMs }); } catch { /* an instrument must never throw */ }
    try { e.ext.loseContext(); } catch (err) {
      try { e.mark?.('gl-provoke-failed', { surface, why: String(err?.message || err) }); } catch { /* noop */ }
    }
  };
  if (delayMs > 0) { e.armed = setTimeout(fire, delayMs); return { ok: true, armed: true }; }
  fire();
  return { ok: true, armed: false };
}

// Disarm a pending provocation (leaving the loop builder, ending a session, changing your mind).
export function disarmGLLoss(surface) {
  const e = surfaces.get(surface);
  if (!e || !e.armed) return false;
  clearTimeout(e.armed); e.armed = null;
  return true;
}

// Watch `canvas` and keep `surface` honest in the exported report.
//
// ⚠️ EVERYTHING THIS NEEDS IS AN ARGUMENT. It must not close over one chrome's variables — that is
// the B627 rule, and this module is imported by both chromes plus two shared modules.
//
//   canvas   the GL canvas to watch
//   surface  the name used in the report ('preview' | 'mobile-preview' | 'live-pip' | 'output')
//   mark     (kind, detail) → void. Pass the vitals mark; a missing one degrades to console only
//   rebuild  () → void. Rebuild GPU resources on the SAME context (normally `engine.reinitGL`)
//   glOf     () → WebGLRenderingContext | null. Read late — the engine may swap contexts
//   onLost   optional, runs after the loss is marked (status text, pausing a loop)
//   onRestored optional, runs ONLY after a verified-usable restore (repaint, re-upload, resume)
//   onFailed  optional, (why) → void. Runs on `failed` or `incomplete`, for honest status text
//
// Returns a `stop()` that removes the listeners and cancels any pending timeout.
export function watchGLContext({ canvas, surface, mark, rebuild, glOf, onLost, onRestored, onFailed }) {
  if (!canvas || !surface) return () => {};

  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const say = (kind, detail) => {
    try { mark?.(kind, { surface, ...detail }); } catch { /* an instrument must never throw */ }
  };

  const onContextLost = (ev) => {
    // Without preventDefault the GPU drops the context FOR GOOD and no restore can ever arrive.
    // This is load-bearing, not hygiene — the Build-230 black-output bug was exactly this.
    ev.preventDefault();
    say('gl-context-lost');
    console.warn(`[fold] WebGL context LOST (${surface})`);
    clear();
    // If nothing arrives, say so. Silence and death look identical in a post-reload report.
    timer = setTimeout(() => {
      timer = null;
      say('gl-restore-timeout', { ms: RESTORE_TIMEOUT_MS });
      console.warn(`[fold] WebGL context NOT restored within ${RESTORE_TIMEOUT_MS}ms (${surface})`);
    }, RESTORE_TIMEOUT_MS);
    try { onLost?.(); } catch (e) { console.warn(`[fold] onLost failed (${surface})`, e); }
  };

  const onContextRestored = () => {
    clear();
    console.warn(`[fold] WebGL context RESTORED (${surface})`);
    let why = '';
    try {
      rebuild?.();
    } catch (e) {
      why = String(e?.message || e);
      say('gl-restore-failed', { why });
      console.warn(`[fold] GL reinit failed (${surface})`, e);
      try { onFailed?.(why); } catch { /* noop */ }
      return;
    }
    // ⚠️ THE REBUILD RETURNING IS NOT THE SAME AS THE CONTEXT WORKING. Ask the context itself —
    // this is the conserved quantity, and the reason the event count alone was never enough.
    let lost = false;
    try { lost = !!glOf?.()?.isContextLost(); } catch { /* treat an unreadable context as usable */ }
    if (lost) {
      say('gl-restore-incomplete');
      console.warn(`[fold] GL restored but context still lost (${surface})`);
      try { onFailed?.('context still lost after rebuild'); } catch { /* noop */ }
      return;
    }
    say('gl-context-restored');
    try { onRestored?.(); } catch (e) { console.warn(`[fold] onRestored failed (${surface})`, e); }
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // B723 — register for deliberate provocation. Caching the extension HERE is the whole reason this
  // works: at watch time the context is alive by construction, which is the one moment
  // `getExtension` is guaranteed to answer.
  const { ext, why } = cacheLoseExt(glOf);
  surfaces.set(surface, { canvas, glOf, mark, ext, extWhy: why, armed: null });

  return () => {
    clear();
    disarmGLLoss(surface);
    surfaces.delete(surface);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
  };
}
