# Blend importer: sync decompression blocks the main thread

**Created:** 2026-06-04
**Status:** Open — known limitation
**Scope:** `@threepipe/plugin-blend-importer`

## Symptom

`BlendLoadPlugin.loadAsync` calls `decompressBlend` synchronously between the network fetch and `parseBlend`. For large compressed `.blend` files (200+ MB compressed, ~1 GB decompressed) `gunzipSync` / `fzstd.decompress` block the main thread for multi-second stretches with no yield points, no `onProgress` updates, and no Worker offload.

User-visible effects:
- LoadingScreenPlugin progress bar stalls at 100% during the decode.
- Browser may show "page unresponsive" warnings.
- No way to cancel mid-decompress.

## Why sync

Both fflate `gunzipSync` and `fzstd.decompress` (top-level export) are synchronous. `fzstd` also exports a streaming `Decompress` class; fflate has async `gunzip` and a `Gunzip` streaming class. Either would let us chunk the decode and yield between chunks.

## Options

1. **Switch to streaming decode with manual yielding** — feed chunks of the compressed input into the streaming decoder, `await Promise.resolve()` every N chunks, accumulate output, then parse. Same thread but yields to the event loop.
2. **Run decompress in a Worker** — transfer the compressed ArrayBuffer into a Worker, decompress there, transfer the result back. Removes blocking entirely; adds Worker boilerplate, fzstd needs to be bundled into the worker source (or loaded via importScripts).
3. **Pair with the existing onProgress** — even without a faster decode, emit synthetic progress events at chunk boundaries so the UI reflects activity.

Option 2 is best for big files but adds the most code. Option 1 is intermediate: cheaper, still blocks the thread but in smaller chunks, lets the renderer breathe.

## Why not blocking now

Typical `.blend` files (1-50 MB compressed) decode in < 200 ms — the freeze isn't noticeable. The pain only shows up on the largest scenes. Worth fixing when the first user reports it, not before.

## References

- `plugins/blend-importer/src/decompress.ts:46` — current sync call site.
- `plugins/blend-importer/src/BlendLoadPlugin.ts:35-40` — loader hook.
- fzstd streaming: https://github.com/101arrowz/fzstd#streaming
- fflate async gunzip: https://github.com/101arrowz/fflate#asynchronous-streaming
