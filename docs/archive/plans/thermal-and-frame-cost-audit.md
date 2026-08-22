# Thermal / sustained-load: frame-cost audit and proposed path

Written 2026-08-05, against v0.22.5 / Build 511. Supersedes the one-line "GATE 2"
entry in `docs/BACKLOG.md` (that entry should point here).

Daniel's framing, which sets the shape of the whole thing: "see all the different
things the app is doing at a given time and ask how comparatively expensive each
one is", then use that list to find redundancies to cut, efficiencies to add,
degradations that are acceptable trades, and walls we cannot pass. Highest impact
on mobile, but affects all platforms.

## 0. The four goals (Daniel, 2026-08-05) — these govern the arc

1. **Identify which capabilities we cannot actually deliver well in the current
   design.** Say so honestly rather than shipping a promise the hardware does not
   keep. Precedents: iPad NDI over WiFi (accepted limitation, documented, warned in
   the UI) and the iPhone record-rate gap (section 4e).
2. **Identify where we are doing too many things at once with no stated priority.**
   Everything currently renders at full quality with equal claim on the GPU. There
   is no declared order of who yields first. Preview and stage quality should yield
   to broadcast fidelity, but nothing in the code knows that today.
3. **Identify where we can optimize to use less energy and produce less heat**, on
   every device.
4. **Identify which functions are necessarily hot, and build a UX around that** so
   nobody drains their battery in ten minutes by accident, but can deliberately opt
   into an intensive mode when the moment calls for it.

Goal 2 is the one with the most leverage and the least code: most of it is a
priority declaration, not an optimization.

---

## 1. The inventory: what runs per frame, and what it costs

### 1a. Renders (fragment work, the dominant cost)

Each row is a full kaleidoscope shader pass over its own pixel count. The pipeline
is fill-rate and texture-bandwidth bound at 4K (established B506), so pixel count
is the currency.

| work item | sized at | pixels | runs when |
| --- | --- | --- | --- |
| preview engine | `main.js resizePreviewCanvas` (DPR capped 2, long edge capped 2048) | ~2 to 4 MP | every render tick |
| perform PiP | `perform-runtime.js sizePip` (cap 1600 docked, 960 floating) | 0.9 to 2.6 MP | perform active |
| output bus hidden engine | `output-engine.js` at the bus output res | 3.7 MP (1920²) to 8.3 MP (4K) | record / Syphon / NDI live |
| external view engine | `output-view.js`, separate process, panel native | up to 8.3 MP | HDMI / AirPlay live |
| source overlay (2D vector) | `overlay.js:184`, wrap size x **uncapped DPR** | panel-sized, 1x to 3x | every render + every overlay tick |
| source video thumb paint | `overlay.js:1529`, long edge 640 | 0.3 MP | every playback frame |

Worst realistic case (perform, 4K source, 4K HDMI, recording): preview 4 + PiP 2.6
+ bus 8.3 + external 8.3 = **23 MP rasterized per frame to put 8.3 MP on air**.
The B506 note measured the non-recording case at ~13 MP for 8.3 MP on air.

### 1b. Uploads

The planar YUV to RGB blit runs **once per engine per frame**: preview, PiP, bus,
external. Four independent conversions of the same decoded frame. Measured at
0.6ms each at 4K (B504), but each also writes an 8.3 MP RGBA texture, roughly
33 MB of VRAM traffic apiece.

### 1c. Readback

Bus only, per frame, at output res, via the probe-selected path
(`conduit/capture.js`). Historically the single most expensive item in the app.

### 1d. Wire

Native decode socket at 12.4 MB/frame at 4K, fanned to N clients. NDI publish
paced to 30fps. Syphon publish per frame.

### 1e. Loops that run regardless of whether anything changed

This is where the cheap wins are.

- **`conduit/output-bus.js frame()`**: renders, reads back and publishes **every
  rAF even when neither the params nor the source frame changed**. A still image
  broadcasting to Syphon pays full freight at 60fps forever.
