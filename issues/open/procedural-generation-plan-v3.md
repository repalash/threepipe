# Procedural Generation for Threepipe — v3 Plan

## What This Research Uncovered

The v2 plan was designed from theory. This v3 is designed from **actual patterns** observed across dozens of Blender generators, Blender 5.0 architecture documentation, and real-world erosion/scattering algorithms.

### The Three Universal Patterns in Blender GN

After studying Buildify, ICity, Julien Gauthier's building system, World Blender, Geo-Scatter, Terrain Nodes, and the Blender 5.0 release notes, every single generator reduces to **three core patterns** used in different combinations:

**Pattern 1: Face Classification** — Read a mesh's face properties (normal direction, area, material index, slope, edge crease value) to classify each face into a role. This is the entry point for ALL building generators.

**Pattern 2: Distribute → Instance** — Generate points on geometry (via surface distribution, grid, curve sampling) then instance objects at those points. This is the actual "everything node" — used for windows, trees, lamps, crowds, bricks, tiles, drops, everything.

**Pattern 3: Displace → Derive** — Displace vertex positions (via noise, erosion, curves) then derive new attributes from the result (slope, curvature, flow maps). This is the terrain/organic pattern.

Every Blender generator is a composition of these three. A city generator uses Pattern 1 (classify block faces as building/road/park), Pattern 2 (instance buildings, trees, lamps), and may use Pattern 3 (terrain displacement under the city). Our framework must make these three patterns first-class.

---

## The Actual Rules People Use

### Building Generators (Buildify, Coan's PBG, Gauthier's system)

The real face classification rules used in Blender building generators:

```
FACE IS ROOF:     dot(face_normal, UP) > 0.7
FACE IS FLOOR:    dot(face_normal, DOWN) > 0.7
FACE IS WALL:     abs(dot(face_normal, UP)) < 0.3
WALL FACES NORTH: dot(face_normal, (0,0,-1)) > 0.7
WALL FACES EAST:  dot(face_normal, (1,0,0)) > 0.7
...etc

FACE IS GROUND FLOOR: face_center.y < floorHeight
FACE IS TOP FLOOR:    face_center.y > totalHeight - floorHeight

FACE IS SMALL:  face_area < threshold_small  → use small detail kit
FACE IS MEDIUM: face_area < threshold_medium → use medium detail kit
FACE IS LARGE:  face_area >= threshold_medium → use large detail kit

EDGE HAS CREASE:     edge_crease > 0.5 → place pillar/column
FACE HAS MATERIAL X: material_index == X → place specific module
FACE SLOPE:          acos(dot(normal, UP)) → determines roof tile angle
```

Buildify specifically:
- 3 node groups: **walls**, **flat roof**, **wall props**
- Walls node reads face size → picks small/medium/large detail collection
- Wall props turns walls into a point cloud → scatters props
- Roof is separate → flat roof with parapet generation
- Users control style by **swapping the module collections**

Gauthier's system:
- **Shader/material assignment** controls face roles (material index drives which module appears)
- **Edge crease values** control pillar placement
- **Face inclination** (slope from horizontal) drives roof tile angle

Coan's Procedural Building Generator:
- Works on **any mesh** — doesn't require box shapes
- Finds face width/height by analyzing rectangular-ish faces
- Workarounds for missing face-size information in pure geometry nodes

### Scattering (Geo-Scatter, Botaniq, all vegetation)

The actual node chain:
```
Distribute Points on Faces
  → density controlled by vertex group OR noise texture
  → method: Random or Poisson Disk (with min distance)
  → selection: filter by face normal (dot with UP > threshold for "not cliff")
  
→ Instance on Points
  → source: Collection with Pick Instance + Separate Children
  → rotation: Random Value node on Z axis (0 to 2π)
  → scale: Random Value node (min_scale to max_scale)
  → optional: Align to Normal for slope-following

→ Join Geometry (original mesh + instances)
```

