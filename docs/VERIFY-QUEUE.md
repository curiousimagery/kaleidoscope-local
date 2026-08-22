# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶ NO OPEN SESSION

**The B658-B704 session is closed → `archive/VERIFY-QUEUE-b658-b704.md`.** It asked *"where is the
ceiling, and is it a number we can compute?"* and answered it: **T10 met the arc's exit criterion**
on 2026-08-21 (6:39 4K clip, 50 minutes, 4K over HDMI, no context loss), and the cost model came out
**additive in frame time**, which is what makes a computed gate possible at all.

**Open a new session here when the next multi-test device run is scoped.** The two candidates named
in `PLAN-LIVE-READINESS.md` are the ones to draw from:

1. **Gate recording on detected capability** — needs the re-verify run below, since the old
   recording evidence predates B681/B699/B700/B703.
2. **Provoke GL context loss deliberately, then cycle diagnostics.** The listening side only became
   ready at B695. **A loss that heals cleanly is a PASS**, not a failure.

**Two device verifications are outstanding and are small enough not to need a session of their own:**
**B703** (source freeze after a GL restore — use the original motion → perform repro) and **B704**
(reset canvas should now EASE the pan; set a slow transition speed in perform mode).

---

# ▶ CARRIED FORWARD — one item, and it does not need a device

## T6 — WHAT DOES AN INTERACTION ACTUALLY COST (mostly NOT a device test)

Promoted straight to second place by T2's answer. **The first cut is Class 1 and runs on desktop**: with the ledger open, compare idle against a sustained canvas drag and read which surfaces and passes move. Candidates already in view — the overlay redraw, `foldSliceIntoSource` re-running on every render inside a drag (which is also the radial-pan suspect), history/state writes per pointermove.

**Only the confirmation belongs on device.** Do not spend a session on the enumeration.

---

---

# 🅿️ CLOSED SESSIONS

| session | file |
|---|---|
| B658-B704 — "where is the ceiling, and is it a number we can compute?" | `archive/VERIFY-QUEUE-b658-b704.md` |
| B599-B609 | `archive/VERIFY-QUEUE-b599-b609.md` |
| B573-B597 | `archive/VERIFY-QUEUE-b573-b597.md` |
| B382-B476 | `archive/VERIFY-QUEUE-b382-b476.md` |

Answers live where they get read, not here: **B609's three** in `PLAN-LIVE-READINESS.md` §1, **the
loop hold** in `BROADCAST-DELIVERY.md` §6a, **the ceiling session** in `PLAN-LIVE-READINESS.md`
"Where we are".

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the stale-broadcast-at-startup mystery on iPad, the 25–45s source-switch lag, iPhone HDMI in record mode, portrait vertical squish. B549/B551/B552 built the instruments; B559 gives the view a voice. **iPad 4K HDMI itself now reads healthy (B559)**, so what remains is the startup and switching behaviour rather than throughput.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles H2 and names the next optimization target.

**Frame-header pass (B546)** — FH-1, FH-2 and the still-after-camera check all confirmed (B559). Remaining: the iPad video-to-display clock check.

**Behaviour confirmations** — PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