- **`conduit/external-surface.js loop()`**: posts state every rAF unconditionally.
  Its own comment already flags a static-look skip as a possible follow-up.
- **`perform-runtime.js tick()`**: follower step, commit, PiP render, ghost
  bookkeeping and DOM writes every frame, including when the follower is settled
  and nothing is moving.
- **`source-host.js startLiveLoop()`**: refreshFrame, upload, render, thumb paint
  and a **full overlay vector redraw** every frame.
- **`gamepad-input.js poll()`**: `getGamepads()` plus a per-axis and per-button
  diff every rAF, forever, once initialized.
- Interval timers: `remote-input` state push every 100ms, `output-panel` status
  every 1s and take-watch, `camera-settings` white-balance poll every 600ms.

### 1f. No idling anywhere

Only `mobile/chrome.js` listens for `pagehide` / `visibilitychange`, and that is
for GL context release, not load shedding. Desktop and Electron keep every loop
running when the window is occluded or the app is in the background.

---

## 2. Redundancies and cheap cuts (independent of any governor)

1. **The overlay canvas is the only surface not DPR-capped.** Everything else does
   `Math.min(devicePixelRatio, 2)`; `overlay.js:141` and `:184` use the raw value.
   On a 3x phone that is 2.25x the fill of a capped surface, for vector lines that
   do not benefit from it.
2. **The overlay redraws per frame in the live loops** even though its geometry
   only changes when slice params change. The coalescing scheduler already exists
   (`makeOverlayDrawer`); the live loops bypass it and call `render()` directly.
   **Daniel's position, 2026-08-05, and it is the right one:** the overlay should
   not redraw AT ALL unless it is being actively manipulated. Fast refresh while
   dragging or hovering, otherwise nothing. So this is not "coalesce it", it is
   "drive it from interaction and param change, and let it sit still the rest of
   the time". Note it currently redraws on every frame of camera preview and video
   playback, which is when the device is already busiest.
3. **Bus and poster idle elision.** `programFrame().gen` already means "the look
   actually changed" and the planar reader already returns null for "no new source
   frame". Together they are an exact "nothing changed" test. Republish the cached
   buffer instead of re-rendering and re-reading back. Biggest single win on stills
   and paused footage, with zero visual difference.
4. **Perform tick when settled.** `follower.isSettled()` is already computed. Keep
   committing, skip the PiP render and ghost work when settled over a static source.
5. **Gamepad poll should idle** when no pad is connected (the connect/disconnect
   events already exist to wake it).

## 3. Walls (name them, do not chase them)

- **Separate WebGL contexts cannot share textures.** The four engines exist for
  good reasons (offscreen bus, separate process for the external view). The
  duplicate uploads are structural. A shared 2D canvas is not a fix; that is the
  cross-context readback deleted in B504.
- **WebKit has no thermal API and no GPU timer queries.** See section 4.
- **WiFi NDI jitter.** Already an accepted limitation (B478).

---

## 4. Instrumentation: the honest constraint first

**On WebKit and iPad, where this matters most, we cannot measure GPU time.**
`performance.now()` around a draw call measures command submission, not execution;
WebGL is asynchronous. `EXT_disjoint_timer_query_webgl2` exists on Chromium and
Electron but generally not on WebKit. A conventional profiler would produce
confidently wrong per-item numbers on exactly the platform we care about.

So build two instruments, not one.

### 4a. The frame ledger (`?perf`)

A registry of named work items. Each declares:

- `name` (e.g. `preview.render`, `bus.readback`, `overlay.draw`)
- `serves`: `program` | `editor` | `both` — this is what lets the ledger answer
  "how much am I spending on things the audience never sees", which is the
  degradation question directly
- `pixels`: w x h for render items, so the panel can report MP/frame
- measured wall time, accumulated over a 1s window

