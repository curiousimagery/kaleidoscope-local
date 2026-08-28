# plan — live readiness

**The arc that runs from B609 forward. Restructured at B760** because the document had become a stack
of surgical insertions: three successive "what closes phase 2" blocks, a stale item table, and a
closed item's full working notes, all still present and disagreeing with each other. Daniel:
*"increasingly fragmented across various states, and updates have been inserted surgically without
addressing document-wide inconsistencies."*

**The B609-B752 item structure is archived at `archive/PLAN-items-b609-b752.md`** — the numbered items
1 through 7, the item 1.5 detail and its roll-ups, and the three superseded close-out blocks. Nothing
was deleted. Go there for the reasoning behind a closed decision.

**What this file owns:** the phases, what closes each one, the dependencies that are real, and the
exit back to feature work. **What it does not own:** current state (`HANDOFF.md`), open work detail
(`BACKLOG.md`), what to test next (`VERIFY-QUEUE.md`), how the frame pipeline works
(`BROADCAST-DELIVERY.md`), how to investigate (`DEBUGGING-PROTOCOL.md`). Where this file disagrees
with a later CHANGELOG entry, the CHANGELOG wins.

**Naming:** "live readiness" in both senses. The app has to perform, and it has to be trustworthy in a
live show.

---

## The goal

**Daniel, 2026-07-31:** *"On modern performant hardware we can handle working with 4K clips up to 10
mins and 4K output, and then degrade capabilities gracefully based on constraints of older or less
powerful hardware."*

So 4K at 10 minutes is **the ceiling to design toward, not the floor to require**, and the degradation
ladder is a first-class part of the design rather than a failure mode.

**The definition of done is the five exit criteria in `CAPABILITIES.md` §0** (Daniel, B560). Not
restated here; read them before picking up any item.

**How to break a tie (Daniel, B609).** He performs weekly and uses those shows as forcing pressure on
the app. **The app is the primary output; the performance is the deadline that focuses it.** The
tiebreaker is **development velocity and code quality, not learning for its own sake.** What to refuse
is not "a fix that helps tonight" — shows genuinely should go well — it is **a fix that has to be
redone later.** When a short-term patch and the right change cost about the same, take the right
change. When they do not, say so plainly and let Daniel weigh it; there is always a **Plan B** (an
older known-good build) that makes a deadline cheap to protect.

---

## ▶▶▶ THE PHASE MAP

**One screen. Everything below is detail on one of these rows.**

| phase | scope | status | closes when |
|---|---|---|---|
| **2** | **4K end-to-end on M1 iPad: reliable, or gated** | **IN PROGRESS.** The capability is proven; the reliability floor is not | users cannot reach common failure states, and degraded states warn correctly |
| **2.5** | **Colour input transform** | **URGENT. May interrupt phase 2** | the three colour paths agree and the B747 regression is gone |
| **3** | **iPhone: current limits, honest labels** | Not started. **The largest evidence gap** | every option the phone offers is functional or honestly labelled |
| **4** | **NDI** | Not started. One bug diagnosed and waiting | the readback is fixed, one wired + one WiFi reading exist, the label matches |
| **5** | **Cruft cleanup + the warnings spec** | **Split. The docs half is time-sensitive and starts NOW** | dead instruments gone, the governor has a decided scope, the warnings spec exists as a document |
| **→** | **FEATURE WORK** | the exit | — |

**⚠️ THE ORDERING IS NOT THE NUMBERING.** Three things cut across it:

1. **2.5 can pre-empt 2.** It is a shipped regression on the app's primary output and it is a couple
   of builds. Baseline usability outranks completeness.
2. **Phase 5's documentation half runs EARLY, in parallel with phase 2.** The gating and communication
   spec is scattered across compaction summaries and **decays with every further compaction.** Its
   code half runs LAST — see the dependency table.
