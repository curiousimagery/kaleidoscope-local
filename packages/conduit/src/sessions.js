// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// sessions.js — a live count of the hardware sessions the app is holding.
//
// ⚠️ WHY THIS EXISTS (session audit, 2026-08-19). Every hardware session in this app is
// individually justified and NOTHING ANYWHERE COUNTS THEM. The audit could establish what the code
// *can* hold (5-6 decoders of one clip, up to 3 GL contexts, never released) by reading; it could
// not establish what a real session *did* hold at the instant it fell over. That gap is the reason
// three separate device investigations ended in "probably resource exhaustion" without a number.
//
// iOS caps concurrent decode and encode sessions and the WebKit GPU process dies when it runs out.
// A count is therefore the difference between a capability gate with a REASON attached and a
// hardcoded device table — which is the standing requirement (BACKLOG: "the gate must be COMPUTED,
// not a device table").
//
// ⚠️ MODULE-GLOBAL ON PURPOSE. This is a fact about the one shared process, and there are at least
// three env-shaped objects in this codebase that would each see a different answer if it lived on
// one of them (CLAUDE.md: the two-chromes rule, and source-overlay's private `view`). Every caller
// gets the same registry regardless of which env it is holding.
//
// ⚠️ AN UNDER-COUNT MUST NOT READ AS "WE ARE FINE". `covers` lists the acquisition sites that
// actually register, so an absent kind is visible as "not instrumented" rather than as zero.

const held = new Map();          // token -> { kind, label, at }
let seq = 0;
let acquired = 0;
let released = 0;
const peak = { total: 0 };
const peakByKind = {};

// The sites that call acquire(). Published with the count so a gap in the wiring is legible.
const COVERS = [
  'source-host: the loaded source <video>',
  'source-host: the loop-detect probe',
  'source-host: the native decode (iOS AVPlayer)',
  'stage-source: the staging seek decoder',
  'clip-editor: preview / A-head / thumbnail decoders',
  'engines: every WebGL2 context (preview, bus, PiP)',
  'recorder: the video + audio encoders',
];

function bump() {
  const total = held.size;
  if (total > peak.total) peak.total = total;
  const by = counts();
  for (const k of Object.keys(by)) {
    if (!(k in peakByKind) || by[k] > peakByKind[k]) peakByKind[k] = by[k];
  }
}

function counts() {
  const by = {};
  for (const s of held.values()) by[s.kind] = (by[s.kind] || 0) + 1;
  return by;
}

// Claim a session. `kind` is the resource class the OS actually limits ('decode' | 'encode' |
// 'gl' | 'camera'); `label` is what a human needs to identify WHICH one in a report.
// Returns a token to release with. Never throws: an instrument that can break its caller is worse
// than no instrument.
export function acquireSession(kind, label = '') {
  try {
    const token = ++seq;
    held.set(token, { kind, label, at: Date.now() });
    acquired++;
    bump();
    return token;
  } catch { return 0; }
}

// Give one back. Idempotent and safe with a stale or absent token, because the call sites are
// teardown paths and a teardown that can throw is how you get a half-released resource.
export function releaseSession(token) {
  try {
    if (token && held.delete(token)) released++;
  } catch { /* ignore */ }
}

// Swap in place: release the old token and claim a new one, in that order. This is the shape the
// audit's fixes want — release BEFORE acquire — and naming it makes the ordering hard to get
// backwards at a call site.
export function replaceSession(token, kind, label = '') {
  releaseSession(token);
  return acquireSession(kind, label);
}

// Read by the perf panel's export. `leaked` is the conserved quantity: acquires minus releases
// must equal what is held, and anything held with no owner left is the orphan class the audit
// found. `live` names them, because "3 decoders" and "3 decoders, two of which are clips you
// closed ten minutes ago" are different findings.
export function sessionReport() {
  const now = Date.now();
  return {
    now: { total: held.size, ...counts() },
    peak: { total: peak.total, ...peakByKind },
    acquired,
    released,
    live: [...held.values()]
      .sort((a, b) => a.at - b.at)
      .map((s) => ({ kind: s.kind, label: s.label, ageSec: Math.round((now - s.at) / 1000) })),
    covers: COVERS,
  };
}

// Test seam only. Not called by app code.
export function resetSessions() {
  held.clear(); seq = 0; acquired = 0; released = 0;
  peak.total = 0;
  for (const k of Object.keys(peakByKind)) delete peakByKind[k];
}
