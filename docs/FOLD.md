# Fold — project reference

The vision, brand, narrative, and strategic context for Fold. This doc is the "why" and the "what we tell the world." For codebase structure see `ARCHITECTURE.md`; for forward work see `BACKLOG.md`; for working conventions see `CLAUDE.md`; for current rolling state see `HANDOFF.md`.

This doc is what to re-read at the start of a strategic session, or to hand to a collaborator (or yourself after time away) to get back the shape of the project beyond the code.

---

## what Fold is

A playground for visual symmetry. A browser-based tool that transforms imagery through folding, repetition, and spatial transformation — revealing hidden structure, unexpected forms, and new visual worlds. Built for high-resolution output and fast, precise control. Designed to work as both a serious creative tool for gallery prints and a moment-of-wonder for a friend pointing their phone at a tree.

## the core idea

Most kaleidoscope tools treat an image as a single thing you process. Fold treats the image as a *space to explore*. A photoshoot within an already-captured photograph. The wedge isn't a filter; it's a camera frame moving inside a larger frame. Move it, rotate it, scale it, and dozens of distinct kaleidoscopes emerge from a single source. High resolution makes this real; precise direct manipulation makes it playful; the same engine serves both the gallery print and the phone-in-the-forest moment.

## the motivational frame

Underneath the product is a mission: help people see the world differently. Kaleidoscopes have a particular magic. Radial symmetry reveals sub-structures the eye otherwise misses; motion implies emergence or collapse; familiar creatures become alien; plants become creatures; cute becomes uncanny; ordinary becomes majestic. Everything awakens a sense of newness. Fold is a tool that delivers that perceptual shift, both as a precise instrument for committed artists and as a fun party trick that genuinely changes how someone sees a tree after using it for thirty seconds.

## the pro-and-playful tension is a feature

The core design tension — precise power-user tool vs. wonder-delivery mechanism — is not a problem to solve. It's the positioning advantage.

Most creative tools pick a lane. Figma didn't (designers and PMs both use it on the same canvas because the rendering and collaboration substrate is strong). Procreate didn't (a kid can finger-paint and a professional illustrator can ship a book cover). Fold is the same shape: one engine, multiple shells, each shell tuned for its surface.

The narrative for this: *"I built the engine I needed for professional print work, and the same engine happens to deliver a moment of wonder when you point a phone camera at a tree."* That's not a tension to apologize for; that's a feature of having built it right.

For the technical commitment that makes this possible (engine + shells, single state object, forms registry), see `ARCHITECTURE.md`.

---

## marketing narrative

Source material for video voiceover, landing page, and pitches. The beat list below is consolidated from an original ~15-beat stream-of-consciousness to roughly 10 beats for a 90-second-to-2-minute video. Verbatim quotes are marked — preserve those phrasings.

### origin story beats

**1. Falling in love with kaleidoscopes.** First discovery years ago in Adobe Capture, then organically again processing video for live VJ sets in Final Cut Pro. Happy accident. Radial symmetries blowing my mind, revealing endless fascinating sub-structures.

**2. Why kaleidoscopes are different from other visual effects.**
*"Motion implicitly suggests emergence or collapse. Familiar creatures become alien, plants become creatures. Cute becomes uncanny. Ordinary becomes majestic. Everything awakens a sense of newness."* (Verbatim — preserve.)

**3. Professional practice context.** In my live VJ performance work, kaleidoscopes became iconic. Almost a motif within an emerging language of visual synesthesia. A reliable way to find unexpected magic in footage. (Footage: phone overhead walking through forest, cut to forest kaleidoscope output.)

**4. The commissioned moment.** Invited by Canvas to create still art for their EP release of *Interrupt the Loop*. Felt appropriate to keep this iconic style. Almost a spiritual contemplation in form, texture, and symmetry. Most of the images were shot in a single afternoon around a single fallen tree in Sammamish.

**5. The discovery that became the product.**
*"Making the kaleidoscopes from these images was a genuine wonderland. It felt like a photoshoot within each image. The process of making these images itself is as captivating as the images themselves."* (Verbatim — preserve. This is the load-bearing line. This is what differentiates Fold from every other kaleidoscope tool.)

**6. Why I had to build it myself.** Spent a full day looking for good options to make kaleidoscopes from full-resolution images. Imagined it couldn't be that hard. Found mostly antiquated terrible options and one pretty-okay web app that I ended up using. Hit its limits immediately: kludgy UX, 3K output resolution max, visible seams, cluttered with features that don't belong in a dedicated kaleidoscope tool.

**7. The build, framed honestly.** So I built my own. On modern hardware it can output 64 to 256 megapixel images. Wanted something that wasn't gimmicky. A real tool that gets out of the way. Intuitive, playful, powerful, seamless. (No self-deprecation. You shipped a real tool. You're an artist who codes. Own it.)

**8. What it is.** Proud to share Fold. A playground for visual symmetry. Minimal elegant UI that gets out of the way. Precise, gestural, playful controls. High-resolution output in a lightweight package. Optimized across mobile, tablet, and desktop on a shared architecture.