3. **Phase 4 (NDI) is the last consumer of the instruments phase 5 deletes**, which is why 5's code
   half cannot precede it. Daniel spotted this: *"this is step 3 in our plan but I think NDI depends
   on it?"* He is right, and the split above is the resolution.

---

## PHASE 2 — 4K end to end, reliable or gated

### ⚠️⚠️⚠️ The exit criterion, rewritten by Daniel 2026-08-27

**The old framing was "find the capability ceiling". We exceeded it, and that turned out to be the
wrong target.** In his words:

> *"What I keep pushing toward is that we need to PREVENT USERS FROM RUNNING INTO FAILURE STATES.
> Specifically: **we can document the upper limits of our end-to-end 4K workflows on an M1 8GB iPad,
> and users can't access common failure states, and degraded states warn appropriately.**"*
>
> *"'One tiny thing left' is wrong, because in our testing common actions still regularly result in
> failures. That doesn't meet a definition of done for basic quality even if we technically sometimes
> can achieve really impressive 4K feats.* **We're bound by the lower limits of reliability, not the
> upper limits of ad hoc success.**"

**▶ READ THAT LAST SENTENCE BEFORE CLAIMING ANYTHING IS CLOSED.** Every "it worked" in this arc is an
upper-limit result from a fresh launch. The criterion is about the floor.

**And the third clause, added 2026-08-27:** *"part of exit also means pressure testing 'known
supported scenarios' in less than ideal circumstances. E.g. we've gotten broadcast and record to run
concurrently on iPad. Great — can we do 4K for both reliably with long clips? If so, do we need to
throttle fps in one or both places? Or do we know that even though it technically works, the
quality/fps and reliability means we should guard this anyway."*

**That is a fourth possible verdict on any capability, and the plan previously had only three.** Not
just *works / fails / warn* but **works and we guard it anyway.** A capability that survives a fresh
launch and degrades on the second run is not a capability we should offer at full tier.

### What is settled, and what measurement did to the original plan

**The arc was designed around a capability ladder: measure each device's limits, build a cost model,
gate combinations against it. Measurement retired most of the rungs by FIXING them.** That is a
legitimate result and it is why the plan needed rewriting rather than continuing.

| rung the plan intended to gate on | what measurement did to it |
|---|---|
| **Bake memory** | **Dissolved.** 3188MB → 131MB (B732-B737). `peakMB` is 72-132 on every device at every clip length; a 3.5× larger source cost 0.7MB more. **The gate expression has no varying term left** |
| **Clip duration** | **Not a limit. A FORECAST.** A number to TELL someone, not a reason to refuse them |
| **Render speed** | **Was OURS, and is fixed.** One `texImage2D` of a 2D canvas was 89% of a render (B746/B747). iPad 28 → 55.6 fps; Safari 22 → 131 fps |
| **Render quality** | **Was a defect, fixed B753.** Bitrate was hardcoded at 0.1 bpp. Now a four-tier user choice, device-confirmed *"dramatically improved"* |
| **Thermal** | **Not a limit yet.** `nominal` across 530s and 270s fanless, twice. Still the largest single effect ever measured (40.0 → 19.8 fps at `serious`), but nothing has REACHED `serious` in this arc |
| **Source file size** | **HYPOTHESIS DEAD.** The same 2.63GB file on the same iPad failed three times and succeeded twice. No size table can encode that |
| **Record capability** | **STILL OPEN, and it is where phase 2 now lives** |

**What phase 2 has actually resolved** (the per-hypothesis record is in `BACKLOG.md`):

| thread | outcome |
|---|---|
| Frame cadence / broadcast delivery | **Closed B594** → `BROADCAST-DELIVERY.md` |
| Input normalization across modalities | **Closed B657.** Detail archived |
| The 4K source-attach cluster | **Closed B683-B704** |
| GL-loss provocation and instrumentation | **Closed B723-B733.** All five surfaces report, four outcomes distinguishable |
| The bake's memory ceiling | **Solved B737, device-verified.** O(1) in clip length |
| The bake's 4K handoff | **Fixed B758.** An ordering bug: the swap ran while decoders held their GPU surface pools |
| Session / permit accounting | **Shipped B681, proven conserved** |
| Render bitrate | **Fixed B753-B759** |

