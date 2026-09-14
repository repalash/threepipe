# Filmic/Chromatic/Vignette priority audit — likely wrong-side-of-tonemap (same pattern as LUT)

## Summary

`FilmicGrainPlugin`, `ChromaticAberrationPlugin`, and `VignettePlugin` all have `priority = -50` while `TonemapPlugin` is `-100`. With the screen-pass extender's prepend-at-`#glMarker` semantics, **higher priority is applied first → executes earlier → its output feeds tonemap**. So today these three operate in linear pre-tonemap colour space.

This is the same pattern that was wrong for `LUTPlugin` until yesterday's fix (priority `-50` → `-150`, so LUT operates on display-space post-tonemap colour, matching webgi).

## Files

- `src/plugins/postprocessing/FilmicGrainPlugin.ts:41` — `priority = -50`
- `src/plugins/postprocessing/ChromaticAberrationPlugin.ts:35` — `priority = -50`
- `src/plugins/postprocessing/VignettePlugin.ts:43` — `priority = -50`
- `src/plugins/postprocessing/TonemapPlugin.ts:99` — `priority = -100` (anchor)
- `src/plugins/postprocessing/LUTPlugin.ts:117` — `priority = -150` (already correct, after tonemap)

## Why this is research, not a same-day fix

webgi's `FilmicGrainPlugin`/`ChromaticAberrationPlugin`/`VignettePlugin` don't have a `priority` field at all — webgi orders post extensions by registration order in `CombinedPostPlugin.addExtension`. So determining "what webgi actually does" requires inspecting the registration order at runtime in a webgi build, not just reading source.

Threepipe's `AScreenPassExtensionPlugin` sorts by `priority`. So picking the right number requires either:
1. Side-by-side render comparison (like `tests/lut-render-comparison.spec.ts` did for LUT), OR
2. Inspecting webgi's runtime extension order to mirror it.

## Suggested verification path

Use the same `2rings.glb` fixture + tweakpane-editor harness:

1. With **filmic grain ON** (high noise factor) — capture threepipe vs webgi.
2. **Chromatic aberration ON** (visible offset) — capture both.
3. **Vignette ON** (heavy darkening) — capture both.

Compare. If threepipe's bg/midtones differ from webgi's by more than tolerance and the difference looks like "linear-space grain vs display-space grain" (i.e. grain pattern strength varies dramatically with tonemap), the priority is wrong.

## Likely correct values

By analogy with LUT:
- `FilmicGrain`: probably `-150` (after tonemap — grain is a final-image artifact)
- `ChromaticAberration`: probably `-150` or `-200` (display-space chromatic)
- `Vignette`: probably `-150` (final-image darkening)

But this is **only a hypothesis** — needs the side-by-side test to confirm.

## Severity

Medium — produces wrong-looking output relative to webgi, but each plugin defaults disabled. Visible only when users enable them and care about webgi parity.

## Related

- `tests/lut-render-comparison.spec.ts` — same-pattern fix for `LUTPlugin`.
- `working_stream.md` "Side issues — still open" entry that called this out during LUT work.
