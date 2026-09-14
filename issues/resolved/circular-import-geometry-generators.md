# Circular Import: Geometry Generators → utils barrel → viewer → plugins barrel

**Created:** 2026-03-26
**Status:** Resolved
**Resolution:** Replaced barrel imports with direct file imports in `PhysicalMaterial.ts` and `iObjectCommons.ts`, removed `../plugins` barrel import from viewer.
**Discovered via:** Unit test setup (vitest)

## Problem

All geometry generators in `src/plugins/geometry/primitives/` cannot be imported in isolation due to a circular dependency chain:

```
BoxGeometryGenerator
  → AGeometryGenerator (imports PhysicalMaterial for default factory)
    → PhysicalMaterial (imports from ../../utils barrel)
      → src/utils/index.ts (re-exports ViewerTimeline)
        → ViewerTimeline (imports from ../viewer)
          → src/viewer/index.ts (imports from ../plugins)
            → src/plugins/index.ts:88 (imports GeometryGeneratorPlugin)
              → GeometryGeneratorPlugin (imports TorusGeometryGenerator etc.)
                → TorusGeometryGenerator extends AGeometryGenerator (CIRCULAR - undefined)
```

## Impact

- Geometry generator unit tests cannot run (all 24 tests skip)
- May cause subtle issues with code splitting / tree-shaking

## Potential Fixes

1. **Break the utils barrel cycle**: `ViewerTimeline` and `objectProcessor` import `../viewer` and `../plugins`. Move them out of `src/utils/index.ts` or use lazy imports.
2. **Lazy imports in AGeometryGenerator**: The `defaultMeshClass`/`defaultMaterialClass` factories could use lazy `import()` instead of static imports.
3. **Split GeometryGeneratorPlugin imports**: Don't import all generators eagerly in `GeometryGeneratorPlugin` — use dynamic registration.

Option 1 seems like the cleanest fix with least disruption.
