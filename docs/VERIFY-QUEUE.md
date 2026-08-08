# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION — "does the finish tell you what it's doing?"

**Sync first:** `npm run build && npx cap sync ios`, rebuild from Xcode. **iPhone, ~8 minutes.**

## What we're trying to find out

Streaming to disk is **proven and now on by default** — thank you, that gate is closed. Your `finalizeMarks` also settled a months-old question: a 3:28 4K take needs **33 seconds** of encoder flush, and the old deadline was 30. It was killing takes three seconds short of finishing.

This session is short and mostly about whether things you *should* have seen are now visible.

The progress indicator you asked about wasn't a 4K-only thing — **it was broken for every take**. The session got thrown away one line before the finalize it belonged to even started, so the progress had nothing to read. Same bug meant the streamed part-file was never cleaned up. Fixed, but I need your eyes to confirm it.

## Steps

1. **4K source selected, NOT recording yet.** Look at the PiP monitor. → is there a caption over the live picture saying the monitor pauses during 4K capture? (This is the forenotice you expected and I hadn't built.)
2. **Start the take.** → does the PiP go to its starved state as before, with the rec dot still visible?
3. **Record ~3 minutes at 4K, then stop. Watch the toast.** → does it now name a phase and show a **moving percentage**? Expect `encoding remaining frames… N%` for most of the wait — that's where ~97% of the finish goes.
4. **Let it save, then `copy report`** → paste. Two things I want: `finalizeMarks` again, and — importantly — **the audio verdict should no longer accuse the muxer.** Last time it claimed a healthy 153MB take had no audio track; it should now say it couldn't verify a file that size rather than crying wolf.
5. **Record a short FHD take and let it save.** → the audio verdict should read a plain `ok` with real track detail (that file is small enough to inspect).

## What counts as success

Step 3 showing a moving percentage, and step 4's verdict not raising a false alarm.

## What I can't see and need from you

- **Whether the progress is actually legible during a long finish.** It's the moment the app is least responsive and most worrying.
- **Whether the pre-capture warning reads right** — wording, placement, and whether it's reassuring rather than alarming. That's a judgement call, not a pass/fail.

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the biggest open cluster. B549 fixed the 10fps regression and B552 added the instrument that can finally see it (`N fps drawn · only M NEW frames/s`). Outstanding: the stale-broadcast-at-startup mystery on iPad (that instrument now exists to catch it — worth one focused session), the 25–45s source-switch lag, iPhone HDMI in record mode, and the 10-minute thermal run that still gates the governor's thermal rules.

**Frame-header regression pass (B546)** — FH-1 confirmed. FH-2 confirmed with a new finding filed (portrait vertical squish over HDMI). Remaining: `take still` + upload after a camera session, iPad video-to-display clock check.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles the next optimization target.

**Behaviour confirmations** — render elision against a still image; PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
