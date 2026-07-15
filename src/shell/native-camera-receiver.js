// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/native-camera-receiver.js
//
// RECEIVE-ONLY consumer of the native camera's frame socket — how the live
// native camera reaches the EXTERNAL DISPLAY view (output-view.js). The main
// webview's shell/native-camera.js owns the AVCaptureSession and all controls;
// this module just joins ws://127.0.0.1:<port> as a second client (the frame
// server broadcasts to all connections), decodes the biplanar-YUV wire format,
// and paints an RGB canvas the engine samples like any drawable. No
// @capacitor/core, no plugin calls — plain WebSocket + WebGL2, so it runs in
// the plain external WKWebView.
//
// Wire format: see FrameSocketServer.swift ("FYUV" header + Y plane + CbCr).
// The mirror flag (front/selfie camera) arrives with the source payload — the
// sender bakes it into its own canvas the same way (uMirror).

import { createYuvRenderer } from './yuv-renderer.js';

export function createNativeCameraReceiver({ port = 8899, mirror = false } = {}) {
  const canvas = document.createElement('canvas');
  const renderer = createYuvRenderer(canvas);
  let ws = null;
  let latest = null;      // most recent YUV ArrayBuffer (painted on the render tick)
  let stopped = false;

  // Paint the latest received frame into the RGB canvas. Called each render
  // tick (refreshFrame) so the YUV->RGB blit is synced to the render loop —
  // one blit per rendered frame, not one per socket message.
  function paintLatest() {
    if (!latest) return;
    const dv = new DataView(latest);
    if (dv.getUint32(0, false) !== 0x46595556) return;   // "FYUV"
    const width = dv.getUint32(4, true);
    const height = dv.getUint32(8, true);
    const yStride = dv.getUint32(12, true);
    const cStride = dv.getUint32(16, true);
    const cHeight = dv.getUint32(20, true);
    const ySize = yStride * height;
    const cSize = cStride * cHeight;
    const yPlane = new Uint8Array(latest, 24, ySize);
    const cPlane = new Uint8Array(latest, 24 + ySize, cSize);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
    }
    renderer.draw(width, height, yStride, cStride, yPlane, cPlane, mirror);
  }

  // resolves on the FIRST frame (proves the socket + a live stream), with the
  // same retry posture as the camera module (the server may bind a beat late)
  function start() {
    return new Promise((resolve, reject) => {
      let done = false;
      let attempt = 0;
      const connect = () => {
        if (stopped) return;
        try { ws = new WebSocket(`ws://127.0.0.1:${port}`); }
        catch (e) { if (!done) { done = true; reject(e); } return; }
        ws.binaryType = 'arraybuffer';
        ws.onmessage = (ev) => {
          latest = ev.data;
          if (!done) { done = true; paintLatest(); resolve(); }
        };
        ws.onclose = () => {
          if (!done && !stopped && attempt < 6) { attempt++; ws = null; setTimeout(connect, 300); }
        };
      };
      connect();
      setTimeout(() => {
        if (!done) { done = true; reject(new Error('no native camera frames on the external view (ws blocked or no stream)')); }
      }, 6000);
    });
  }

  function stop() {
    stopped = true;
    try { ws?.close(); } catch { /* already closed */ }
    ws = null;
    latest = null;
  }

  return {
    start,
    stop,
    refreshFrame: paintLatest,
    frameSource: () => canvas,
  };
}