Key details people use:
- **Noise texture as density mask** — plug Noise Texture color into density factor for organic clustering
- **Vertex group painting** — hand-paint where things should/shouldn't grow
- **Normal filtering** — `dot(normal, UP) > 0.5` = "not too steep" = allow vegetation
- **Height filtering** — `position.y > water_level AND position.y < snow_line`
- **Poisson Disk minimum distance** — derived from object bounding box to prevent overlap
- **Stable IDs** — Distribute Points outputs stable IDs so that changing density doesn't reshuffle all existing instances
- **Per-instance attributes** — capture random color/ID per instance, pass to shader for variation

### Terrain (World Blender, Terrain Nodes)

The actual pipeline:
```
1. Base shape: Grid or subdivided plane
2. Displacement: FBM noise → Set Position (Y offset)
3. Erosion: Simulation Zone with particle-based hydraulic erosion
4. Attribute computation: slope, height, curvature, flow map, sediment map
5. Material: Attributes drive texture blending (steep→rock, flat→grass, low→sand)
6. Scattering: Distribute on surface filtered by attributes
```

The actual erosion algorithm (particle-based, used in most real implementations):
```
For each droplet:
  1. Spawn at random position
  2. Set: velocity=0, sediment=0, water=initial_amount
  3. Loop until water < threshold OR max_steps:
     a. Get surface normal at current position (bilinear interpolated)
     b. If surface is nearly flat (normal.y > 0.99): stop
     c. Calculate deposit = sediment * deposition_rate * normal.y
        (flatter surface = more deposition)
     d. Calculate erosion = erosion_rate * (1 - normal.y) * min(1, step * scale)
        (steeper surface = more erosion)
     e. Modify heightmap at OLD position: height -= (deposit - erosion)
        (erode behind the droplet, not under it — prevents hole-digging)
     f. Update sediment: sediment += (erosion - deposit)
     g. Update velocity: velocity += normal.xz * gravity
        velocity *= (1 - friction)
     h. Normalize velocity, move position by 1 unit in velocity direction
     i. Evaporate: water *= (1 - evaporation_rate)
```

Key outputs from erosion (used for texturing):
- **Flow map** — where water traveled (for river/stream placement)
- **Sediment/dirt map** — where material was deposited
- **Erosion depth map** — how much material was removed
- **Moisture map** — accumulated water presence

### Blender 5.0 Architecture Patterns (new)

Three new "zone" types that are critical for advanced generators:

**For Each Element Zone** (Blender 4.3):
- Process each face/vertex/edge independently
- "Generate a unique building on every face"
- "Create a distinct tree at every point"
- This is how city generators work: iterate over block faces, run building generation per face

**Repeat Zone** (Blender 4.0):
- Run a set of nodes N times
- Used for: L-systems, recursive subdivision, iterative refinement
- Replaces long repetitive node chains

**Closures** (Blender 5.0):
- Pass custom logic INTO a node group
- Example: terrain generator accepts a user-defined closure for tree distribution
- This is **the key to extensibility** — generators become customizable without modifying their internals

**Bundles** (Blender 5.0):
- Package multiple values into one socket
- Used for physics worlds, complex data passing

---

## v3 Architecture

### Core Insight: Model After Blender's Actual Nodes

v1 tried to invent new abstractions. v2 simplified but was still too theoretical. v3 directly mirrors Blender's actual node vocabulary, because:
1. People coming from Blender will recognize the patterns immediately
2. Blender tutorials and breakdowns become directly translatable
3. The patterns are battle-tested across thousands of real projects

### Package: `@threepipe/plugin-procedural-core`

#### 1. Primitives (maps to Blender's Mesh Primitives category)

```typescript
namespace PrimGen {
    grid(sizeX, sizeZ, vertsX, vertsZ): BufferGeometry
    extrudedPolygon(points: [number, number][], depth: number): BufferGeometry
    profileExtrude(profile: Vector2[], path: Curve3, segments: number): BufferGeometry
    wallGrid(width, height, baysX, baysY): BufferGeometry  // subdivided quad
}
```

