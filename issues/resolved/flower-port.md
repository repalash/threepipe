# Flower Port — repeat_zone_flower_by_MiRA.blend

## Status: Complete

## What was done

Ported `tmp/repeat_zone_flower_by_MiRA.blend` to a proper graph-based procedural generator with bloom animation support.

### Architecture

The Blender node tree has this structure:
- **F-Rose01Anim** (top-level group) contains a Repeat Zone iterating over petal rings
- **Group.003** (GN_PetalParameters.001) — "bud" parameter set (closed flower)
- **Group.007** (GN_PetalParameters.001) — "bloom" parameter set (open flower)
- **Group.005** (GN_Animation.001) — frame-based animation controller
- **Group.019** (GN_Petal.001) — petal geometry generator (77 nodes)
- **Group.018** (GN_Flower.001) — ring assembly (Instance on Points on circle)

The web port maps this to a GraphModule with:
- **GroupInput** node with `bloom`, `iterations`, `petalsPerRing`, `circleRadius`, `verticesX`, `verticesY`
- **FlowerGenerator** node that implements the Repeat Zone loop

The `bloom` parameter (0=bud, 1=bloom) replaces Blender's frame-based Scene Time animation.

### Animation system

In Blender: `GN_Animation.001` uses `Scene Time` + `Float Curve` + per-ring delay to interpolate between `Group.003` (start) and `Group.007` (end) parameter sets over frames 1-91.

In web port: A single `bloom` parameter (0-1) linearly interpolates between the same two parameter sets. This is equivalent to the Blender animation at the evaluated frame, with the Float Curve treated as identity (the default curve points form a linear ramp).

Key detail: The `Rotation` parameter comes directly from `Group.003` (the start/bud params), not through the animation controller. This is how the Blender graph is wired — `Group.003`'s Rotation output connects directly to `Group.019`, bypassing `Group.005`.

### Files modified

- `examples/flower-demo/graph.ts` — new proper GraphModule with animation (replaces old)
- `examples/flower-demo/script.ts` — new viewer with bloom animation controls
- `examples/flower-demo/index.html` — updated title and import map

### Verification

- **Ground truth match**: 7392/7392 world-space vertices within tolerance 0.002 (maxErr=0.001391)
- **Bloom reactivity**: dist(bloom=0, bloom=1) = 0.6446 — dramatically different output
- **Iterations reactivity**: changing iterations from 8 to 4 produces correct vertex count (3696)
- **PetalsPerRing reactivity**: changing from 6 to 3 produces correct vertex count (3696)

### Ground truth files

- `/tmp/flower_port/flower_world_verts.json` — 7392 world-space vertices at full bloom
- `/tmp/flower_port/per_ring_petals.json` — per-ring petal vertices and faces
- `/tmp/flower_port/nodes.json` — extracted node graph

### Previous approach (what was wrong)

The old `FlowerGenerator` (AProceduralGenerator) was monolithic — one big `generate()` function with no graph structure and no animation. This violated the porting principles:
- No graph = no selective recompute, no auto-UI per node
- No animation = missing key feature
- Monolithic = not composable