### ▶ What is actually open — the phase 2 work list

**Ordered by what blocks what, not by tractability.**

| # | item | shape | evidence |
|---|---|---|---|
| **2A** | **Arming a take loses the GL context, and the take silently produces nothing** | **BUG. The largest one open** | `R2-take4.json`: FHD take armed → `gl-context-lost` on **output, yuv-source and preview** within 1s → `videoFrames: 0`, `wallSec: 0.5` on a 60-second take → **the app reported success**. Seen on three of four recent runs |
| **2B** | **The planar drop after a GL restore** | **BUG, narrowed B760** | `planarTrail` attributes it to `reinitGL`, not a stray `setSource`, and shows the provider IS reinstalled. So the open question is why the uploader does not rebuild — B708's question on a build that has B708's fix |
| **2C** | **Degraded states do not announce themselves** | **THE EXIT CRITERION'S CORE** | The planar drop is only visible in the frame-cost panel. A performer whose broadcast silently drops to 720p mid-set has no way to know |
| **2D** | **Common actions can reach unrecoverable states** | **THE EXIT CRITERION'S OTHER HALF** | A bake failure raises a blocking `alert()` (measured up to 1827s). A GL loss recovers the context in ~474ms but not the source, panels or dialogs |
| **2E** | **On-device storage allocation** | **UNMEASURED, and it is a real lift** | The one term gate 2 never measured. B753 tripled output sizes: a 10-minute 4K bake is now ~5.6GB. Nothing measures whether the share sheet, the Files write, or a reload survives that |
| **2F** | **Record fps against declared** | **MEASURED, needs a decision** | 4K take alone: **17.4 fps against a declared 30** (`R2-take4`, and the source was 720p at the time so this is optimistic). Is that a warn, a gate, or a guard-anyway? |
| **2G** | **Concurrency under sustained load** | **Daniel's third clause. Not run** | 4K broadcast + 4K record together, long clip, second run in a session. The matrix ran fresh-launch only |
| **2H** | **The gate 1 refusal path** | Mechanism built B743, moved to load B750 | Still needs to refuse, not just report |

### The three gates — established B749, still the right frame

| gate | asks | shape | status |
|---|---|---|---|
| **1. FILE ACCESS** | can we read these bytes at all? | **binary**, 16 bytes, at load | mechanism shipped. **It never learns a ceiling. Do not ask it to.** Needs the refusal path (2H) |
| **2. BAKE / RENDER** | will this job finish acceptably? | **not binary** — time, thermal, output storage | **became a FORECAST.** Needs SAYING, not gating. **Output storage is the one unmeasured term (2E)** |
| **3. RECORD** | can this device sustain the declared fps? | **not binary** — achieved vs declared, concurrency, thermal | **the real remaining work (2F, 2G)** |

**Both gates that refuse must be COMPUTED, never a device table** (`HARDWARE-SUPPORT.md`), and both
need one honest refusal path rather than two. **A published capability table is the right thing to
SAY; the live reading is the right thing to GATE on** — the same iPad Pro measured 1259MB and 1065MB
free on two runs.

### 🔑 "Own the bytes" — the hypothesis, stated honestly

**Daniel's summary:** *"if we own the bytes we expect that we'll be able to handle any length of 4K
footage on iPad, supported within the max capacity of our session storage on disk."*

**What it would fix:** the file-handle class. If the transient `NotFoundError` is iOS revoking a
security-scoped handle some interval after the pick, copying the bytes into our own storage removes
the whole failure mode — and the stage manager multiplies that exposure by nine held references over
forty minutes, so it gets more load-bearing, not less. It also makes 2E tractable, because you cannot
budget storage you do not own.