Surfaced three ways: a live panel; a push into the existing `env.diag.ops` ring so
"copy diagnostics" carries it; and a console line every few seconds (the pattern
that has already earned its keep twice in `native-video.js`). Instrumentation must
be a no-op function swap when disabled, not a branch at every call site.

**MP/frame is the number that transfers across devices. ms is device-local.**
Report both.

### 4b. The switchboard: per-surface on/off and per-surface resolution

**Corrected 2026-08-05 after Daniel's pushback.** My original framing overstated
the iPad problem. He is right that if something is expensive on desktop it is
almost certainly expensive on iPad, so the correct plan is: **measure precisely on
Electron and Chromium desktop, where real GPU timer queries exist, and use that to
RANK the work items. Then confirm the ranking on iOS by switching items off.** The
one caveat worth keeping is that Apple GPUs are tile-based deferred renderers and
desktop discrete GPUs are immediate-mode, so absolute numbers and the exact
ordering of the middle of the list can shift. The top and bottom of the ranking
transfer reliably.

Every work item gets, in the same panel:

- an **on/off toggle** (turn the preview render off and watch broadcast fps)
- a **resolution stepper**, for the render surfaces (Daniel's idea, and the better
  half of this instrument): flip each surface through a resolution ladder live to
  find, per surface, **the ceiling above which you cannot perceive a quality gain**
  and **the floor below which it genuinely looks bad**. Those two numbers per
  surface per device ARE the degradation ladder. Without them the governor would be
  picking rungs by guess.

Every switch here is a candidate degradation lever, so the switchboard is the
prototype of the ladder, not just a measuring tool.

### 4c. The sustained-load recorder

1Hz samples of fps, frame-time p50/p95, and per-item cost, held in the op ring, so
a multi-minute run can be copied out as evidence. Thermal throttling is only
visible over minutes; a live panel alone cannot show "smooth, then slows down".

### 4d. The pressure-source seam (build it now, consume it later)

`env.pressure` returning a normalized 0..1 plus a `source` label. Implementations:
iOS native `ProcessInfo.thermalState` (nominal/fair/serious/critical) via a small
addition to an existing plugin; everywhere else, inferred from sustained frame-time
drift against a warm-start baseline. In Phase A **nothing consumes it except the
panel display**, which is precisely how we validate that the inferred signal tracks
the native one before any governor rides on it.

---

## 4e. iPhone is the hardest case, and it was missing from the first draft

Daniel's correction. iPhone plus native camera plus record is the most expensive
function on the most thermally constrained device we ship to, and it is the one
case where we already know we are not delivering.

**The known gap:** early capability probing suggested 4K/120 was reachable (the
native camera app does it). In practice we cannot hold 60fps at FHD or 30fps at 4K.
Daniel's read is that this is a design problem on our end, not a device limit, and
that we should be able to reach 120fps FHD or 60fps 4K. Agreed.

**Prime suspect, testable in Phase B:** our record path is a GPU to CPU to GPU
round trip per frame. We render to the hidden engine, copy the image back into
ordinary memory so JavaScript can hold it, then hand it to the encoder. At 4K that
is about 33 MB pulled off the GPU per frame, so 60fps means roughly 2 GB/s of
readback. The native camera app never does this: the encoder is fed the camera's
buffers directly and the pixels never leave the GPU. Two fix classes, both real:
keep the frame on the GPU (the `VideoFrame`-direct-from-canvas path the existing
readback benchmark already tests as candidate C2), or record natively via
`AVAssetWriter` fed by the same planar frames the socket already carries.

This deserves to be a named Phase B target with its own measurement, not a line
item inside the general matrix.

---

## 5. Phased path

