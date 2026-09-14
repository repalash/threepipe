# Blend importer: unknown-magic now throws, was a soft parser error

**Created:** 2026-06-04
**Status:** Open — behavior change, may need documentation or revisit
**Scope:** `@threepipe/plugin-blend-importer`

## Context

Before the compression-support change, `BlendLoadPlugin.loadAsync` passed any fetched bytes directly to `parseBlend`. If the bytes weren't a `.blend` file (no `BLENDER` magic at offset 0), `parser.js:618-619` set `ERROR = 'File supplied is not a .blend compatible Blender file.'`, `console.error`'d it, and resolved the Promise with a (mostly empty) `FILE` object. `loadAsync` then returned a nearly-empty Scene.

After the change, `decompressBlend` runs first. For any non-`BLENDER`/non-gzip/non-zstd input it throws synchronously, so `loadAsync` rejects.

## Why this matters

Callers wrapping the importer in their own error handling now see a rejection where they previously saw a resolved-but-empty Scene. Specifically:
- Tests that asserted `await viewer.load(...)` resolves on a malformed `.blend` would now need to wrap in try/catch.
- Error message text changed: `'BlendLoadPlugin: unrecognised file magic (first 4 bytes: ...)'` vs the parser's `'File supplied is not a .blend compatible Blender file.'`

## Decision

Probably the new behavior is correct — rejecting on garbage input is better than silently returning an empty Scene that's hard to diagnose downstream. But it's a behavior change worth documenting.

Action items:
- [ ] Add a note to the CHANGELOG entry for the unreleased version mentioning the rejection-on-bad-magic change.
- [ ] Audit `tests/extras.spec.ts` (only test referencing blend-load) for any assertion that depends on the old soft-error path. Currently the test only asserts `toHaveTitle`, so we're fine.

## References

- `plugins/blend-importer/src/decompress.ts:51-52` — new throw.
- `plugins/blend-importer/src/js-blend/parser/parser.js:619` — old soft-error path (still exists, but now unreachable from the plugin's loader since `decompressBlend` filters first).
