# carry-over inventory — DECIDED (Daniel, B612)

**✅ RESOLVED. Daniel's decisions are recorded below; the rule is now "carry it iff the word means the same thing in the destination form."** Shipped at B613: `canvasOffset` resets on form switch and pan-unlock always starts centred.

| param | DECISION |
|---|---|
| `sliceCx` / `sliceCy` | **CARRY** — with an origin caveat, below |
| `sliceScale` | **CARRY** — improves further with the normalisation work |
| `sliceRotation` | **CARRY** |
| `canvasZoom` / `canvasRotation` | **CARRY** |
| `canvasOffsetX/Y` | **DROP** — never, *"even across tiling forms that theoretically could map to each other"* |
| `oobMode` | **CARRY** — *"more like a setup property, like canvas aspect ratio"* |
| `panLock` | **CARRY** (already per-form) — and **unlock must never inherit a position** |
| `segments` | **DROP** — see the correction below |
| `drosteZoomPhase` | **special** — see below |
| form-private (`droste*`, `squareAspect`) | **CARRY (inert)** |

## Three findings that came out of deciding

**1. The slice origin is inconsistent, and the fix is to move the OTHER forms.** Daniel: the rectangle's origin is at its centre, so at the same `sliceCx` it samples a different part of the image than the wedge forms do. **His proposal is to offset the other forms' origin slightly left**, on the reasoning that *"a slice starting on the left edge of the canvas with an edge on the right side covers roughly the same centre area as a square with a centre origin."* Pairs directly with the `sizeNorm` tuning pass — same session, same reference source.

**2. `segments` must not be shared, and hex should not have the control at all.** Correcting the draft: **droste's arm count is not radial's wedge count** and they should never track each other. Separately, **hex's segment count is fixed by its geometry**, so exposing a segments input there is offering a control that cannot mean anything — an exit-criterion-1 violation (*every offered option functional in the context offered*). Filed in BACKLOG.

**3. `drosteZoomPhase` is not an absolute position, but it must still answer the same inputs.** Daniel: *"agree that it doesn't map to an absolute position, but it should respond to the same zoom inputs from gesture and MIDI that other forms do."* That is exactly the B611 MIDI finding — the semantic zoom target resolves the KEY correctly and not the MODE, so an absolute fader sweeps one wrapping loop and reads as dead. **The resolve has to carry the control mode.**

He also connected it himself: *"when the center is offset the zoom in scale becomes more meaningful — this is probably how we got that hyperzoomed state."* **Correct.** With the log-polar centre pushed off the visible field, every visible pixel sits at large radius, compressed into a narrow log range, which reads as extreme zoom.

## Reset vs restore: RESET for now

Daniel's call: keep reset for simplicity while the basics settle. **Restore is filed in BACKLOG as a refinement** with the rationale — mid-set you are more often returning to a form you were just using than starting it fresh, so per-form memory is closer to how a preset behaves. Revisit once the fundamentals are solid.

---

<details><summary>Original draft brief (B611), kept for the reasoning</summary>

**Your task (Daniel, B611).** Fill in the DECISION column. Everything else is pre-filled so you are editing a draft rather than starting from a blank page.

**The question for each row is not "is this useful?" but "does this word mean the SAME THING in the destination form?"** That reframing is what resolves the tension between your two positions — at B609 you wanted basics to persist through a live form switch, at B611 you wondered whether nothing should. Both are right about different rows.

**Three possible answers:**
- **CARRY** — same meaning everywhere; keeping it makes a live form switch feel continuous rather than like a cut.
- **DROP** — means something different (or nothing) in the destination; carrying it produces a nonsense state.
- **CONVERT** — same intent, different units. Needs a translation rule, which is real work; only choose this if CARRY and DROP are both wrong.

**A useful test when you are unsure:** imagine switching forms mid-set with the value at an extreme. If the result is "interesting", CARRY. If the result is "what happened", DROP.

---

## The slice family — how the SOURCE is sampled

These describe the crop taken from the source image. **A slice is a slice in every form**, which is the strongest case for carrying anything.

| param | what it is | my read | DECISION |
|---|---|---|---|
| `sliceCx` / `sliceCy` | which part of the source is sampled | **CARRY** — identical meaning everywhere; this is the "which part of the image" you named | |
| `sliceScale` | how big a bite is taken | **CARRY** — `sizeNorm` already normalises the per-form perceptual difference (that is what it is for) | |
| `sliceRotation` | the wedge's angle | **CARRY** — degrees are degrees | |

## Framing — how the composition is presented

| param | what it is | my read | DECISION |
|---|---|---|---|
| `canvasZoom` | composition zoom | **CARRY** — `canvasNorm` normalises the per-form difference. ⚠️ but see the droste row below | |
| `canvasRotation` | whole-composition rotation | **CARRY** — degrees are degrees | |
| `canvasOffsetX/Y` | **three different things** | **DROP** — a lattice pan in square/hex/triangle, a centre shift in radial, a log-polar centre in droste. Your words: *"geometric nonsense."* This is the one that produced the B611 blow-up | |
| `oobMode` | clamp / mirror / transparent | **CARRY** — a source-sampling rule, form-independent | |
| `panLock` | per-form, already | **N/A** — already keyed by form id, so it cannot leak | |

## Form structure

| param | what it is | my read | DECISION |
|---|---|---|---|
| `segments` | radial/hex wedge count | **?** — you flagged this as arguable. Meaningful in radial; droste has `drosteArms` for the same idea under another name | |
| `squareAspect` | square only | **CARRY (inert)** — ignored by every other form, so it costs nothing and is there when you return | |
| `droste*` (`Zoom`, `Spiral`, `Mirror`, `Arms`, `WedgeMirror`, `OffsetX/Y`) | droste only | **CARRY (inert)** — same reasoning | |
| `drosteZoomPhase` | droste infinite-zoom position | **?** — cyclic and unbounded, unlike every other param here. See the open question below | |

---

## Two things to decide that are not rows

**1. Does `segments` map onto `drosteArms`?** They are the same concept (how many mirrored wedges) under two names, with different legal values. If they should track each other, that is a CONVERT and it is the only one on this page. If not, say so and they stay independent forever.

**2. Should a form switch RESET or RESTORE?** Two coherent models, and it changes what "DROP" means:
- **Reset:** a dropped param returns to its default on every switch. Predictable; you always know what you are getting.
- **Restore:** each form remembers its own last value. Switching back returns you to where you left that form, which is closer to how a preset behaves and probably better live.

**My read is restore**, because mid-set you are more likely to be returning to a form you were just using than starting it fresh. But it is more state to hold and it is genuinely your call.

---

## What this unblocks

The decisions here feed **stage A and stage C** of the input plan in `PLAN-LIVE-READINESS.md`, and they close the `canvasOffset` item in BACKLOG. The B611 clamp is a band-aid holding until this exists.

</details>