**9. But it's not about specs.** This isn't about technical specifications. It's about an experience. A new way of seeing, and creating, and unlocking new creative capabilities in how you perceive the world and the images you can make.

**10. The invitation.**
*"I can't wait to hear how experimenting with it changes how you see."* Let's play. (POV over shoulder looking at phone capturing scene in kaleidoscope.)

### elevator pitch

*I needed something serious enough for gallery prints and simple enough that my friend's kid could make something amazing on my phone in thirty seconds. So I built both, on the same foundation.*

### verbatim quotes to preserve (quick reference)

- "Motion implicitly suggests emergence or collapse. Familiar creatures become alien, plants become creatures. Cute becomes uncanny. Ordinary becomes majestic. Everything awakens a sense of newness."
- "It felt like a photoshoot within each image. The process of making these images itself is as captivating as the images themselves."
- "I can't wait to hear how experimenting with it changes how you see."
- "Let's play."

---

## landing page copy

### canonical version (current)

> **Fold**
> *A playground for visual symmetry.*
>
> Find the patterns hiding inside any image. Reveal hidden structure, unexpected forms, new visual worlds.
>
> High resolution. Fast, precise control. Built for everything from a phone in a forest to a gallery print.

### original version (preserved for reference)

> **Fold**
> *A playground for visual symmetry*
>
> Transform imagery through folding, repetition, and spatial transformation.
> Reveal hidden structure, unexpected forms, and new visual worlds.
> Create high-resolution results with fast, precise control.

The canonical version replaces "transform imagery through folding, repetition, and spatial transformation" with the more experiential "find the patterns hiding inside any image," and names the pro-and-playful range explicitly with the "phone in a forest to a gallery print" line.

---

## brand and distribution

### current direction (working, semi-committed)

- **Product name: Fold.** Strong straw-man current name. Short, single-syllable, noun-verb. Pairs cleanly with Drift as a sibling. Extensible into a product line. What the tool actually does.
- **Artist identity: Curious Imagery.** Daniel's existing alias, active on Instagram, known in the VJ scene. Stays as the artist identity. Tools are made *by* Daniel under Curious Imagery, not under Curious Imagery as a studio brand.
- **Launch URL: `curiousimagery.com/fold`.** Free, available, leverages existing domain equity.
- **Domain reorg to-do:** reverse the `pnwux.com` → `curiousimagery.com` redirect so `curiousimagery.com` becomes primary again; product design portfolio becomes a subpage or retires.
- **Distribution at launch: GitHub Pages (public) + Ko-fi tip jar.** No paywall.

### open problems with "Fold"

Captured honestly so we don't have to rehash:

- Common English word. SEO discoverability is brutal for "Fold" alone (foldable phones, Fold protein-folding, Stanford Foldit). Mitigated by always pairing with a qualifier: "Fold app," "Fold by Curious Imagery."
- `fold.com` is taken (currently redirects to amicusrx.com). `fold.app` and other clean variants generally unavailable or premium-priced ($1,500+ on the secondary market for `fold.art`).
- Spelling-wise excellent; verbalization-wise good. The risk is name *recognition* in search, not name *recall* in conversation.

### possible upgrades (not blocking, watching for an aha moment)

- **Prism.** Single-word, evocative, immediately legible. Stronger visual association to what the tool does than "Fold." If a clean URL ever surfaces (`prism.studio`, `prism.tools`), worth a serious test against Fold.
- **Other directions worth occasional consideration:** Petal, Mirror, Symmetry. Each captures part of the work but none has the noun-verb energy of Fold.
- **TLD-as-part-of-name pattern:** `fold.studio`, `fold.tools`, `fold.garden`, `fold.show` would be excellent URLs *if available*. Worth checking when ready to commit to a paid domain.

### parent domain shortlist (for future walled garden)

When the walled-garden subscription brand launches (see Monetization below), it wants its own parent domain.

**Validated as in cart at the registrar (verified available at the time of writing):**
- `curioustools.art` ($4) — leading candidate. Reads as a small thoughtful studio. The `.art` TLD fits the context.
- `curiousstudio.art` ($4) — sibling option, slightly more professional tone.
- `curiousfold.com` ($14) — product-and-creator combined; could work as either the Fold URL or the parent.
- `curiouslaboratory.io` ($60/yr) — workable but expensive forever.

**Patterns to check availability of later, not validated:**
- `curiouspetal.com`, `curioussymmetry.com`, `curiousprism.com`, `curiousmaker.com`, `curiousworks.com` — variations on "curious + concept."
- `unfold.studio`, `refold.studio`, `foldworks.studio`, `slowfold.studio`, `quietfold.studio` — TLD-as-part-of-phrase pattern.

**Soft commitment:** `curioustools.art` as the parent for the walled garden. Confirm at registration time. Not buying domains right now.

### brand architecture decision (captured to avoid rehashing)

Three identities exist:
1. `@curiousimagery` — artist alias, active, known in the VJ scene.
2. `pnwux.com` — product design portfolio, mostly dormant.
3. Fold, Drift, Zoetrope — creative tools, currently on transient URLs.