**⚠️ What it would NOT fix, and this needs saying plainly:** **the GL class.** Item 2A is a context
loss at take-arm with no file access involved at all. Owning the bytes changes nothing about it. The
same is true of 2B. **So "almost all of our known kill conditions" is too strong** — it is the right
fix for one of the two families, and the family it does not touch is the one currently producing zero-
frame takes.

**⚠️ AND DO NOT BUILD IT UNTIL 2E IS MEASURED.** If the failure is a revoked handle, owning the bytes
fixes it. If it is memory pressure at read time, it does not. That is one device session's worth of
difference against a week's worth of build.

### 🔍 The gating and communication spec — DO THIS EARLY, it is decaying

**Daniel, 2026-08-26:** we have accumulated a lot of specific design detail about **how** limits get
communicated, and it is scattered across dozens of compaction summaries rather than captured in any
doc. It is not lost, but **recovering it requires deliberate sleuthing through session history, and it
decays with every further compaction.**

Examples, to calibrate the search:

- disabling the record button outright during an iPad broadcast, versus warning about poor fps and
  **suggesting a lower broadcast resolution as the fallback lever**
- estimating render and bake times, and **showing the estimate alongside time elapsed**
- the persistent communication space under the app bar as the home for toast-like notifications, which
  is eventually meant to absorb **well over a hundred** existing toasts and inline notices

**The nearest thing to a spec that IS written down** is BACKLOG *"THE CAPABILITY LADDER: WHAT GETS
GATED, WARNED, OR FLAGGED"* (Daniel's four-row consequence rubric) plus `CAPABILITIES.md` §5. Treat
those as the skeleton and the archaeology as the flesh. **Add the fourth verdict** from the exit
criterion above: *works, and we guard it anyway.*

**▶ This is filed under phase 5 but it RUNS during phase 2.** The notification bar can wait; the
recovery of what it is supposed to say cannot. And 2C cannot be built well without it.

### ⚙️ The scenario runner — the velocity fix, and it is built

`src/shell/scenario-runner.js` has existed since B665 and gained `render`, `bake` and `renderTier`
verbs at B752. It is wired into the frame-cost panel, reachable on iPad, exports under `scenarioRun`,
and every step publishes why it declined. **Scripts are declarative data.**

**Use it. The rule for this phase: never spend a device session on a question a harness or a code read
can answer**, and never send Daniel a single test when a batch would fit in the same session.
`VERIFY-QUEUE.md` is the operator-facing document; keep it current and self-contained.

**What cannot be automated and must stay manual:** the force-quit and relaunch (Capacitor has no
reliable programmatic restart, and `location.reload()` does not clear the residue), the HDMI attach,
and the Files picker. **Everything after "go" can be.**

---

## PHASE 2.5 — colour input transform

**Urgent. Daniel: this may interrupt phase 2 if the effort is only a couple of builds. Without it the
app is not usable for real output, which makes it a baseline-usability item rather than a feature.**

**It is a shipped regression on top of a standing bug.** B747 removed a 2D-canvas intermediate from the
render path for a 73× upload win. **That canvas was silently doing HLG-to-SDR tone mapping and
BT.2020-to-sRGB gamut conversion**, so removing it exposed that we never owned a colour pipeline at
all. `renderUploadViaCanvas` is the flagged workaround and it costs the whole perf win.

**The bigger half, found by reading at B752 and not yet device-confirmed:** `src/engine/yuv.js`
converts YUV to RGB with **hardcoded BT.601 coefficients** (`1.402 / -0.344136 / -0.714136 / 1.772`),
no transfer function, no primaries. That is the **native decode path** — in-app playback and broadcast
on iPad. Nearly all HD and 4K video is BT.709, and neither native plugin reads
`kCVImageBufferYCbCrMatrixKey`, so nothing ever told the shader what the source was. The full-range
assumption is correct (both plugins request `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange`).

