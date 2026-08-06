// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/external-surface.js
//
// The transport-neutral poster core for a SECONDARY DISPLAY SURFACE — an output
// window, an iOS external display, AirPlay. Owns the per-frame loop that streams
// the committed program STATE to a self-rendering view (zero readback — the view
// runs its own engine and re-renders from state), the source-on-change repost, and
// the hello/fps handshake. It knows NOTHING about how messages travel (a same-origin
// BroadcastChannel to a popup, a native bridge into an external WKWebView) or what a
// frame's state is: the caller injects a `transport` and `content`.
//
// This is the conduit generalization of Fold's output-window + external-display
// posters — their shared spine. Render-from-state is the recommended, only-shipped
// pattern; the message vocabulary (state/source upstream, hello/fps downstream) is
// the pipe's, not conduit's business. A consumer that can't render-from-state can
// publish frames over the same transport instead — no fallback lives here.
//
// transport: {
//   post(msg) -> void | Promise      // ship one message to the view
//   isClosed?() -> bool              // the surface went away on its own (a closed popup)
// }                                  // open/close of the surface is the caller's (it
//                                    // controls WHEN begin() runs — e.g. after a native
//                                    // start() resolves)
// content: {
//   getState()                       // the committed program look (params)
//   getOutputDims({ cap })           // the render dims to post; `cap` = the degradation
//                                    //   ceiling (Infinity when no ladder)
//   getVideoSync?()                  // { t, paused, rate } for a loaded-video source, or null
//   getTest?()                       // publish the reference test pattern instead
//   sourceSignature()                // a stable id for the current source (repost on change)
//   buildSourcePayload({ sourceCap })// the (potentially heavy) source descriptor
// }
// renderCaps / sourceCaps: optional degradation ladders (default [Infinity] = none).
//   A transport steps them via degrade() on view-process death, resetGen() on a fresh
//   surface (the iOS external view's memory-pressure response).

// The longest the poster will stay silent when nothing has changed. Short enough that a view
// which missed a message recovers imperceptibly; long enough that a static program costs ~4
// posts a second instead of 60.
const HEARTBEAT_MS = 250;

// `elide` is an optional predicate letting the consumer switch the skip off at runtime (Fold
// exposes it as an A/B in the frame-cost panel). Default on; a consumer that passes nothing
// gets the elision, since an identical message is identical everywhere.
export function createSurfacePoster({ transport, content, renderCaps = [Infinity], sourceCaps = [Infinity], onClosed = null, elide = null }) {
  let active = false;
  let lastStateJson = '', lastPostT = 0;   // idle elision (see loop)
  let raf = 0;
  let lastSourceSig = '';
  let lastOut = null;
  let sourcePending = false;
  let fps = 0;
  let gen = 0;

  const capAt = (arr) => arr[Math.min(gen, arr.length - 1)];
  const outputDims = () => content.getOutputDims({ cap: capAt(renderCaps) });

  async function postSource() {
    if (sourcePending) return;
    sourcePending = true;
    try {
      const payload = await content.buildSourcePayload({ sourceCap: capAt(sourceCaps) });
      await transport.post({ type: 'source', payload, output: outputDims() });
    } catch (e) {
      console.warn('[conduit] surface source post failed:', e);
    } finally {
      sourcePending = false;
    }
  }

  function loop() {
    if (!active) return;
    if (transport.isClosed?.()) { end(); onClosed?.(); return; }
    const sig = content.sourceSignature();
    if (sig !== lastSourceSig) { lastSourceSig = sig; postSource(); }
    lastOut = outputDims();
    const msg = {
      type: 'state',
      state: content.getState(),
      output: lastOut,
      video: content.getVideoSync?.() || null,
      test: !!content.getTest?.(),
    };
    // IDLE ELISION with a HEARTBEAT FLOOR (B513). The view uses message ARRIVAL as its render
    // clock — an unfocused window's rAF is throttled, so a loop-driven view renders jerkily or
    // freezes — which is why this posted unconditionally. But posting an IDENTICAL message 60
    // times a second makes the view re-render an identical frame 60 times a second, and on the
    // external display that is an 8.3-megapixel redraw of a picture that did not change.
    //
    // So: skip only what is provably identical, and NEVER go quiet for longer than the
    // heartbeat. That bounds the worst case of a missed or dropped message to a fraction of a
    // second of staleness instead of a frozen output, which is the failure mode that matters
    // here. A live source's state changes constantly anyway, so this only ever engages on a
    // genuinely static program.
    const now = performance.now();
    const json = elide && elide() === false ? '' : JSON.stringify(msg);
    if (!json || json !== lastStateJson || now - lastPostT >= HEARTBEAT_MS) {
      lastStateJson = json; lastPostT = now;
      Promise.resolve(transport.post(msg))
        .catch(() => { /* transport gone; the next tick's isClosed/stop handles it */ });
    }
    raf = requestAnimationFrame(loop);
  }

  // arm before the surface opens (so a stop() during an async open cancels the
  // pending begin); begin the loop once the surface is ready; end tears down.
  // a fresh surface has seen nothing, so the elision cache must not carry over from the last one
  function arm() { active = true; lastSourceSig = ''; fps = 0; lastStateJson = ''; lastPostT = 0; }
  function begin() { if (active && !raf) loop(); }
  function end() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    fps = 0;
  }

  return {
    arm, begin, end,
    get active() { return active; },
    get fps() { return fps; },
    get renderDims() { return lastOut; },
    // view handshake — the transport routes its upstream messages here
    // the view (re)loaded → repost the source next tick, AND forget the elision cache: a fresh
    // view has never received the state we would otherwise consider already delivered
    noteHello() { lastSourceSig = ''; lastStateJson = ''; },
    noteFps(n) { fps = n || 0; },
    // degradation ladder (a no-op when the caller passed none)
    degrade() { gen = Math.min(gen + 1, renderCaps.length - 1); lastSourceSig = ''; },
    resetGen() { gen = 0; },
    get gen() { return gen; },
  };
}