**Sequencing note (Daniel asked why instrumentation comes before the obvious wins).**
The overlay fix is certain enough that it does not need justifying by measurement.
It goes SECOND anyway, and only by one build, because **it is the ideal calibration
case for the new instrument**: a change we are confident is large. If the panel does
not show a clear before/after on it, the panel is wrong and we find that out on the
cheapest possible test rather than on a subtle change later. So: B512 instrument,
B513 overlay plus the other certain-waste cuts, measured with it. The functional win
lands one build later, not one phase later.

- **Phase A (one build, no behavior change): ledger + switchboard + resolution
  steppers + pressure display.** `?perf` on web/Electron, a diagnostics button on
  iPad, and a new panel in the iPhone chrome's `#m-diag` (see 5c). Lands in the
  Lab's `LINK_PARAMS` in the same increment.
- **Phase B (Daniel, on device): harvest the matrix.** iPad and Mac x still /
  camera / video x idle / record / HDMI / NDI. Produces the real cost table that
  everything downstream is chosen from.
- **Phase C (one or two builds): cut the free redundancies** in section 2 and
  re-measure with the same instrument. No policy decisions required.
- **Phase D: one governor**, pluggable pressure source, acting on the ladder of
  levers Phase B proved worth pulling. This is where the adaptive-preview-resolution
  proposal and thermal merge, as the BACKLOG note anticipated. Per the recorded
  decision, **ship and verify the fps-driven and thermal-driven inputs separately**;
  a governor check is a short "is it smooth now", thermal is a multi-minute "does
  it stay cool", and bundling them makes both results unreadable.
- **Phase E: honest tiers.** The capability profile publishes a sustained-fps tier
  per device class; the UI sets expectations rather than promising uniformly.

## 5b. The levers, with Daniel's rulings (2026-08-05)

**Standing ruling: nothing is greenlit for removal yet.** Everything below is a
candidate whose fate is decided by what Phase B measures. Recorded here so the
decisions are not re-litigated later.

- **Perform PiP / in-app preview while broadcasting.** Daniel: when broadcasting to
  Syphon, AirPlay or HDMI, the real output is already in the room on a TV or a
  projector, and cross-referencing the real thing is arguably the BETTER UX than a
  small copy of it. But the docked side-by-side (output next to preview) has real
  value for seeing the transition echo in realtime, and Electron desktop has ample
  headroom to keep it. **Direction: make it optional everywhere with defaults set
  per device class,** rather than a global cut. iPhone/iPad are the likely cuts.
- **Preview resolution degradation while broadcasting.** Approved in principle,
  including on iPhone, with **two conditions**: (1) an **open UX requirement** that
  the user can tell the degradation applies to the PREVIEW ONLY and that their
  broadcast/recording is still full quality. Silently showing someone a worse
  picture and letting them think that is what the audience sees is the failure mode
  here. (2) We have to play through the levels to find where it starts to feel bad
  or unusable, which is exactly what the Phase A resolution stepper is for.