#### 2. Face Classifier (maps to Blender's Normal node + Compare + Separate Geometry)

This is the #1 missing abstraction. In Blender, people use `dot(normal, direction)` comparisons everywhere. We provide it as a first-class utility.

```typescript
namespace FaceClassifier {
    // The core function — classifies every face in a geometry
    classify(
        geo: BufferGeometry,
        rules: ClassificationRule[]
    ): FaceClassification

    interface ClassificationRule {
        name: string          // e.g., "roof", "wall_north", "floor", "ground_floor_wall"
        condition: (face: FaceInfo) => boolean
        priority?: number     // higher priority wins when multiple rules match
    }

    interface FaceInfo {
        index: number
        normal: Vector3
        center: Vector3
        area: number
        materialIndex: number
        // Derived helpers (precomputed)
        slopeAngle: number        // angle from UP in degrees
        facingDirection: 'up' | 'down' | 'north' | 'south' | 'east' | 'west'
        floorIndex: number        // computed from center.y / floorHeight
        isEdgeFace: boolean       // face has a boundary edge (non-manifold)
    }

    interface FaceClassification {
        labels: string[]           // per-face label array
        groups: Map<string, number[]>  // label → face indices
        faceInfos: FaceInfo[]      // computed info for all faces
    }

    // Prebuilt rule sets for common use cases
    const BUILDING_RULES: ClassificationRule[]  // roof/wall/floor by normal direction
    const TERRAIN_RULES: ClassificationRule[]   // cliff/slope/flat by slope angle
}
```

**Why this matters:** In Blender, classifying faces is done by chaining Normal → Dot Product → Compare → Separate Geometry nodes. It's 4–6 nodes per classification. Every single building generator does this. By making it one function call with declarative rules, we eliminate the most common boilerplate.

The prebuilt `BUILDING_RULES` encode the actual rules observed in Buildify/Gauthier:

```typescript
const BUILDING_RULES: ClassificationRule[] = [
    { name: 'roof',       condition: f => f.slopeAngle < 20, priority: 10 },
    { name: 'floor',      condition: f => f.normal.y < -0.7, priority: 10 },
    { name: 'wall_north', condition: f => f.facingDirection === 'north' && f.slopeAngle > 70 },
    { name: 'wall_south', condition: f => f.facingDirection === 'south' && f.slopeAngle > 70 },
    { name: 'wall_east',  condition: f => f.facingDirection === 'east'  && f.slopeAngle > 70 },
    { name: 'wall_west',  condition: f => f.facingDirection === 'west'  && f.slopeAngle > 70 },
    { name: 'wall',       condition: f => f.slopeAngle > 70, priority: -1 },  // fallback
]
```

#### 3. Point Distribution (maps to Blender's Distribute Points on Faces + related)

