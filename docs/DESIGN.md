# design system

How Fold's visual layer is built and edited. This is the working guide for the
tokens, the UI Lab, and the loop for changing how things look. It is deliberately
short; it grows only when a real inconsistency forces a principled trade-off note.

Companion docs: `ARCHITECTURE.md` (where the layer sits in the codebase) and the
running app + the UI Lab (`/lab.html`), which are the source of truth for how things
actually look. Figma / Claude Design are upstream design *inputs* that can feed the
tokens; they are never a runtime renderer.

## the two tiers

Everything visual is a CSS custom property in `src/shell/tokens.css`, in two tiers:

1. **Primitives** (`--c-*`, plus the raw type / radii / spacing scales) are the raw
   palette. They are faithful to the values the app actually uses, so adopting tokens
   was a parity refactor (no pixels moved except where we consciously decided one
   should). You rarely edit these directly.
2. **Semantic aliases** are what the CSS consumes: `--bg`, `--surface`, `--text-dim`,
   `--accent`, and so on. Each names an INTENT, not a color. **This is the layer you
   edit.** Change one semantic alias and every consumer (both chromes and the Lab)
   moves together.

`tokens.css` is linked in `index.html` before the chrome styles. The mobile chrome
reuses `index.html`'s `<head>` (boot.js swaps the body, not the head), so the same
`:root` reaches desktop AND mobile. One palette, two surfaces.

## token map (the editable surface)

**Surfaces** (backgrounds, darkest to lightest): `--bg` (app background) · `--surface`
(chrome: panels, bars, footer, tab bar) · `--surface-raised` (modal cards, busy card,
timeline track) · `--surface-control` (buttons, inputs, control fills; `--surface-overlay`
shares this value for menus) · `--surface-hover`.

**Borders:** `--border` (default) · `--border-subtle` (faint panel/group separators) ·
`--border-hover` · `--border-strong` (inputs, disabled).

**Text:** `--text` (primary) · `--text-bright` (emphasis/active) · `--text-secondary`
(values, idle button labels) · `--text-dim` (labels, the workhorse) · `--text-muted`
(captions, meta) · `--text-faint` (placeholders). Plus `--fill-bright` for the bright
"primary" UI ELEMENT fill (primary button, slider thumb, scrubber, progress) as distinct
from bright text, and `--on-accent` for dark text/icons sitting on an accent fill.

**Intent / state colors:** `--accent` (amber: keyframes, clip trim) · `--ok` (green:
broadcast/live/success) · `--danger` (red: record/error) · `--danger-text` (softer inline
error text) · `--warn-text` (busy) · `--info` (blue) · `--focus` (focus border color).

**Type:** `--font-sans` (one unified stack for both surfaces) · `--font-mono` · size ramp
`--text-2xs` (9px) through `--text-xl` (18px).

**Radii:** `--radius-2xs` (1px) through `--radius-3xl` (16px) and `--radius-full` (50%).

**Spacing:** `--space-2` through `--space-24`, named by pixel value. (The scale exists;
adoption across the stylesheets is an in-progress follow-up. Some paddings stay literal
on purpose because layout math depends on them, e.g. the `.ms-stage` 24px that the
canvas-fit code subtracts as 48.)

**Control / state:** `--touch-target` (44px coarse pointer / 32px fine, via a
`@media (pointer: coarse)` override) · `--disabled-opacity` / `--disabled-opacity-strong`
· `--dur` / `--dur-slow` (base transition durations) · `--focus-ring` (defined, not yet
consumed).

## the working loop

- **A global change** (this color everywhere, this radius everywhere): edit the semantic
  token in `tokens.css`. Verify in the Lab and the running app; both update at once.
- **A surface-specific need** (this one element should differ): make it a documented,
  scoped exception in the relevant stylesheet, ideally still built from primitives. A
  scoped exception is a conscious branch, not a one-off literal; note WHY in a comment.
  Branch to a variant only when genuinely justified.
- **Daniel's pixel-granular ad-hoc:** point at the Lab or the running app and say what
  should change. Claude encodes it as either a token edit (if it is really a global
  intent) or a scoped exception (if it is local). Defaults hold everywhere else.
