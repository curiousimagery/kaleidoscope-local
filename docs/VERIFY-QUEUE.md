# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION — "did the desktop/iPad take path survive the rewrite?"

**Device: your Mac (Electron DMG) and the iPad.** Not the iPhone. **Sync first:** `npm run build`, then `npx cap sync ios` + Xcode rebuild for the iPad half.

## What we're trying to find out

The phone got eight builds of attention and the desktop got none. But **B553-B558 changed shared code**, and one change in particular went further than it was tested: [main.js:1720](src/main.js#L1720) builds the recorder sink without passing `streamToDisk`, and [recorder.js:982](packages/conduit/src/recorder.js#L982) defaults it to `true`. **So desktop and iPad takes have been streaming to OPFS since B553, verified only on iPhone** — and unlike the phone, the desktop has no A/B switch for it.

That path lost a take on the phone at B553. It should not stay unread.

Also unread on these devices: the poster elision change (shared conduit, so the desktop external window inherits it), the `failOutput` change (Syphon and NDI teardown), and stills-after-camera on iPad, which is the exact shape of the B541 dark-source bug.

**Nothing new in B559 is on by default except the pressure readout and the external-view log**, so anything that goes wrong here belongs to the older work, not to this build. That is deliberate.

## Steps — Electron (Mac), ~10 min

1. **Record a short take (~30s) with audio, and save it.** Play it back. → does it open, is there sound, is it in sync? This is the OPFS path's first desktop reading.
2. **Record a LONG take (3+ min) at 4K.** → does it finish, and does the save complete?
3. **Start a Syphon broadcast, then start a record while it runs.** → does the broadcast survive? (This is D3's fix on a surface it was never re-tested on.)
4. **Open the external output window** with a video source playing. → does it track the source, or does it stall/go stale?
5. **Now flip `source: skip repeat video uploads` ON** in the frame-cost panel, same video source. → read `fps` and the `source` row's `upload` calls. Expect roughly HALF the upload calls and equal-or-better fps. **Watch for a stale image on a PAUSED clip or right after a seek** — that would mean `currentTime` is not the right identity signal.

## Steps — iPad, ~8 min

6. **Live camera → take a still → confirm the still uploads** (source panel shows it, output renders it). This is the B541 hazard; the planar release is unverified here.
7. **Record a take and save it.** Same question as step 1, on the OPFS path.
8. **Plug in HDMI, broadcast, and watch the `external` row.** → `N fps drawn` and any `⚠ only M NEW frames/s`.
9. **`copy report`** → paste. New in this build: an `extLogs` array if the external view said anything, and `pressure` now carries `target` and `shortfall`.

## What counts as success

Steps 1-4 and 6-8 are pass/fail on **behaviour you can see** — no diagnostics needed unless something breaks, in which case the report is the thing to send. Step 5 is a measurement and wants the numbers.

## What I can't see and need from you

- **Whether a desktop or iPad take opens and plays.** I cannot run either build.
- **Step 5's two upload-call counts**, on and off. That's the whole answer for whether the gate ships on.
- **`extLogs`, if HDMI is involved.** First build where the external view can report anything at all — I'd like to know whether it's silent or has been shouting into a void.

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**The sustained-capture run** — the arc's remaining goal and the biggest gap. Everything measured so far is seconds-to-minutes of peak; the only long run was 10 minutes at IDLE. Wants its own session with the phone plugged in and left alone. **B542's `renderElide` has also never been read on device**, and it is the single biggest lever for exactly this case.

**HDMI / external display** — the stale-broadcast-at-startup mystery on iPad, the 25–45s source-switch lag, iPhone HDMI in record mode, portrait vertical squish. B549/B551/B552 built the instruments; B559 gives the view a voice. Worth one focused session now that all three exist.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles H2 and names the next optimization target.

**Frame-header pass (B546)** — FH-1 and FH-2 confirmed. Remaining: `take still` + upload after a camera session (folded into step 6 above), iPad video-to-display clock check.

**Behaviour confirmations** — PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