```typescript
namespace Distribute {
    // THE core function — matches Blender's "Distribute Points on Faces" exactly
    onFaces(
        geo: BufferGeometry,
        options: {
            method: 'random' | 'poisson',
            density?: number,           // points per unit area
            count?: number,             // OR exact count
            minDistance?: number,        // for poisson disk
            selection?: (face: FaceInfo) => boolean,  // which faces
            densityField?: (position: Vector3) => number,  // noise-driven density
            seed: number,
        }
    ): PointCloud

    // Generate points on a grid (for city blocks, arrays, LED panels)
    onGrid(
        sizeX: number, sizeZ: number,
        spacingX: number, spacingZ: number,
        options?: {
            jitter?: number,
            mask?: (x: number, z: number) => boolean,
            seed?: number,
        }
    ): PointCloud

    // Generate points along a curve (roads, fences, cables, pipes)
    alongCurve(
        curve: Curve3,
        options: {
            spacing?: number,
            count?: number,
            offset?: number,        // lateral offset
            side?: 'left' | 'right' | 'both' | 'center',
        }
    ): PointCloud

    // Generate points on a wall grid (building facades — the Buildify pattern)
    onWallGrid(
        width: number, height: number,
        baysX: number, baysY: number,
        options: {
            origin: Vector3,
            normal: Vector3,
            floorHeight?: number,   // auto-computes floor index per point
        }
    ): PointCloud

    // Transform / filter (chainable)
    filter(cloud: PointCloud, pred: (pt: ProcPoint) => boolean): PointCloud
    tag(cloud: PointCloud, name: string, fn: (pt: ProcPoint, i: number) => any): PointCloud
    jitter(cloud: PointCloud, amount: Vector3, rng: SeededRandom): PointCloud
    transform(cloud: PointCloud, matrix: Matrix4): PointCloud
    merge(...clouds: PointCloud[]): PointCloud
}
```

#### 4. Instancing (maps to Blender's "Instance on Points")

```typescript
namespace Instance {
    // Simple: same mesh at every point (with random variation)
    atPoints(
        cloud: PointCloud,
        source: { geometry: BufferGeometry, material: Material },
        options?: {
            alignToNormal?: boolean,
            randomRotationY?: boolean,      // most common: random yaw
            scaleRange?: [number, number],
            seed?: number,
        }
    ): InstancedMesh

    // Collection pick: randomly choose from multiple sources per point
    // Maps to Blender's Collection Info + Pick Instance
    pickFromCollection(
        cloud: PointCloud,
        sources: Array<{
            geometry: BufferGeometry,
            material: Material,
            weight?: number,   // probability weight
        }>,
        options?: {
            alignToNormal?: boolean,
            randomRotationY?: boolean,
            scaleRange?: [number, number],
            seed?: number,
        }
    ): Group  // one InstancedMesh per unique source

    // Rule-based: different sources for different point attributes
    byRules(
        cloud: PointCloud,
        rules: Array<{
            match: (pt: ProcPoint) => boolean,
            sources: Array<{ geometry: BufferGeometry, material: Material, weight?: number }>,
            alignToNormal?: boolean,
            scaleToFit?: { width: string, height: string },  // attr names for target size
        }>,
        seed?: number,
    ): Group
}
```

#### 5. Displacement & Terrain Ops (maps to Blender's Set Position + Simulation Zone)

```typescript
namespace Displace {
    // Noise-based displacement (the most common terrain operation)
    withNoise(
        geo: BufferGeometry,
        options: {
            noise: (x: number, z: number) => number,  // user provides noise function
            scale: number,       // height multiplier
            axis?: Vector3,      // default: UP
        }
    ): BufferGeometry

    // Particle-based hydraulic erosion
    // Implements the actual algorithm from research (particle droplet method)
    erode(
        heightmap: Float32Array,
        width: number, height: number,
        options: {
            droplets: number,        // default 50000
            maxSteps: number,        // default 64 per droplet
            erosionRate: number,     // default 0.05
            depositionRate: number,  // default 0.02
            sedimentCapacity: number,// default 4.0
            gravity: number,         // default 4.0
            friction: number,        // default 0.01
            evaporationRate: number, // default 0.01
            seed: number,
        }
    ): {
        heightmap: Float32Array,    // eroded heightmap
        flowMap: Float32Array,      // where water traveled
        sedimentMap: Float32Array,  // where material deposited
        erosionMap: Float32Array,   // how much removed per cell
    }

    // Apply erosion result back to geometry
    applyHeightmap(geo: BufferGeometry, heightmap: Float32Array): void
}

namespace DerivedAttributes {
    // Compute per-vertex slope (angle from UP) — THE terrain classification attribute
    slope(geo: BufferGeometry): Float32Array

    // Compute per-vertex curvature (concavity/convexity)
    curvature(geo: BufferGeometry): Float32Array

    // Compute normalized height (0=lowest, 1=highest)
    normalizedHeight(geo: BufferGeometry): Float32Array

    // Store as named BufferAttribute
    store(geo: BufferGeometry, name: string, data: Float32Array, itemSize?: number): void

    // Read a stored attribute
    read(geo: BufferGeometry, name: string): Float32Array | null
}
```