**So there are three disagreeing colour paths** — the 2D canvas (browser-managed), the direct
VideoFrame (raw), and the planar blit (BT.601) — which is the likely explanation for Daniel's
observation that perform-mode thumbnails looked better than the rest of the app.

**▶ THE DECISION, Daniel 2026-08-26: do not ship a throwaway fix.** Build the **input transform**
stage of real colour management — one conversion seam in the shader, driven by parsed source metadata
(`VideoFrame.colorSpace`, already recorded at B748, plus the `colr`/nclx box), defaulting to BT.709
when unknown — and route all three paths through it. **That fixes the regression, fixes the standing
BT.601 bug, and is not thrown away.**

**Honest limit:** in an 8-bit working space it corrects hue and saturation but will still band on HDR
sources. **A float working space is the NEXT stage, not this one**, and is what the photography and
round-trip audiences actually need. That half belongs with feature work.

**Closes when:** the three paths agree, a BT.709 source renders as BT.709, and `renderUploadViaCanvas`
can be retired.

---

## PHASE 3 — iPhone: current limits and honest labels

**Independent of everything above. It can slot wherever a phone is in hand.**

**Daniel, 2026-08-27:** *"iPhone currently lies about support for 4K. Technically it means it's
sampling from 4K but says/implies it's rendering 4K. Our capability testing on iPhone is very stale.
We need to know our current limits and not lie about our capabilities. If we can expand our
capabilities that's incredible, but we start with verified instrumentation and honest labels."*

**That ordering is the item: instrument, then label, then only maybe expand.**

**Known before starting:**

- The mobile chrome's take path has a **structural 2048 cap**, so "4K record" on the phone has never
  been true and every 4K recording number from the phone measured a 1080p take (`CAPABILITIES.md`,
  correction B551).
- **HDMI from the phone has never been measured on any build.**
- **The phone chrome is a separate code path** with its own `env` — see the two-chromes warning in
  `CLAUDE.md`. A fix verified on desktop is not verified here.
- The exit-criteria audit got **bigger** this arc: the source surface's off switch does nothing,
  `gpuMsPerFrame` always reads 0 because WebKit does not expose the timer extension, `pressure` cannot
  be trusted during a take, and `foldHdmiVideoUncap` is a confirmed no-op.

**🔋 Battery belongs here, and it is a product question rather than a perf one.** The arc has
investigated thermal only as a performance throttle. The other half is power draw:

- if someone leaves the app open and unattended for thirty minutes, does it drain their battery?
- can an iPhone customer use this out and about and have a delightful experience, **without becoming
  uncomfortable about opening it at all?**

**Guardrails like auto-idle after inactivity belong here and need evidence, not intuition.** This maps
directly onto exit criterion #5 (*"a phone app that gets hot and eats the battery in ten minutes is
not shippable"*), which named it and was then never measured.

**Closes when:** every option the phone offers is either functional or honestly labelled, and the
battery question has a measurement rather than an assumption.

---

## PHASE 4 — NDI

**One measurement, not an investigation.** B478 already concluded that WiFi NDI is packet-timing
jitter with sender-side levers exhausted, and that conclusion stands. **Do not re-litigate it.**

**What is genuinely open, and it is specific:** B569 found the async readback is not working on iPad,
costing **31.43ms of a 76ms frame** — the single largest item in that path. That is plausibly the
entire explanation for the choppiness reported across two arcs, and it is a different animal from the
WiFi jitter.

**Daniel, 2026-08-27:** *"This hasn't been tested since we built our instrumentation and scenario
runner. Last time we worked on this we were reporting healthy fps but the actual broadcast, especially
from iPad, didn't look like a healthy fps. Can we use our new diagnostics to better understand what's
actually going on?"*

**That is the right question and it names a specific instrument gap.** "Reported healthy fps while the
wall looked wrong" is the exact shape B584 was built to split: app-side delivery versus what actually
reaches the destination. **The conserved quantity for a bus destination is frames accepted by the
sink, not frames rendered.** Check that the NDI sink publishes one before spending a session.

