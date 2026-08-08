# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION — "does the take survive being long?"

**Sync first:** `npm run build && npx cap sync ios`, rebuild from Xcode. **iPhone, ~15 minutes.**

## What we're trying to find out

B553 changed how every take is written. Instead of building the whole file in memory and copying it, the muxer now streams it straight to disk. **The question is whether that fixed the long-take failures you've been hitting for months** — and, just as importantly, whether it broke anything about how takes play back.

The one real risk is playback, not speed. Streaming forces the file's index (`moov`) to the END rather than the front. Everything I know says AVFoundation handles that fine for a local file, **but that is a claim I can't verify without your device**, and it's the kind of thing that would show up as "the take saves, then won't open."

So: **short take first to prove nothing broke, then push it long.**

## Steps

Do these in one run, in order. Stop and tell me if any step fails — later steps assume the earlier ones passed.

1. **Short FHD take, ~15 seconds.** Stop it, let it save. → **Open it in Photos and play it.** Does it open, play, scrub, and have sound?
2. **Same take, check the report** (`copy report`). → paste it. I'm looking for `diskStreamed: true` and the `finalizeMs` / `finalizeMarks` line.
3. **Now a long one: FHD, 3+ minutes.** Talk during it so there's audio to check. Stop, watch what the toast says while it finishes. → does it save, and does it open in Photos?
4. **Report again** after that one. → paste it. `finalizeMarks` on a long take is the number we've never had.
5. **Now the real target: 4K source, 3+ minutes.** (Take resolution will still be 1080 — see the note below; that's expected, not the bug.) → does it save?
6. **If any take fails**, note what the toast said — it should now name the phase it stalled in rather than just giving up.
7. **A/B it if something looks off:** panel → turn `record: stream to disk` **OFF** → repeat the failing case. That tells us instantly whether B553 caused it or fixed nothing.

**While you're in there, two quick ones from the last build (10 seconds each):**

8. **Landscape toast.** Record a short take *in landscape*, stop, and stay in landscape. → is the status toast visible now? It was rendering off-screen before, which is why finalize looked silent.
9. **Canvas settings.** Open canvas settings over a live source. → does the popover float above the source panel instead of under it?

## What counts as success

- Takes open and play in Photos — that's the moov-at-end question answered.
- A 3-minute take saves where it used to fail.
- `diskStreamed: true` in the report.
- The toast is legible in landscape.

## What I can't see and need from you

- **Whether the files actually open.** I have no way to test AVFoundation's tolerance for moov-at-end.
- **`finalizeMarks` on a long take.** This is the first real data on where finalize spends its time; it's what would let me fix a genuine stall rather than guess.
- **Whether the failures are gone or just moved.**

---

## 📌 Note on the 4K labelling — not a test, a decision waiting on you

The phone's "4K" control sets the **source** resolution; the take itself is capped at 1080/2048 and always has been (B295/B373). B553 removes the memory reason that cap couldn't move, so it's now a genuine choice:

- **Implement 4K takes on the phone** — real work, and the encoder cost is unmeasured.
- **Or relabel honestly** — call the control what it is (source resolution) and state the take resolution separately.

Per your framing: the dishonest middle, a 4K setting that silently saves 1080p, is the one option ruled out. Cheap either way; I'd want your call before doing either.

---

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the biggest open cluster. B549 fixed the 10fps regression and B552 added the instrument that can finally see it (`N fps drawn · only M NEW frames/s`). Outstanding: the stale-broadcast-at-startup mystery on iPad (that instrument now exists to catch it — worth one focused session), the 25–45s source-switch lag, iPhone HDMI in record mode, and the 10-minute thermal run that still gates the governor's thermal rules.

**Frame-header regression pass (B546)** — FH-1 confirmed. FH-2 confirmed with a new finding filed (portrait vertical squish over HDMI). Remaining: `take still` + upload after a camera session, iPad video-to-display clock check.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles the next optimization target.

**Behaviour confirmations** — render elision against a still image; PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