#### 6. Mesh Operations (maps to Blender's mesh operation nodes)

```typescript
namespace MeshOps {
    extrudeFaces(geo: BufferGeometry, selection: number[], amount: number): {
        geometry: BufferGeometry,
        topFaces: number[],      // matches Blender's "Top" output
        sideFaces: number[],     // matches Blender's "Side" output
    }

    boolean(a: BufferGeometry, b: BufferGeometry, op: 'union' | 'subtract' | 'intersect'): BufferGeometry
    merge(...geos: BufferGeometry[]): BufferGeometry
    curveToMesh(curve: Curve3, profile?: Curve, segments?: number): BufferGeometry
    setMaterial(geo: BufferGeometry, material: Material, selection?: number[]): void  // per-face material
}
```

#### 7. Noise (maps to Blender's Texture nodes)

```typescript
namespace Noise {
    perlin2D(seed: number): (x: number, y: number) => number
    perlin3D(seed: number): (x: number, y: number, z: number) => number
    voronoi2D(seed: number): (x: number, y: number) => { distance: number, cellId: number }

    // FBM — the most-used noise in ALL generators
    fbm(
        noiseFn: (x: number, y: number) => number,
        x: number, y: number,
        options?: { octaves?: number, lacunarity?: number, persistence?: number, scale?: number }
    ): number

    // Ridged FBM — for mountains
    ridged(noiseFn: Function, x: number, y: number, options?: FBMOptions): number
}
```

#### 8. SeededRandom (utility)

```typescript
class SeededRandom {
    constructor(seed: number)
    next(): number
    range(min: number, max: number): number
    int(min: number, max: number): number
    pick<T>(arr: T[]): T
    shuffle<T>(arr: T[]): T[]
    gaussian(mean?: number, stddev?: number): number
    fork(): SeededRandom   // independent child — CRITICAL for composition
}
```

#### 9. ModuleKit (optional asset container)

```typescript
class ModuleKit {
    add(category: string, id: string, geo: BufferGeometry, mat: Material, meta?: ModuleMeta): void
    get(category: string, id?: string): ModuleEntry
    getAll(category: string): ModuleEntry[]
    pick(category: string, rng: SeededRandom): ModuleEntry

    // Size-based selection — matches Buildify's small/medium/large pattern
    pickBySize(category: string, targetArea: number, rng: SeededRandom): ModuleEntry

    static async fromGLTF(url: string, mapping: Record<string, string>): Promise<ModuleKit>
    static createArchKit(style: 'modern' | 'classical' | 'industrial'): ModuleKit
    static createVegKit(biome: 'temperate' | 'tropical' | 'arid'): ModuleKit
}
```

#### 10. ProceduralGeneratorPlugin (base class — unchanged from v2)

```typescript
abstract class ProceduralGeneratorPlugin extends AViewerPluginSync {
    abstract generate(params: Record<string, any>, rng: SeededRandom): IObject3D
    regenerate(): void   // reads decorated props, calls generate()
    getParams(): Record<string, any>
}
```

#### 11. For-Each & Closures (maps to Blender 5.0's zones — NEW)

These are the patterns that make generators truly composable and extensible.