**⚠️ The governor's fate is decided HERE, not before.** Its original premise — watch the display
signal — is false for HDMI, because the external view renders in its own process. **But on a bus
destination like NDI or Syphon the app's canvas genuinely is the output, so app fps gates it
directly.** So the decision is not retire-or-keep, it is **scope it to bus destinations**, and that
needs this phase's measurement to confirm. It is disabled rather than deleted for exactly this reason.

**Closes when:** the readback is fixed, one wired and one WiFi reading exist, the destination carries a
label matching what was measured, and the governor has a decided scope.

---

## PHASE 5 — cruft cleanup and the warnings spec

**⚠️ SPLIT IN TWO, and the halves run at opposite ends of the arc.**

### The documentation half — runs EARLY, during phase 2

Covered above under phase 2: the gating and communication spec archaeology. **It decays with every
compaction, and 2C depends on it.** Plus a thorough docs scrub: keep the learnings, archive the
narrative. `archive/` is the destination, never deletion.

**Also here, and not previously written down (Daniel, 2026-08-27):** record a spec for **all** the
warnings and notifications we have specced ad hoc across this arc. There are well over a hundred
toasts and inline notices with no single index.

### The code half — runs LAST, after phase 4

**Daniel, 2026-08-27:** *"Our frame cost diagnostic panel has a bunch of measurements we don't use any
more. We have the governor off by default. We might want to repurpose this for NDI work, but this is
the phase when we gut out everything that's unused and leave our remaining instrumentation in a lean,
maintainable, healthy state."*

**The reason it goes last is the dependency, not the priority: the flags being deleted ARE the
instruments.** The cache budget knob, `loopBySeek`, the surface toggles, the governor. Delete them
before the measurement work and A/B capability is gone mid-investigation. The consolidation item filed
HIGH at B591 lists five disproven levers still carrying live code.

### ▶ THE DELETION LIST (kept current — add to it as levers are added)

Everything here is a DIAGNOSTIC that earned its place and should not outlive the question it answers.
Listed at the moment of creation rather than rediscovered later, which is the only way this stays
honest.

| lever | added | delete when |
|---|---|---|
| `?color=off` (legacy BT.601 path) | B761 | the input transform is settled and nobody is A/B-ing it. **Carries `LEGACY_COLOR` with it** |
| `?tone=` + the frame-cost panel's tone sliders | B762-B765 | the committed defaults survive a full colour review. **Keep the sliders if stage two (float working space) is near** |
| `planarTrail` (engine) | B760 | the planar path has been quiet for an arc. Cheap enough to keep; it is 12 entries |
| `planarHeals` + the source-host reconciler | B760 | never — the reconciler is an invariant, not an instrument. **Its COUNTER can go** |
| `tools/check-planar-handback.mjs` | B760 | never; it is a review rule, not a measurement |
| `tools/color-parse-check.mjs` | B761 | never |
| Five disproven perf levers (cache budget knob, `loopBySeek`, surface toggles) | pre-B591 | filed HIGH at B591, still live |
| The governor | B581 | **decided by phase 4, not here.** Scope it to bus destinations or delete it |
| `foldHdmiVideoUncap` | — | confirmed no-op. Delete or make it work |
| `gpuMsPerFrame` in the panel | — | always 0 on WebKit. Either label it or drop it |

**⚠️ AND THE DOCS HALF HAS ITS OWN LIST:** the warnings/notification spec (above), a `docs/archive/`
sweep, and **the four-phase load sequence is explicitly NOT in this arc** (Daniel, B768) — it is
filed, and it is feature-shaped work for whenever the notification bar is built.

**Closes when:** disproven levers are gone from the code and the panel, the governor has a decided
scope rather than a default, the docs hold only living material, and the warnings spec exists as a
document.

---

## The dependencies that are real

Everything else can be bundled or reordered. **These cannot.**

