# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶ NO OPEN SESSION

**The arc's plan now lives in `PLAN-LIVE-READINESS.md`.** Read it before opening a new session here; it says which item is next and what "done" means for it.

**The next session is item 2's long-form run**, and it has two prerequisites that are not verification: the thermal signal, and the session audit. **Do not open a device session until those land** or the reading will not be interpretable.

# 🅿️ CLOSED SESSIONS → `archive/VERIFY-QUEUE-b599-b609.md`

B599-B609 archived at B658. Their answers live where they get read: **B609's three** in `PLAN-LIVE-READINESS.md` §1 (with the GL-context confound for the next bake test), and **the loop hold** in `BROADCAST-DELIVERY.md` §6a. Earlier sets are in `archive/VERIFY-QUEUE-b382-b476.md` and `archive/VERIFY-QUEUE-b573-b597.md`.


# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the stale-broadcast-at-startup mystery on iPad, the 25–45s source-switch lag, iPhone HDMI in record mode, portrait vertical squish. B549/B551/B552 built the instruments; B559 gives the view a voice. **iPad 4K HDMI itself now reads healthy (B559)**, so what remains is the startup and switching behaviour rather than throughput.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles H2 and names the next optimization target.

**Frame-header pass (B546)** — FH-1, FH-2 and the still-after-camera check all confirmed (B559). Remaining: the iPad video-to-display clock check.

**Behaviour confirmations** — PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