The decision: **Fold is its own product brand, with Curious Imagery as the creator credit on its landing page.** Fold doesn't get nested inside Curious Imagery's identity, but it links to it. Curious Imagery's audience can discover Fold; Fold's audience can discover the artist behind it. The `pnwux.com` domain demotes to a slim product-design-only landing or retires entirely.

---

## monetization paths

In priority order. Phase 1 ships first; later phases build on the audience Phase 1 establishes.

**Phase 1: PWA + Ko-fi tips.** Zero new code beyond a Ko-fi link. Free tool, optional support. Audience-building mechanism. Realistic outcome: tens to low hundreds of dollars annually unless marketing accelerates. The real value is *establishing the audience* that later phases require.

**Phase 2: Walled-garden subscription brand.** Patreon-style or direct subscription. Subscribers access a library of creative tools and content. Builds on the audience from Phase 1. Parent brand candidate: `curioustools.art`. Fold + Drift + Zoetrope + future tools could sit inside it, plus content (tutorials, sample images, BTS). This is the "garden of creative projects" concept.

**Phase 3: Native iPad app via Capacitor.** Paid app in the App Store, $5–15 price point. Capacitor lets the web code remain the core, with native shells added for Apple Pencil pressure, Files app integration, Photos library writes, native share sheet, Shortcuts integration. These additions clear App Store guideline 4.2 (Minimum Functionality) by providing capabilities the web version doesn't have. Requires Apple Developer account ($99/yr) and Apple's 15–30% cut.

**Phase 4 (sidebar): Native Mac wrapper for Syphon out.** Electron or Swift wrapper that exposes Syphon for direct routing into Resolume. For VJ-specific workflow. Standalone POC spike, not part of the main codebase. Lower priority than the OS-level workarounds (OBS Virtual Camera, NDI Tools' Webcam Input plugin), which already let any browser canvas feed into Resolume today with zero code changes.

**Phase 5 (deferred): Photoshop PSD export integration.** Not a plugin. Just export kaleidoscope output + original image + wedge as separate PSD layers for clean handoff to existing Photoshop workflows. Useful but not market-defining.

### notes on monetization decisions

- Sliding-scale shareware exists as a model (Tarsnap, others) but works best coupled with strong creator audience trust. Worth considering as a Phase 1 alternative if the audience demands more than tips but isn't ready for subscription.
- Apple doesn't have a "code provenance" filter; they have functionality and quality filters. The "vibe-coded apps get rejected" worry is misplaced. What gets rejected is thin web wrappers without native functionality.
- The Mac wrapper for Syphon is the path to selling to VJs specifically. The iPad app is the path to selling to a broader creative audience. Both can coexist with the web app as the free entry point.

---

## gallery show concept

A future production possibility, not blocking on anything else.

### curatorial frame

A show of many kaleidoscopes derived from a small set of source images. Possibly just one, possibly a handful from a single shoot. The Sammamish fallen tree is the natural reference case: an afternoon of shooting in one location, dozens of distinct kaleidoscopes from each image. The original photographs hang alongside the kaleidoscopes derived from them, with the wedge overlay shown to teach the audience how the work was made without didactic wall text.

### interactive kiosk component

A locked-down 12.9" iPad Pro in fullscreen Guided Access mode, physically secured, runs a kiosk version of Fold. Visitors explore the same source images and create their own kaleidoscope variations. Their outputs feed a separate rotating display, creating a self-reinforcing loop: visitors see what others made, get inspired, make their own.

### source-image strategy

Two viable approaches:

1. **Curated source images only.** Five to ten images Daniel has shot, available in the kiosk for selection. Simplest. Avoids moderation and storage concerns.

2. **Live source via document camera.** A small table of interesting objects, a document camera positioned overhead, the kiosk uses the live camera feed (from the live-camera shell) as the source. Visitors arrange objects and watch the kaleidoscope respond. Most experiential. Requires the live-camera shell to be solid.

For visitor-submitted images: a QR code linking to a public Dropbox upload folder or an email address that routes attachments to a watched folder. Fold reads from the folder. The upload-and-moderation layer is a *separate app*, not part of Fold itself.

### cloud folder handshake (architectural note)

Fold's contribution at gallery scale: read source images from a configured cloud folder, write outputs to another configured cloud folder. Fixed paths. Clean handshake. Everything else (upload UI, moderation queue, gallery display rotation) is someone else's problem (or a future sibling tool).

### production status

Not started. Pitch when product is solid enough to demo and you have a venue in mind.

---

## future explorations (parked)

- **Syphon for VJ output via a native Mac wrapper.** Partly addressed via OS-level workarounds today (OBS Virtual Camera, NDI). Native wrapper is a sidebar track in `BACKLOG.md`, not main sequence.
- **Native iPadOS app.** In monetization phasing as Phase 3 above.
- **Photoshop PSD export round-trip.** In monetization phasing as Phase 5 above.
- **Brand aha moment for a stronger single-word name.** Watching. Not blocking.
- **True fractal zoom (Mandelbrot/Julia paradigm).** Different math, different paradigm. Not a kaleidoscope form. Would be a sibling tool. Shelved unless a coherent product concept emerges.