```typescript
// For-Each Element — process each face/point independently
// Maps to Blender 5.0's "For Each Geometry Element Zone"
namespace ForEach {
    // Run a function for each classified face group, collect results
    perFaceGroup(
        classification: FaceClassification,
        fn: (label: string, faceIndices: number[], faceInfos: FaceInfo[]) => IObject3D | null
    ): Group

    // Run a function for each point in a cloud, collect results
    perPoint(
        cloud: PointCloud,
        fn: (pt: ProcPoint, index: number, rng: SeededRandom) => IObject3D | null,
        seed?: number,
    ): Group
}

// Closure pattern — pass custom logic INTO a generator
// Maps to Blender 5.0's Closures
// Example: terrain generator accepts user-defined tree distribution logic
type DistributionClosure = (geo: BufferGeometry, rng: SeededRandom) => PointCloud
type MaterialClosure = (faceInfo: FaceInfo) => Material
type ModulePickerClosure = (pt: ProcPoint, rng: SeededRandom) => ModuleEntry
```

This is how a terrain generator becomes extensible without modification:

```typescript
// User defines custom tree distribution
const myTreeDistribution: DistributionClosure = (geo, rng) => {
    const slope = DerivedAttributes.slope(geo)
    return Distribute.onFaces(geo, {
        method: 'poisson', minDistance: 3, seed: rng.int(0, 99999),
        selection: (face) => slope[face.index] < 30,  // no trees on cliffs
        densityField: (pos) => Noise.fbm(noise, pos.x, pos.z, { scale: 0.05 }),
    })
}

// Pass it into the terrain generator
terrainGen.generate({
    ...baseParams,
    vegetationDistribution: myTreeDistribution,  // closure!
}, rng)
```

---

## Changes from v2

### ADDED in v3

| Component | Why |
|---|---|
| `FaceClassifier` with prebuilt rule sets | THE missing abstraction. Every building generator starts with face classification. Making it declarative + providing building/terrain presets eliminates 80% of the boilerplate. |
| `FaceInfo.facingDirection` / `.floorIndex` / `.isEdgeFace` | These are the actual derived properties people compute in every building generator. Pre-computing them saves users from rediscovering the `dot(normal, direction)` trick. |
| `ModuleKit.pickBySize()` | Directly mirrors Buildify's "polygon size → small/medium/large detail" pattern. |
| `Displace.erode()` with full particle algorithm | Actual hydraulic erosion, not a placeholder. Returns flow/sediment/erosion maps as real data. |
| `ForEach.perFaceGroup()` / `.perPoint()` | Maps to Blender 5.0's For Each Element Zone. This is how city generators iterate over block faces. |
| Closure types (`DistributionClosure`, `MaterialClosure`, `ModulePickerClosure`) | Maps to Blender 5.0 Closures. Makes generators extensible without modification. A terrain generator can accept a user-defined vegetation distribution function. |
| `MeshOps.extrudeFaces()` returning `topFaces` + `sideFaces` | Matches Blender's Extrude Mesh node outputs exactly. The Top/Side split is how buildings assign different materials to extruded walls vs roofs. |
| `BUILDING_RULES` / `TERRAIN_RULES` presets | The actual rules observed in real Blender generators, encoded as reusable presets. |

### CHANGED from v2

| v2 | v3 | Why |
|---|---|---|
| `PointDistribute.onSurface()` | `Distribute.onFaces()` | Matches Blender's actual node name. People searching docs will find it. |
| `Instancer.instanceByRules()` | `Instance.byRules()` | Shortened namespace, clearer API. |
| `GeoAttributes` namespace | Split into `DerivedAttributes` + `FaceClassifier` | The attribute system was too generic. In practice, people compute specific things (slope, curvature, face direction). Making these explicit is better than a generic "set attribute" function. |
| `GeoOps` namespace | Split into `MeshOps` + `Displace` + `PrimGen` | Too many different operations in one namespace. Splitting by domain (mesh surgery vs displacement vs primitives) is clearer. |
| Generic `PointCloud` operations | `Distribute.filter()`, `Distribute.tag()`, etc. | Keep operations in the namespace that creates the data, for discoverability. |

### REMOVED from v2