| dependency | why | strength |
|---|---|---|
| **Spec archaeology BEFORE the notification UI** | The UI does not rot; the spec does. Every compaction costs some of it | **Hard, and time-sensitive** |
| **Cleanup's CODE half AFTER phases 2 and 4** | **The flags being deleted are the instruments** | **Hard** |
| **NDI readback fix BEFORE NDI measurement** | Measuring with a known-broken readback measures the readback | **Hard**, but it is one small fix |
| **The governor's scope decision AFTER NDI** | NDI is the one destination where its premise is true | **Hard** |
| **Storage measurement (2E) BEFORE building "own the bytes"** | A revoked handle and memory pressure need opposite fixes | **Hard.** One session versus a week |
| **2A and 2B BEFORE any record gate (2F)** | A gate calibrated against a broken path gates the wrong number | **Hard.** Today's 17.4 fps was measured on a 720p source |
| Governor pinned off during any long run | If it arms mid-run it changes the workload under measurement | **Soft.** A switch, not a decision |

---

## The pause point, and what follows

**The pause is after phase 5's code half.** Cleanup is the seam for the same reason it always was: it
is where docs and code get consolidated, so stopping there does not leave half-derived context for the
next arc to re-inherit.

**Phase 2 must not be skipped to get there.** Shipping feature work without ever having confirmed the
core promise leaves that promise unverified indefinitely, and every open risk in this arc is one that
only appears over time.

**⭐ But phases 3, 4 and 5's documentation are ALSO a legitimate pause point if the feature pressure
wins**, provided each open thread gets **one document stating what is measured, what is assumed, and
what a future session would need to measure.** That is capture, not investigation. It is the
difference between a pause and a drift, and it is what lets the arc hand over without losing state
that took forty builds to build up.

**The feature work that follows, in Daniel's priority order (2026-08-26):** stage manager and proper
colour management first, both named most impactful; then tileable still output, vector overlays, and
round-trip processing with image-editing DAMs (Lightroom, Capture One, PhotoLab). **Colour management
is a showstopper for commercial viability with photographers and designers**, and it is what unlocks
the tile maker and lossless still round-trips.

---

## Design input that outlives the arc: the stage manager

**Why it is in a phase-2 plan at all** (Daniel asked, 2026-08-27, and it is a fair question): **it
changes what a gate is a property of.** Build the gates without it and they get built twice. It is
also the reason "own the bytes" and GL context handoff are infrastructure decisions rather than local
fixes — both are `conduit` concerns that other apps will inherit.

**It is a DESIGN INPUT here, not a phase-2 deliverable.** The build belongs to feature work.

**Shape, as specified 2026-08-26:**

- **Up to nine sources on the stage**, including the live and the staged source.
- **Live video sources are a stage type**, not just files: webcam, Continuity Camera iPhone, tethered
  mirrorless. **They do not all play back live.** A queued camera shows a thumbnail with a ~3-5s clip
  of its last active moment on hover or tap; **only one camera is activated**, as it is staged and
  readied to go live.
- **Stills and video loops can be sent to the stage from the motion editor with keyframes applied.**
- **Bake gains save-direct-to-disk**, so a baked loop outlives the session.
- **Crossfade between live and staged only.** A DJ mixing deck, not Resolume Arena's compositor.

**⭐ THE CONSEQUENCE FOR GATING: only two sources are in working memory at a time.** The other seven
are references. Killing the source and/or staged panels during a transition is on the table as a way
to free resources. **So the capability gate stays a property of the ACTIVE PAIR, not of the queue of
nine.** That is a large simplification over what the queue length first suggested.

**⚠️ AND THE ONE EXPOSURE IT CREATES.** Nine held `File` references is the handle-revocation exposure
multiplied by nine and stretched over time. If the transient `NotFoundError` is iOS revoking a
security-scoped handle some interval after the pick, then **a clip sitting on deck for forty minutes
before promotion is the worst case for it.** The mitigating half: clips sent to the stage from the
motion editor are files WE wrote, so their bytes are ours and they are immune.

