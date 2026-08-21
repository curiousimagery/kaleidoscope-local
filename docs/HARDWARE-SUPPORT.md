# hardware support matrix

**Status: a RECORD OF CURRENT BEST THINKING, not a validated matrix.** Daniel, 2026-08-21: *"we genuinely don't know which features are supportable on which iphones... we should have a matrix recorded where we can test and validate this eventually."* This file exists so that testing has somewhere to land, and so a shipping decision is never made from memory.

**⚠️ THE STANDING RULE THAT GOVERNS THIS WHOLE FILE: the gate must be COMPUTED, NOT A DEVICE TABLE** (Daniel's requirement, restated at B694). This matrix is for *deciding what to test and what to claim in a store listing*. It must never become the thing the app branches on at runtime — that is what the session registry, the learned `broadcastCeiling` and the thermal signal are for. **A device we have never seen must get a correct answer, and a table cannot give one.**

## why a matrix at all, if the gate is computed

Three different questions, and only the first is answered at runtime:

| question | answered by | lives where |
|---|---|---|
| can THIS device do THIS right now | measurement + the session registry | runtime |
| what do we claim in the App Store listing | this matrix | here |
| what do we spend a device session testing | this matrix | here |

## tiers, as currently assumed

**None of these are validated. Every cell below is a hypothesis until a report says otherwise.**

| tier | devices | assumption |
|---|---|---|
| **A — full** | M1 and newer Apple silicon iPad / Mac | all three modes, broadcast, record. **This is the only tier with real data.** |
| **B — unknown** | iPhone, all generations | Still and Motion assumed workable; Perform and broadcast unknown. **The phone chrome is a separate codebase path (`src/mobile/chrome.js`) and has had far less device time.** |
| **C — assumed out** | pre-Apple-silicon iPad / Intel Mac | assumed unsupported **for simplicity, not for evidence**. Daniel: *"it may be that we could safely run our still mode or even still + motion but not perform on vintage ipads and macs... For simplicity's sake i'm assuming not for now."* |

## what is actually measured, and on what

Everything below is M1 iPad Pro 12.9" (1TB) or M1 iPad Air unless stated. **Two devices, one silicon generation.**

| capability | measured | where |
|---|---|---|
| 4K HDMI broadcast, sustained | **22 fps delivered / 30 source** over 1.4M samples | `broadcastCeiling`, T10 |
| 4K broadcast, 50 min unattended | complete, no context loss, power steady | T10 |
| Loop wrap on a 6:39 4K clip | 8 wraps, worst gap **6ms** | T10 (governor off) |
| **FHD take, alone, cool device** | **40.0 fps** | T11, thermal `fair` |
| **FHD take, alone, hot device** | **19.8 fps** | T3r, thermal `serious` |
| FHD take while broadcasting | 12.7 fps | T3r, thermal `serious` |
| **4K take, alone** | **13.4 and 13.8 fps** against a declared 30 | two devices, two builds |
| Peak GL contexts under load | 2–3 | T9, T10, T11 |
| Peak decode sessions (loop builder + bake) | 8 | B700 |

**The two readings that matter most for a support claim:**

- **4K recording is not viable on M1 at all.** 13.5fps against a declared 30, unchanged across builds, devices and the decoder-release work. This is structural, not headroom.
- **Thermal state costs more than any feature combination.** 40 → 19.8 fps on the same device, same tier, minutes apart. **Any honest capability claim has to be conditioned on thermal state**, and no gate currently reads it.

## the gaps that block a real matrix

1. **No iPhone data at all** for Perform or broadcast. The phone chrome is a different code path.
2. **No pre-Apple-silicon data.** Tier C is an assumption with nothing behind it.
3. **No cool-device measurement of FHD-while-broadcasting.** Every run of that combination has been on a hot device, so the honest range is unknown.
4. **One silicon generation.** Everything is M1. We own the top of the range and none of the bottom, which is exactly the calibration trap the computed-gate rule exists to avoid.
5. **iPad Air vs iPad Pro is not a clean comparison** — same M1, but the Air is thinner, fanless and (in Daniel's case) in an insulating case, so it is likely MORE thermally constrained despite doing less work.

## how to fill it in

The scenario runner already carries the scripts. Filling a row means running one and pasting the report:

- `T11 · take baseline, NO broadcast` — the control condition, per device and per tier
- `T3r · record while broadcasting` — the combination
- `T7 · warm long run` — sustained broadcast and thermal behaviour

**Add the device and the thermal state to every row**, because both have now been shown to change the answer more than the feature under test.
