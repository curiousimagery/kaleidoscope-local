// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit — barrel entry. Consumers normally import the subpath modules
// directly (e.g. `conduit/output-bus`) so each app's bundle stays lean by
// construction; this barrel exists for quick spikes and REPL/harness use.

export { createCommitCell } from './src/commit-cell.js';
export { hasPerformTier } from './src/engine-adapter.js';
export { webHost } from './src/host.js';
export { mockSyphonHost } from './src/mock-host.js';
export { createNdiSink } from './src/ndi-sink.js';
export { createOutputBus } from './src/output-bus.js';
export { createRecorderSink } from './src/recorder.js';
export { createSyphonSink } from './src/syphon-sink.js';
export { createTestFrame } from './src/test-pattern.js';