**Persistence across sessions is not in the initial build, but must be designed for now.** Daniel:
real users will demand it. The intended shape: **the stage holds motion JSON, actionable metadata and
attributes (is it a loop, and so on) and stage layout; the media itself is referenced on disk, not
held.** This is the same requirement that makes bake-to-disk necessary rather than nice.

---

## How to measure so the answer survives

Full form in `DEBUGGING-PROTOCOL.md` and `BROADCAST-DELIVERY.md` §7. **The four this arc paid for in
builds:**

1. **Cold start, fixed slice, A/B/A.** The same work gets more expensive over a session. Two false
   results in this arc came from uncontrolled A/Bs, and **both were caught by Daniel rather than by
   the instruments.**
2. **Prefer a conserved quantity** that must survive a boundary we do not own, over an activity
   counter. `offered`/`taken`, pts across a wrap, new pictures on the wall. Not draws, calls or
   batches.
3. **Anything that can decline to act must publish why.** An absence is not evidence. `nativeAttach`
   caught three silent fallbacks this arc; `planarTrail` attributed a five-build bug on its first
   report.
4. **Never spend a device session on a Class 1 question.** If reading the code or running a harness can
   answer it, that is not a device test. Batch what genuinely needs hardware.

**⚠️ THE STANDING RULE AT THE TOP OF EVERY VERIFICATION: check the `source` row says `planar · native
decode` before trusting any measurement.** A report from the fallback path cannot be compared to one
from the native path. **This rule was violated for the whole of B752-B759** — fps, session counts and
take numbers were quoted out of reports whose source row said `NOT ON THE PLANAR PATH`. Every
measurement in that matrix needs re-reading against it before it is quoted again.

### ⚠️ Three columns in the report cannot be read at face value

Known instrument defects, not fresh doubt.

1. **Ignore the `pressure` column.** Its baseline re-learns per workload, so it prints `"warming up"`
   mid-run and has labelled 22fps *"nominal"* and 23fps *"fair"* in the same session.
2. **Check the `scenario` tag before trusting any `baseline` delta.** It is set by hand and has been
   wrong (`idle-still` on a 4K HDMI broadcast).
3. **`gpuMsPerFrame` always reads 0** on WebKit — the timer extension is not exposed. It is not a
   measurement of zero cost.

---

## Explicitly not this arc

Named so they stop competing for attention, not to dismiss them.

- **Colour management's OUTPUT half** — a float working space, display transforms, ICC handling. Still
  feature-shaped and belongs with the stage manager. **The INPUT transform is phase 2.5 and is not
  optional.**
- **The notification-bar UI build.** Its spec archaeology is in scope; the build is not.
- **Mobile web and Android.** No Android device has ever been in the loop. One measurement session,
  then a decision, and not before.
- **New forms, motion editor work, tiling density.** Off-arc.
- **Test infrastructure.** A deliberate standalone decision, never a feature-commit rider.

---

## Risk register

What would invalidate this plan rather than merely delay it.

- **The GL context loss at take-arm (2A) is not fixable from our side.** It is a shared WebKit GPU
  process across both webviews. If it cannot be avoided, phase 2's deliverable becomes surviving it
  well — recovery, state preservation, an honest warning — rather than preventing it. **This is
  currently the most likely risk to fire.**
- **Storage (2E) turns out to be the real ceiling.** Then "own the bytes" becomes a phase rather than a
  step, and the 4K-at-10-minutes promise needs restating in terms of free disk rather than device.
- **4K at 10 minutes is not reachable reliably on M1.** Then graceful degradation stops being the
  fallback and becomes the headline product story, and phase 3's honest-labels work moves up.
- **A conclusion in this file was measured on the `<video>` fallback rather than the native decode.**
  It has now happened three times. Every 4K number here should be re-checkable against a report whose
  source row says `planar · native decode`.
