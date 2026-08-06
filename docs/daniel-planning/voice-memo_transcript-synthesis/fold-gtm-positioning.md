# Fold: Go-to-Market and Positioning

Synthesized from the Jul 4 Bellingham drive, the Jul 20 barefoot-by-the-river session, and the Aug 2 family demo debrief. Quotes kept in your voice where they carry real signal.

---

## The Fork: Fine Art vs. Software Product

Both Andrew and your dad landed on the same fork independently: differentiate as an artist doing exceptional symmetry work, still and in motion, and license or sell that work directly to partners and events, versus building and selling the tool itself. These aren't mutually exclusive. You floated running your own gallery shows and print sales while keeping the underlying software closer to your chest, letting the fine-art side build reputation without requiring the tool to be public.

## Partnership Ideas

- **Hardware makers (xTool, laser cutters, dye cutters, UV printers).** A "works with X" style certification, similar to how LightBurn and other CNC-adjacent software position themselves. Rationale: someone who already paid hundreds of dollars for hardware is a much easier sell on a smaller add-on price for software that unlocks what the hardware can do.
- **Procreate.** Pitch: Fold's symmetry engine applied live on top of Procreate's canvas, in the spirit of their existing mirroring tools but with more depth. Framed as mutually beneficial: "y'all want to essentially give me a huge shout out in exchange for me providing some new math and ideas for novel ways of sketching within your canvas." See the backlog doc for the technical shape of this.
- **Interior design, wallpaper, and dropship tile manufacturing.** Downstream idea: convert an image into a numbered grid of physical tiles a customer could apply top-to-bottom, left-to-right, to cover a real surface. You flagged this yourself as legitimately interesting but a step removed, since it requires an industrial manufacturing partner and isn't core to the tool.
- **Live Nation / event producers.** Winston, a Live Nation event producer you met performing at Fremont Fridays, reacted strongly to Fold and half-jokingly told you to get a lawyer. Andrew separately raised the Disney California Adventure fountain light-show comparison as the scale of spectacle this could plug into. No concrete next step yet, just a validated strong reaction from someone with real industry reach.

## Premium Commissioned Content (a business model, not a software SKU)

A distinct idea from selling the app: get hired directly by a musician or artist you're genuinely excited about, for a multi-month embedded engagement producing content you own and can perform live at their shows. Your own pencil math: roughly $10k/month plus hardware and drive costs, plus a couple thousand for occasional hired help on specific shoots, landing around $25k to $35k total for a project that yields premium, owned footage and a real creative platform. Reference points you named: the Sales/Gorillaz style of music video, hand-carved miniature and practical-effects shoots (a wooden boat on a creek came up specifically), and possibly collaborating with a Seattle-based motion artist. This is closer to your VJ/artist practice than to Fold-the-product, but it's the same underlying capability, worth keeping in view alongside the software business.

## Shader Engine / Marketplace

Idea for a Procreate-brush-engine-style layer: a handful of high-quality built-in shaders (pointillism, line art, etc. for laser-etching prep) plus an open system for people to build, share, or sell their own, without you trying to lock the ecosystem down. You explicitly connected this to the tile/pattern builder work already in the backlog, since converting a raster image for laser-etching or LED-wall output is a natural extension of the same pipeline.

## Marketing and Storytelling Gaps (self-identified)

You named this directly as your own weak spot: "I'm not good at selling it... I need to be more proud and assertive of what the magic is." Concrete threads:

- A clearer intro sequence: something like "worlds within worlds, activate wonder," leading with spectacular high-res results (nebula, etc.) before drilling into the loving detail of individual controls (the joystick pan, EV, tap-to-focus).
- Resolution and size framing needs a consumer-friendly translation, not "6K." See the backlog doc's capture UX notes.
- Family demo (Aug 2) is your best informal signal so far: your dad's reaction moved quickly into practical/commercial territory, and Peregrine and Sylvia's spontaneous back-and-forth photo-taking is a good real-world example of the "gift/casual/mass market" use case working as intended.

## Pricing and Tiering: Two Competing Structures

You talked through this out loud at length without landing on a final answer. Both models below came up as live options; neither is a decision yet.

**Model A, generous/bundled:**
- Entry tier (roughly $3.99): tileable forms, radial wedge included but with segment count locked, magic-mirror mode, iPhone and iPad.
- Studio tier (roughly $10 total, so ~$6 upgrade from entry): unlocks Drosta, hyperbolic sphere (once built), the tile/pattern editor, 49MP capture, and a desktop app.
- Motion package add-on (roughly $20): keyframe animator, autoplay, HDMI out. Mainly relevant on iPad and desktop.
- Live Perform tier: audio reactivity, MIDI input, Syphon/NDI broadcast. This tier is not fully an App Store pricing decision: Syphon and NDI broadcast can't ship inside the App Store sandbox at all, so this tier is structurally tied to the Electron/direct-download build regardless of what you charge.
- Philosophy behind Model A, in your words: "If I have a million people who hit me five bucks, that's cool." Erring toward generosity rather than treating early low-tier buyers as money left on the table.

**Model B, stricter/simpler:**
- A hard, clean split: Still-only, Motion (a clear paid upgrade), and Live Performance, each meaningfully simpler than the last and sold as more distinct products. You compared this to your own reaction to Procreate Dreams: you won't pay more for a tool you don't already trust the value of, but a good still-image experience could earn a real upgrade purchase for motion later.

**Open, unresolved:**
- How much more to charge for a generous bundled package vs. a strict tiered one; you leaned toward Model A's philosophy but didn't commit.
- Radial wedge is the single most argued-over feature-gating decision. It's the strongest "wow" moment and the reason people get hooked, but it doesn't tile and it's your highest-complexity control surface (segment fat-fingering). You went back and forth on whether that argues for including it free (maximize the hook) or gating it (protect the differentiator).
- Whether the free tier includes the iPad app at all. Your own answer in the moment was a strong "no, keep it in": "the bigger screen, being able to touch both of the pictures, that's where it's at."
- Whether the web app survives at all, since licensing can't be gated the same way there as it can through App Store purchase.

## Audience Segments Named Across Sessions

- Mass-market "wonder" app: phone-first, casual and gift use, kids and family demo territory.
- Prosumer creative tool: plugs into an existing photo/video workflow.
- Motion/animation package: the keyframe and loop tooling as a distinct upsell.
- Live performance / VJ tool: your own primary use case, technically gated outside the App Store.
- Premium commissioned-content client work: the musician-collaboration business model above, adjacent to but distinct from the software product.
- Fine-art and licensing route: gallery shows, prints, and direct licensing to partners like event producers, without necessarily selling the tool at all.
