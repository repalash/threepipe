# MaterialPreviewGenerator.generate: fallback shape mesh+geometry leaked per call

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
When `generate` is called with an unknown `shape` name, it allocates a fresh `Mesh(new SphereGeometry(1))` on every call. The class's `dispose()` only disposes the predefined `this.shapes` geometries, so each fallback geometry leaks (the mesh is tracked nowhere).

## Root Cause
```ts
shapes: Record<string, Mesh> = {
    sphere: new Mesh(new SphereGeometry(1)),
    cube: new Mesh(new BoxGeometry(1, 1, 1)),
    cylinder: new Mesh(new CylinderGeometry(0.5, 0.5, 1)),
}

generate(material, renderer, environment?, shape = 'sphere'): string {
    const object = this.shapes[shape] || new Mesh(new SphereGeometry(1))   // fresh alloc on miss
    // ...
}
```

For any `shape` not in `sphere|cube|cylinder`, a new geometry is created and never disposed.

## Impact
Repeatedly generating previews with an unknown shape name grows GPU/JS memory unbounded. Low severity since the default and the documented shapes hit the cached path; only unknown shape names leak.

## Fix
Reuse a single cached fallback mesh — e.g. lazily create and store it in `this.shapes` (or a dedicated field) and dispose it in `dispose()` — instead of allocating per call.

## Files
- `src/three/utils/MaterialPreviewGenerator.ts:41` — per-call fallback `new Mesh(new SphereGeometry(1))`