- **Ad-hoc visual assets** (an icon, a cursor, an on-canvas affordance): inline-SVG /
  drawn modules in a conventioned location, beside `mobile/icons.js`, `shell/cursors.js`,
  and the `overlay.js` affordance primitives. Not loose files. **When Daniel hands over an
  SVG, clarify which mode this handoff is** — there are two, and they look identical until
  you ask: (1) *design intent* — take its geometry (arc curvature, arrowhead angles, the
  shape it implies) and *redraw* it in our normalized style (our stroke weights, our cursor
  size ~32px not the source's export scale, our grid `0 0 24 24`, `currentColor`); or
  (2) *a literal asset* he wants integrated as-authored. Default to asking which, rather than
  assuming. A raw paste of an intent-asset lands off-weight, off-size, and often rotated; a
  redraw of a literal asset throws away the exact shape he wanted — so the cost of guessing
  wrong runs both ways. For affordances specifically, render from the real exported draw
  primitives, never a divergent reproduction.

The exit criterion for any element type: one style, edited once, applied everywhere;
a variant only where the difference is earned.

## extending onto new surfaces (perform / live, and beyond)

This app already spans two consumers of the layer: the still tool AND the motion editor
(the keyframe timeline + clip editor — its controls are in the Lab: `.mf-btn`, `.mf-track`,
the keyframe markers, `.clip-bar`). So motion isn't a future shell to prepare for — it's
already proving the components hold up in a denser, timeline-heavy surface. The genuinely-new
surface ahead is the **live / perform shell** (the VJ / MIDI-driven output surface), plus any
future repackaging of the engine (native wrapper, plugin). They share the engine AND should
share this visual layer — the goal is that a new surface reaches for the existing vocabulary
instead of inventing a parallel, slightly-different one. The rules that keep that from
fragmenting (and that the still↔motion split already follows):

- **Add a primitive only for a genuinely new raw value; reach for a semantic alias for
  everything else.** A new shell almost never needs a new color — it needs to consume `--surface`,
  `--text-dim`, `--accent` like the existing chromes do. If you find yourself adding `--c-*`,
  ask whether an existing primitive already covers it.
- **The Lab is the pre-ship gate.** Before a new shell's UI lands, it should appear in the Lab
  (its controls in the state matrix, its tokens in the catalogs) and read coherently beside the
  existing surfaces. The usage cross-reference (`n×` badges, `0×` = unused) is the
  fragmentation detector: a new token with no consumers, or an old role re-implemented under a
  new class, shows up there.
- **Components are parameterized, not forked.** Touch-target size scales with the input class
  (coarse vs fine), not by copying a control per shell. Two chromes already prove this; a third
  joins the same rules.
- **Spacing is declared but not yet load-bearing.** The `--space-*` scale exists and reads `0×`
  in the Lab — the stylesheets still use literal padding/gap. So a new shell has *no adopted
  spacing precedent to copy*; don't freelance pixel values. The open intent is to reduce the
  current sprawl of spacing/sizing variants toward a smaller, more intentional set — base-8 is
  **one experiment to try on the app bar, hands open, not a committed direction.** Until that
  settles, keep new spacing minimal and flag it for the consolidation pass rather than minting
  new one-off values.

## responsive + touch targets

Fold runs across a desktop/iPad chrome and a phone chrome, in both orientations. The
queries in use:

- **`@media (pointer: coarse)`** is the touch switch. It fattens hit targets to
  `--touch-target` (44px) and enlarges the slider thumb/track. The slider, scrub, and
  the `.ot-btn` / `.form-thumb` / `.mf-btn` coarse hit areas all read `--touch-target`,
  so the touch size is edited in one place and the desktop-touch and mobile sliders are
  identical. The phone is always a coarse pointer, so it inherits these rules directly;
  it must not re-declare a conflicting control height (the old mobile `height: 28px`
  slider override was the bug this replaced).
- **`@media (orientation: landscape|portrait)`** drives the layout reflows (the mobile
  root flips row/column; the desktop bar falls back to content-sized groups in tight
  portrait touch).
- **Coarse + landscape** carries one behavioral hack: a `34px` top padding to clear
  Safari's compact tab bar, which `env(safe-area-inset-top)` does not account for. This
  is a known rough spot (it can misfire outside Safari) and is a behavioral fix that
  needs live inspection, not pure tokenization. Flagged, not yet resolved.
- **Safe-area insets** (`env(safe-area-inset-*)`) are honored verbatim. We do not
  pixel-match device corner radii or nudge toward the true edge; that is a native-app
  concern and fragile across hardware.

Principle for transitioning between sizes/shapes: scale the touch target with the input
class first (coarse vs fine), and let panel-relative thresholds follow only where a real
ergonomic problem shows up (e.g. the Movink running Fold at a ~7in effective panel size
wants fat targets even though the Mac reports a fine pointer). Prefer the simplest query
that solves the actual problem over a parametric system nobody asked for.

## the UI Lab

`/lab.html` (built into `dist/` too) renders every token live, reading each value with
`getComputedStyle` so the swatches and the printed values are a faithful mirror, never a
hand-copied list. Below the tokens it shows the core controls in their states. This is
where "edit once" is proved: change a semantic token in `tokens.css`, and every swatch
and control in the Lab moves with it. It is the surface to review visual changes against
before they reach the app.