| Component | Why |
|---|---|
| `GeoAttributes.setFaceAttr()` / `.getFaceAttr()` raw functions | Too low-level. Users don't want to manage BufferAttributes manually. `FaceClassifier` and `DerivedAttributes` provide the high-level operations people actually need. The raw functions still exist internally. |
| `ProceduralMaterial` namespace | Deferred to Phase 5. Material extension is threepipe-specific and complex. Vertex colors + basic `MeshStandardMaterial` cover 90% of cases. |
| `GeoOps.insetFaces()` / `.subdivideFaces()` | Deferred. These are rarely used in practice — most generators instance modules onto faces rather than subdividing the base mesh. Can add later if needed. |

---

## Revised Implementation Phases

### Phase 1: Core (Ship the universal patterns)
- `SeededRandom` with `fork()`
- `Noise` (perlin2D, fbm, ridged, voronoi)
- `FaceClassifier` with `BUILDING_RULES` and `TERRAIN_RULES`
- `Distribute` (onFaces, onGrid, alongCurve, onWallGrid, filter, tag)
- `Instance` (atPoints, pickFromCollection, byRules)
- `PrimGen` (grid, extrudedPolygon, wallGrid)
- `ProceduralGeneratorPlugin` base class
- **Test:** Vegetation scatter generator using Distribute.onFaces + Instance.pickFromCollection

### Phase 2: Displacement & Terrain
- `Displace` (withNoise, erode with full particle algorithm, applyHeightmap)
- `DerivedAttributes` (slope, curvature, normalizedHeight, store, read)
- `MeshOps` (extrudeFaces with Top/Side, merge, curveToMesh)
- **Test:** Terrain generator with erosion, slope-based coloring, tree scatter

### Phase 3: Building System
- `ModuleKit` with `pickBySize()`
- `ForEach` (perFaceGroup, perPoint)
- `Distribute.onWallGrid` refined
- `MeshOps.boolean`, `MeshOps.setMaterial`
- Prebuilt module kits (modern, classical, industrial)
- **Test:** Building generator using FaceClassifier + wall grid distribution + module instancing

### Phase 4: Sample Generators (separate packages)
- `@threepipe/generator-building`
- `@threepipe/generator-city` (uses ForEach.perFaceGroup to iterate blocks)
- `@threepipe/generator-terrain` (erosion + vegetation scatter)
- `@threepipe/generator-road` (Distribute.alongCurve + Instance)
- `@threepipe/generator-vegetation` (Distribute.onFaces + Instance.pickFromCollection)

### Phase 5: Extensibility & Polish
- Closure types for generator customization
- ProceduralMaterial (attribute-driven terrain shading via material extensions)
- WebWorker offloading for erosion and heavy distribution
- LOD integration
- Documentation: "Translating Blender GN tutorials to threepipe" guide
- Community module kit marketplace/format

---

## Design Principles (final)

1. **Mirror Blender's vocabulary.** `Distribute.onFaces` not `PointDistribute.onSurface`. `Instance.atPoints` not `Instancer.place`. People should be able to read a Blender GN tutorial and mentally translate it to our API.

2. **Face Classification is first-class.** Not a utility buried in a namespace — it's the entry point for all architectural generators and most terrain generators. Provide prebuilt rule sets.

3. **Three patterns, composed.** Face Classify → Distribute → Instance. Every generator is a composition of these. If our framework makes each pattern easy, ANY generator becomes possible.

4. **Closures for extensibility.** Generators accept functions as parameters (distribution closures, material closures, module picker closures). This mirrors Blender 5.0's breakthrough and prevents generators from becoming rigid.

5. **`generate(params, rng)` is pure.** No state. No side effects. Composable.

6. **`SeededRandom.fork()` for independence.** Every sub-generator gets a forked RNG.

7. **Size-aware module selection.** Match Buildify's face-area-to-detail-level pattern. `ModuleKit.pickBySize()` is the function that makes swappable architectural styles actually work.
