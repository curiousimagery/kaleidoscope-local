// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// check-planar-handback.mjs
//
// ONE QUESTION: does every `setSource` on an engine that can be on the native planar path either
// hand the planes back, or say out loud why it has none?
//
// `setSource` retires the planar provider by design — a genuinely new source must not keep feeding
// on the old decode's planes. So on iOS, every `setSource` is also a decision about the fast path,
// and the ones that mean "re-upload the SAME source" have to re-install it. Miss that and the
// engine falls onto the decode's 1280 RGB preview canvas through a cross-context readback: a sixth
// of the resolution at several times the cost, with the picture still moving and every counter
// still healthy. It is invisible on any machine without a native decode, which is every machine we
// write this code on.
//
// FIVE BUILDS HAVE NOW FIXED A DIFFERENT ROUTE TO THAT ONE STATE — B580 (context restore), B703
// (planar gated on element state), B706 (a failed re-upload never retried), B708 (the uploader
// never rebuilt without a new frame), B760 (the render's export reader restored the <video> and
// stopped there). Four of the five were found by a device session. This is the part a file can
// answer, and it should never cost a device session again.
//
// ⚠️ WHAT IT CANNOT DO. It is syntactic. It proves the author DECLARED an intent within a few lines
// of the call; it cannot prove the declaration is true. A site that hands back the wrong provider
// passes. The runtime half of B760 — the planar trail and the reconciler in source-host.js — is
// what covers that, and neither replaces the other.
//
// Deliberately dumb: no parser, no dependency, same shape as check-dupe-keys.mjs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every file that drives an engine which can be handed native-decode planes: the preview engine,
// the bus engine, the PiP engine, and the external view's own.
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ['src'];
const WINDOW = 6;                       // lines after the setSource in which the hand-back must appear
const ALLOW = /planar-handback-ok/;     // escape hatch: on the call line or in the comment above it
const ALLOW_LOOKBACK = 8;               // room for the reason to be a real explanation, not a token

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const CALL = /\.setSource\(/;

const findings = [];
for (const file of ROOTS.flatMap((r) => walk(r))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!CALL.test(line)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // a comment describing the pattern is not the pattern
    if (ALLOW.test(lines.slice(Math.max(0, i - ALLOW_LOOKBACK), i + 1).join('\n'))) return;
    if (/setPlanarSource\(/.test(lines.slice(i, i + 1 + WINDOW).join('\n'))) return;
    findings.push({ file, line: i + 1, text: line.trim() });
  });
}

if (findings.length) {
  console.error('planar hand-back check FAILED — a setSource that neither restores the planes nor says why:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    ${f.text}`);
    console.error(`    → if this re-points the engine at a live native decode, follow it within ${WINDOW} lines with`);
    console.error("      engine.setPlanarSource(nv.planeProvider, nv.cap, '<why>').");
    console.error("    → if it genuinely has no planes (a still, a <video> with no decode attached, a stage");
    console.error("      canvas), write 'planar-handback-ok' in a comment above it WITH the reason.\n");
  }
  process.exit(1);
}

console.log(`planar hand-back check passed (${ROOTS.join(', ')})`);
