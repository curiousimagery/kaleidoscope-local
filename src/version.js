// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// version.js
//
// VERSION uses semver-ish (major.minor.patch with optional alpha/beta suffix)
// and describes WHAT changed. BUILD is a global MONOTONIC counter — it never
// resets on version bumps. that way we have a continuous record of how many
// iterations the project has gone through, even across major version jumps.
//
// counting back: ~17 builds on v0.0.x (changelog entries v0.0.3 through v0.0.17),
// then build 18 = v0.1.0a (engine extraction refactor), build 19 = v0.1.0a Build 2
// (small fixes after first round of testing). build 20 = v0.1.1 (this build:
// docs folder, license, deployment-readiness for github + vercel).
//
// CONVENTION: every time you ship a build, increment BUILD by 1. bump VERSION
// when there's a meaningful change in surface area or behavior. don't reset
// BUILD when bumping VERSION.

export const VERSION = 'v0.1.1';
export const BUILD = 20;

export function formatVersion() {
  return `${VERSION} · Build ${BUILD}`;
}
