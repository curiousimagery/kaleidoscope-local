# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION — "does a streamed take actually reach Photos?"

**Sync first:** `npm run build && npx cap sync ios`, rebuild from Xcode. **iPhone, ~5 minutes.**

## What we're trying to find out

Last round the take finalized perfectly — valid file, 2 tracks, audio playable, 72MB — and then **`save failed`**, with a retry that failed the same way. That was my bug, and a stupid one: on the phone, the recorder's `save` callback only *stashes* the take; the real write to Photos happens when you tap it in the sheet. I was deleting the streamed file the moment the callback returned, so by the time you saved, the file was gone. Retry failed because there was nothing left to retry.

The delete is gone. **This session is one question: does a streamed take now survive all the way to Photos?**

## Steps

1. **Record ~30s at FHD, talking.** Stop, let it finalize, then **save it from the sheet.** → does the save succeed?
2. **Open it in Photos.** → plays, with sound?
3. **Record another ~30s take but DON'T save it. Then record a third take and save that one.** → does the third save fine? (This checks the orphan sweep isn't eating a file it shouldn't.)
4. **Now a 4K take, 3+ minutes.** Stop, watch the toast, save it. → does the percentage stay visible long enough to be useful this time? And does the save succeed?
5. **`copy report`** after step 4 → paste.

## What counts as success

Step 1 saving. Everything else is confirmation.

## What I can't see and need from you

- **Whether saves actually complete now.** I have broken this twice by guessing when the file's life ends; I'd rather you tell me than assume again.
- **Whether the finalize percentage is legible on a long take** — step 4 is the only one slow enough to judge it. Last time it flashed past because finalize took 669ms, which is correct behaviour, not a bug.

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the biggest open cluster. B549 fixed the 10fps regression and B552 added the instrument that can finally see it (`N fps drawn · only M NEW frames/s`). Outstanding: the stale-broadcast-at-startup mystery on iPad (that instrument now exists to catch it — worth one focused session), the 25–45s source-switch lag, iPhone HDMI in record mode, and the 10-minute thermal run that still gates the governor's thermal rules.

**Frame-header regression pass (B546)** — FH-1 confirmed. FH-2 confirmed with a new finding filed (portrait vertical squish over HDMI). Remaining: `take still` + upload after a camera session, iPad video-to-display clock check.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles the next optimization target.

**Behaviour confirmations** — render elision against a still image; PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