- **Perform ghost trail / onion skin.** **Correction: this is functional, not
  decoration.** It gives perform its visceral realtime feedback for what is
  happening; removing it is a capability loss. But it is a GRADED lever: the trail
  is currently up to `GHOST_MAX = 28` wedge outlines re-stroked on every overlay
  draw (on the uncapped-DPR canvas, compounding finding #1). Halving the count
  roughly halves that cost for probably minimal perceptual impact. Measure first,
  then tune the count, never a straight off switch.
- **60fps everywhere.** Daniel: absolutely worth examining per surface. Likely
  shape: the surfaces we are already degrading in resolution (PiP, preview, output
  panel) also drop to 30, while broadcast and recording paths stay high. Per-surface
  frame pacing, not one global rate.
- **The source panel's live video thumbnail during playback.** Small (0.3 MP) but it
  runs every frame. Measure.
- ~~Camera preview at full sensor resolution~~ **already cut** (it was unusably slow
  before thermal was even a consideration). Removed from the candidate list.

## 5c. How we actually measure on iPhone and iPad (Capacitor)

Daniel's question, and it changes Phase A's scope.

**A URL parameter cannot reach the native builds.** The Capacitor shell loads a
fixed URL, so `?perf` is only an entry point for web and Electron. The native
builds need an in-app entry, and the pattern already exists: the desktop chrome's
diagnostics section carries real toggle buttons (`source detail`, `NDI clock_video`,
`HDMI uncap`) that persist through localStorage. The perf panel joins them.

- **iPad (Capacitor, desktop chrome):** a button in the existing diagnostics
  section. No new surface needed.
- **iPhone (mobile chrome):** `#m-diag` is currently a read-only text block with a
  show/hide link. It needs the panel and its switches added. This is the real added
  scope in Phase A, and it is worth it: iPhone is the case that matters most.
- **Web and Electron:** `?perf`, listed in the Lab's `LINK_PARAMS` per the standing
  rule.

**Is browser-on-device a valid proxy for the native build?** Partly, and the split
matters. Capacitor iOS runs WKWebView, the same engine as Safari, so the shared
render costs (engine renders, overlay, preview, PiP, uploads) should track closely.
But **every expensive path that is unique to the native builds does not exist in
mobile Safari at all**: the native decode socket, the native camera, the HDMI
external display, NDI, native record. Those are exactly the ones we most need to
measure. So browser testing is a reasonable first pass for the shared surfaces and
tells us nothing about the native paths. The in-app entry point is required, not a
convenience.

## 5d. Durability: making this survive the next UX curveball

Prompted by Daniel's merged-single-surface proposal (BACKLOG, Chrome / layout),
which is exactly the class of change that could silently undo these wins. Two
requirements, both cheap if designed in from the start and expensive to retrofit.

**1. The surface registry must be LAYOUT-AGNOSTIC.** If the ledger's items are
hardcoded as `preview.render`, `pip.render`, `overlay.draw` bound to today's
panels, any layout change orphans them and the governor's ladder points at
surfaces that no longer exist. Instead: **a surface REGISTERS itself when it
mounts and unregisters when it unmounts**, declaring its role, its pixel
dimensions, and its priority. Merged mode then registers one surface instead of
two, and the ledger, the switchboard and the governor keep working with no
changes. This is the single most important design constraint on Phase A.

**2. Declared priority, not inferred priority.** Each surface declares where it
sits in the yield order (broadcast and recording last, editor conveniences first).
That is goal 2 from section 0, and it is what lets a NEW surface arrive already
knowing how it should degrade, instead of needing the governor taught about it.

**3. A baseline you can diff against ("system performance health").** Daniel's
question: how do we know how a new feature performs across hardware and contexts?
We have no test infrastructure and cannot run devices in CI, so the honest answer
is a manual-but-cheap loop:

- **Named scenarios.** Roughly six canonical runs (iPhone camera live; iPhone
  record; iPad 4K to HDMI; iPad NDI; Mac Syphon; Electron idle) so a measurement
  is comparable across sessions, devices and builds instead of being ad hoc.
- **Save-as-baseline.** The sustained-load recorder gets a "make this the baseline
  for this device + scenario" action, persisted locally. The panel then shows
  current vs baseline deltas, so a regression is VISIBLE at the next run rather
  than felt three builds later.
- **A budget per surface per device class.** When a change pushes a class over
  budget, the panel says so by name.
- **Process (Daniel's call, proposed not assumed):** a fifth item on the standing
  maintenance ritual, applying only to changes that touch a render path: run your
  device's baseline scenario and note the delta in the CHANGELOG entry.

## 5e. Three more future surfaces, and the Phase A requirements they produced

Daniel asked (2026-08-05) whether this instrumentation will translate to future
feature work: user-loadable shaders, three.js tiled geometry, and a hyperbolic
form. Full per-feature assessment is in `docs/BACKLOG.md` under "Future surfaces —
PERF PRE-ASSESSMENT". The three requirements they add to Phase A:

1. **Work items NEST: a surface owns passes.** Today every surface has exactly one
   pass, so this looks like over-design. It is not: a user shader is a second pass
   on an existing surface, a three.js scene is a second pass consuming the first,
   and a form's contribution is a slice of one pass. Without nesting, none of the
   three can be attributed and the ledger answers "the preview got slower" instead
   of "the stipple shader costs 4ms of the preview's 6ms". Cheap now, a rewrite later.
2. **One-shot renders are budgeted SEPARATELY from per-frame renders.** A still
   export has a budget measured in seconds; a live frame has 16ms. The single most
   useful thing we can tell someone about an expensive effect is "this is fine on a
   still and impossible on video", and the ledger cannot say that if both are
   averaged into one number.
3. **A cost-probe primitive: render N frames at a known size and report.** This is
   what classifies an unbounded user shader at load time, and it is the same code
   as the named-scenario baseline runner in 5d. Build it once.

## 7. Phase B: the device measurement protocol (Daniel's pass)

**Reading the numbers.** `ms` is main-thread submission time; `gpu ms` (Chromium/Electron only,
B514) is true execution time and leads the row where present. The PANEL's fps is what the main
app delivered. The OUTPUT PANEL's status fps is different: for a self-rendering destination it
is the external view's own measured rate, which is the one that says whether the audience sees
smooth video; for record/Syphon it is bus throughput.

**"Ablation" = switch one thing off, see what it was costing.** From the frame-cost panel's
on/off buttons; read the delta on the panel's fps, plus the destination's fps when broadcasting.

**The same five steps every time**, so runs are comparable:
1. Get into the state, let it run **30 seconds** (the pressure signal needs ~5s just to learn a
   baseline).
2. Pick the matching **scenario** in the dropdown, then **save baseline**.
3. Note the top line: fps, frame ms, MP/frame.
4. **Ablate:** switch off one surface, wait ~5s, note fps, switch back on. Repeat per surface.
5. **Resolution:** step preview (and PiP) down the ladder. Note the rung where improvement stops
   being visible going up (the CEILING) and where it starts looking bad going down (the FLOOR).

**The scenarios, in priority order.** If only two get done, do the first two.

1. **iPhone, camera live** (`camera-live`). Still mode, live camera, some slice/canvas edits and
   gestures. Then leave it **ten minutes untouched** watching pressure and fps: the only test
   that validates the inferred thermal signal.
2. **iPhone, recording** (`recording`). At the currently shipping settings (FHD 60 / 4K 30).
   **The question: in the bus row, does the readback pass cost more than the render pass?** If
   yes, the GPU→CPU round trip is confirmed as the reason we cannot hold the expected rates.
3. **iPad, 4K video → 4K HDMI** (`hdmi-broadcast`). **The question: what does switching the
   preview off do to fps?** That is the single biggest proposed lever and we have no number.
4. **Mac Electron, Syphon + record.** For the RANKING, not for finding a problem — desktop has
   headroom, and this is where real GPU numbers exist. Still first (elision shows up here),
   then video, then record-while-broadcasting.
5. **Anywhere, motion playback with video** (`video-playback`). The before/after for B513: with
   the optimization switches, the A/B is now two taps rather than two builds.

**On re-enabling the crashing capture settings (Daniel's question).** Not for Phase B. The cost
map comes from the shipping settings and the ranking transfers. The crash is a SEPARATE,
deliberate "push to failure" run once the map exists, with the panel open and `copy report` ready
— the last report before the crash is the evidence, and it is worth much more once we know what
normal looks like. Suspicion worth recording: if readback dominates, the crash is likely memory
pressure from queued frames rather than raw speed, which is a different fix. No need to test the
14 Pro yet; the 17 Pro shows the shape.

## 6. Conduit split

The ledger, the pressure seam and the governor belong in **conduit** (every future
consumer needs them, and the bus and poster loops that need elision already live
there). The work-item registrations stay in Fold. Flagged per the standing rule.
