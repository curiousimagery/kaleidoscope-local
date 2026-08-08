# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION — "where does the audio drift come from?"

**Sync first:** `npm run build && npx cap sync ios`, rebuild from Xcode. **iPhone, ~10 minutes.**

## What we're trying to find out

Saving is solid now — steps 1-3 last round all passed, thank you. Two things remain from your 6-minute take: **the audio drifted out of sync by the end**, and there was **occasional static**.

I'm not going to guess at either. There are two clocks in a take and they only agree under assumptions: audio advances by exact sample count, video is stamped on the wall clock minus capture latency. If audio loses samples, or if that latency moves as the phone heats, they separate. The report now carries all three clocks side by side so the numbers can say which one slipped.

I also owe you a correction: I told you last build that the finalize wait was the video encoder. **It's the audio flush** — 32.7 of 33.1 seconds on your 4K take. That's why "flushing audio 5%" sat still: I'd weighted the bar on the wrong assumption. Both flushes now report from their own queues.

## Steps

1. **Long take, 5+ minutes, FHD, talking steadily throughout.** Count out loud periodically so there are sharp consonants to sync against. Save it.
2. **`copy report`** → paste. The four numbers I need are `wallSec`, `videoSpanSec`, `audioSpanSec`, `captureLatencyMs`.
3. **Play it back in Photos and tell me *when* the drift becomes noticeable** — near the start, halfway, only at the end? Whether it grows steadily or jumps matters more than the exact amount.
4. **Note roughly when any static occurs** and what you were doing at the time (heavy gesture, zoom, EV/WB change, or nothing in particular).
5. **While it finalizes, watch the toast.** → does `flushing audio` now show a percentage that actually moves?

## What counts as success

There's no pass/fail here — it's a measurement session. Success is the four numbers plus your description of when the drift appears.

## What I can't see and need from you

- **The four clock numbers.** Everything downstream depends on which of them disagree.
- **Whether the drift is progressive or sudden.** Progressive points at lost samples or moving latency; sudden points at a stall. These lead to completely different fixes, and I'd rather not build the wrong one.

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the biggest open cluster. B549 fixed the 10fps regression and B552 added the instrument that can finally see it (`N fps drawn · only M NEW frames/s`). Outstanding: the stale-broadcast-at-startup mystery on iPad (that instrument now exists to catch it — worth one focused session), the 25–45s source-switch lag, iPhone HDMI in record mode, and the 10-minute thermal run that still gates the governor's thermal rules.

**Frame-header regression pass (B546)** — FH-1 confirmed. FH-2 confirmed with a new finding filed (portrait vertical squish over HDMI). Remaining: `take still` + upload after a camera session, iPad video-to-display clock check.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles the next optimization target.

**Behaviour confirmations** — render elision against a still image; PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
