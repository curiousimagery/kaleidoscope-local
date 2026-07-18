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

export function createSurfacePoster({ transport, content, renderCaps = [Infinity], sourceCaps = [Infinity], onClosed = null }) {
  let active = false;
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
    // the popup uses message ARRIVAL as its render clock (unfocused rAF is throttled),
    // so state is posted unconditionally each tick; a static-look skip is a possible
    // follow-up but must keep posting for live sources or the view drops to its fallback
    Promise.resolve(transport.post({
      type: 'state',
      state: content.getState(),
      output: lastOut,
      video: content.getVideoSync?.() || null,
      test: !!content.getTest?.(),
    })).catch(() => { /* transport gone; the next tick's isClosed/stop handles it */ });
    raf = requestAnimationFrame(loop);
  }

  // arm before the surface opens (so a stop() during an async open cancels the
  // pending begin); begin the loop once the surface is ready; end tears down.
  function arm() { active = true; lastSourceSig = ''; fps = 0; }
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
    noteHello() { lastSourceSig = ''; },   // the view (re)loaded → repost the source next tick
    noteFps(n) { fps = n || 0; },
    // degradation ladder (a no-op when the caller passed none)
    degrade() { gen = Math.min(gen + 1, renderCaps.length - 1); lastSourceSig = ''; },
    resetGen() { gen = 0; },
    get gen() { return gen; },
  };
}
