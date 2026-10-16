# The API has no lossless mesh dump, no topology measure and no claimed/collateral diff

**Found by**: building the edit-chain harness, which needs all three after every step.
**Status**: Track 1 (`track1-agent`) is adding edge listing to `inspect`, evaluated bounds, `validate`
and `diff`. This lists what the harness had to compute itself so the API can absorb it, and which parts
Track 1 does not cover.

## What the harness does instead

`demos/edit-chain/run.mjs` reads `window.modelling.document` in the page and base64s every `MeshData`
attribute layer, and `demos/edit-chain/topology.mjs` computes, from that:

| need | why the API cannot give it today | Track 1 |
| --- | --- | --- |
| a lossless mesh (positions bit-exact, edges, every attribute layer) | `inspect {detail}` rounds to 1e-5 (`commands/session.ts`, `round`), stops at 400 vertices, lists no edges (see `command-no-edge-listing.md`) and no attribute layers | edges: yes; exact values and layers: not that I know of |
| Euler characteristic, boundary loops, non-manifold / wire edges, shells, winding consistency, genus, area, volume, tris, quad share | `measure` reports world AABBs and AABB overlaps only | not covered |
| claimed vs collateral `diff(before, after)` with elements matched by position, not index | nothing; `selftest` only runs `MeshData.validate()` | `diff`: yes - check it splits by a claim, and matches by position (every topology op renumbers) |

These are the survey's §5.2 `measure(mesh)` and `diff(a, b)` (`research-ai-3d-ecosystem.md`). Once they
exist, `run.mjs` should call them instead of reading the page, and `topology.mjs` becomes their test
oracle.
