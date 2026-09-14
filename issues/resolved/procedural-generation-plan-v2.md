# Procedural Generation for Threepipe — Revised Plan (v2)

## What We Learned from Implementation

The building generator exercise exposed several design flaws in the v1 proposal:

**Flaw 1: `generate()` reads from `this` instead of taking params.**
The city generator had to mutate the building generator's properties before calling `generate()`. This is stateful, race-condition-prone, and breaks the "pure function" composability promise. The decorated properties should drive the UI/serialization, but the generation function itself must accept params as an argument.

**Flaw 2: Too many plugin layers.**
Five layers with three new plugin types (`ModuleLibraryPlugin`, `InstancePlacerPlugin`, `ProceduralGeneratorPlugin`) is over-engineered. Most generators don't need a categorized module library or a rule-based instancer. A cable generator just needs "extrude profile along curve." A terrain generator just needs "displace plane with noise." Making everything a plugin adds dependency overhead and forces generators into a single pattern.

**Flaw 3: `PlacementSlot` / `PlacementRule` is building-specific, not generic.**
The slot/rule pattern works for façade placement but doesn't generalize. Vegetation scattering is "distribute points on surface → instance at each point." Cable generation is "sample curve → extrude profile." Terrain is "generate grid → displace vertices." These are fundamentally different operations — a single `InstancePlacerPlugin` can't serve them all.

**Flaw 4: The attribute system was proposed but then bypassed.**
In the actual building generator, we ended up manually building `PlacementSlot[]` arrays with `attributes: { zone, floor, bay }` — never touching actual BufferGeometry face attributes. This reveals that the attribute system needs to work on *real geometry*, not on a parallel data structure that duplicates what the geometry already knows.

**Flaw 5: Missing the actual Blender GN primitives.**
Blender's power comes from a small set of *generic operations* that compose infinitely: distribute points on surface, instance on points, extrude mesh along curve, array/repeat, noise displacement, curve to mesh. Our v1 proposal jumped straight to high-level plugins without providing these fundamental operations.

---

## Revised Architecture: Two Layers, Not Five

### Layer A: `@threepipe/plugin-procedural-core` (Utilities)

A single package containing pure functions and lightweight classes. No plugins here — just importable utilities that any generator can use. This is the "geometry nodes standard library."

### Layer B: `ProceduralGeneratorPlugin` base class (in core or plugin-procedural-core)

A single abstract plugin base class that provides the lifecycle, UI, serialization, and composability patterns. Individual generators extend this. That's it — no InstancePlacerPlugin, no ModuleLibraryPlugin as mandatory dependencies.

---

## Layer A: The Procedural Utilities

These are organized by domain, all exported from `@threepipe/plugin-procedural-core`. They're pure functions operating on Three.js types — no framework coupling except optional threepipe type enhancements.

### A1. `SeededRandom`

```typescript
class SeededRandom {
    constructor(seed: number)
    next(): number                          // 0..1
    range(min: number, max: number): number
    int(min: number, max: number): number
    pick<T>(arr: T[]): T
    shuffle<T>(arr: T[]): T[]
    gaussian(mean?: number, stddev?: number): number
    // Returns a child RNG (for deterministic sub-generation)
    fork(): SeededRandom
}
```

The `fork()` method is critical. When a city generator spawns 50 building generators, each should get a forked RNG so that changing the order of generation doesn't change all the other buildings. In v1, we passed raw seed integers which doesn't guarantee independence.

### A2. `Noise`

```typescript
// Factory — returns a sampler function
function createNoise2D(seed: number): (x: number, y: number) => number
function createNoise3D(seed: number): (x: number, y: number, z: number) => number

// Layered noise (the most common usage)
function fbm(
    noise: (x: number, y: number) => number,
    x: number, y: number,
    options?: { octaves?: number, lacunarity?: number, persistence?: number, scale?: number }
): number

// Specialized noise types
function voronoiNoise(x: number, y: number, seed: number): { distance: number, cellId: number }
function ridgedNoise(noise: Function, x: number, y: number, options?: FBMOptions): number
```

### A3. `GeoAttributes` — Per-element attribute system

This is the ACTUAL attribute system that works on real `BufferGeometry`. Not a separate data structure, but helpers that read/write `BufferAttribute`s directly.

```typescript
namespace GeoAttributes {
    // Per-face attributes (stored as per-vertex with face indexing)
    function setFaceAttr(geo: BufferGeometry, name: string, values: number[]): void
    function getFaceAttr(geo: BufferGeometry, name: string): number[]
    function setFaceAttrString(geo: BufferGeometry, name: string, values: string[]): void
    function getFaceAttrString(geo: BufferGeometry, name: string): string[]

    // Per-vertex attributes
    function setVertexAttr(geo: BufferGeometry, name: string, data: Float32Array, itemSize?: number): void
    function getVertexAttr(geo: BufferGeometry, name: string): Float32Array | null

    // Compute derived attributes from geometry
    function computeFaceNormals(geo: BufferGeometry): Vector3[]
    function computeFaceCenters(geo: BufferGeometry): Vector3[]
    function computeFaceAreas(geo: BufferGeometry): number[]
    function computeVertexSlope(geo: BufferGeometry): Float32Array  // angle from up vector
    function computeVertexCurvature(geo: BufferGeometry): Float32Array

    // Selection — returns face/vertex indices matching predicate
    function selectFaces(geo: BufferGeometry, predicate: (faceIndex: number, center: Vector3, normal: Vector3, area: number) => boolean): number[]
    function selectVertices(geo: BufferGeometry, predicate: (index: number, position: Vector3) => boolean): number[]
}
```

### A4. `GeoOps` — Geometry operations

The core mesh operations that Blender GN provides. Pure functions: geometry in, geometry out.

```typescript
namespace GeoOps {
    // --- Primitives ---
    function createGrid(sizeX: number, sizeZ: number, segX: number, segZ: number): BufferGeometry
    function createExtrudedPolygon(points: [number, number][], depth: number): BufferGeometry
    function createProfileExtrude(profile: Vector2[], path: Curve3, segments?: number, closed?: boolean): BufferGeometry
    function createWallGrid(width: number, height: number, divisionsX: number, divisionsY: number): BufferGeometry

    // --- Mesh operations ---
    function subdivideFaces(geo: BufferGeometry, faceIndices: number[], cuts: number): BufferGeometry
    function extrudeFaces(geo: BufferGeometry, faceIndices: number[], amount: number): BufferGeometry
    function insetFaces(geo: BufferGeometry, faceIndices: number[], inset: number): BufferGeometry
    function booleanOp(a: BufferGeometry, b: BufferGeometry, op: 'union' | 'subtract' | 'intersect'): BufferGeometry
    function merge(...geometries: BufferGeometry[]): BufferGeometry
    function displaceVertices(geo: BufferGeometry, displaceFn: (pos: Vector3, index: number) => number, axis?: Vector3): BufferGeometry

    // --- Curve operations ---
    function sampleCurveEven(curve: Curve3, count: number): { points: Vector3[], tangents: Vector3[], normals: Vector3[], rights: Vector3[] }
    function curveToTubeMesh(curve: Curve3, radius: number, segments: number, radialSegments: number): BufferGeometry
    function curveToRibbonMesh(curve: Curve3, width: number, segments: number): BufferGeometry

    // --- Transform ---
    function applyTransform(geo: BufferGeometry, matrix: Matrix4): BufferGeometry  // in-place
    function clone(geo: BufferGeometry): BufferGeometry
}
```

### A5. `PointCloud` — The universal intermediate

This is the KEY generalization. In Blender, "Instance on Points" is the universal composition pattern. Whether you're placing windows on walls, trees on terrain, or lamps along a road — it's always:

1. Generate a set of points (with attributes)
2. Pick what to instance at each point
3. Place instances

A `PointCloud` is just an array of attributed points. It replaces `PlacementSlot[]` from v1, but it's generic and not building-specific.

```typescript
interface ProceduralPoint {
    position: Vector3
    normal: Vector3
    rotation?: Euler
    scale?: Vector3
    attrs: Record<string, number | string>  // arbitrary named attributes
}

type PointCloud = ProceduralPoint[]

namespace PointDistribute {
    // On surface
    function onSurface(geo: BufferGeometry, options: {
        density?: number,        // points per unit area
        count?: number,          // OR exact count
        method?: 'random' | 'poisson' | 'grid-jittered'
        rng: SeededRandom,
        weightAttr?: string,     // vertex attribute to use as density weight
        slopeRange?: [number, number],  // filter by slope (degrees)
        heightRange?: [number, number], // filter by Y position
    }): PointCloud

    // On grid
    function onGrid(sizeX: number, sizeZ: number, spacingX: number, spacingZ: number, options?: {
        jitter?: number,
        rng?: SeededRandom,
        maskFn?: (x: number, z: number) => boolean,
    }): PointCloud

    // Along curve
    function alongCurve(curve: Curve3, options: {
        spacing?: number,        // distance between points
        count?: number,          // OR exact count
        offset?: number,         // lateral offset from curve
        side?: 'left' | 'right' | 'both' | 'center',
    }): PointCloud

    // On wall faces (the building use case — but expressed generically)
    function onWallGrid(width: number, height: number, baysX: number, baysY: number, options?: {
        normal?: Vector3,        // which direction the wall faces
        origin?: Vector3,        // wall center position
    }): PointCloud

    // Transform/filter
    function filter(cloud: PointCloud, predicate: (pt: ProceduralPoint) => boolean): PointCloud
    function setAttr(cloud: PointCloud, name: string, fn: (pt: ProceduralPoint, index: number) => number | string): PointCloud
    function transform(cloud: PointCloud, matrix: Matrix4): PointCloud
    function jitter(cloud: PointCloud, amount: Vector3, rng: SeededRandom): PointCloud
}
```

### A6. `Instancer` — Place objects at points

Given a `PointCloud` and something to place, generate optimized `InstancedMesh` groups.

```typescript
namespace Instancer {
    // Basic: same object at every point
    function instanceAtPoints(
        cloud: PointCloud,
        source: Mesh | BufferGeometry,
        material?: Material,
        options?: {
            alignToNormal?: boolean,
            scaleRange?: [number, number],
            rotationRandomness?: number,
            rng?: SeededRandom,
        }
    ): InstancedMesh

    // Rule-based: different objects at different points
    function instanceByRules(
        cloud: PointCloud,
        rules: InstanceRule[],
        rng?: SeededRandom,
    ): Group  // contains one InstancedMesh per unique source

    interface InstanceRule {
        match: (pt: ProceduralPoint) => boolean  // which points
        sources: InstanceSource[]                 // what to place (weighted random pick)
        alignToNormal?: boolean
        scaleToAttr?: string                      // scale from a point attribute
    }

    interface InstanceSource {
        mesh: Mesh | BufferGeometry
        material?: Material
        weight?: number          // probability weight (default 1)
        scaleRange?: [number, number]
    }
}
```

Note: `InstanceRule` replaces `PlacementRule` from v1 but is simpler and fully generic. The building generator's rules now read point attributes like any other generator.

### A7. `ModuleKit` — Lightweight asset registry (NOT a plugin)

A simple `Map`-based container for reusable geometry/material pairs. Generators that need modular assets use this; generators that don't (terrain, noise effects) simply ignore it.

```typescript
class ModuleKit {
    register(category: string, id: string, entry: ModuleEntry): void
    get(category: string, id?: string): ModuleEntry
    getAll(category: string): ModuleEntry[]
    pick(category: string, rng: SeededRandom, filter?: (entry: ModuleEntry) => boolean): ModuleEntry
    loadFromGLTF(url: string, mapping: Record<string, string>): Promise<void>

    // Convenience: generate procedural modules in bulk
    static createArchitecturalKit(style: 'modern' | 'classical' | 'industrial'): ModuleKit
    static createVegetationKit(biome: 'temperate' | 'tropical' | 'arid'): ModuleKit
}

interface ModuleEntry {
    geometry: BufferGeometry
    material: Material
    meta: {
        width: number
        height: number
        depth: number
        tags?: string[]
        weight?: number
    }
}
```

Not a plugin. Just a class. A generator can create one, load one, or receive one as a parameter.

### A8. `ProceduralMaterial` — Attribute-driven materials

Utilities to create materials that blend textures based on vertex attributes (slope, height, moisture, etc). Uses threepipe's material extension system.

```typescript
namespace ProceduralMaterial {
    function createTerrainMaterial(options: {
        layers: TerrainLayer[]
        // Each layer maps a condition to a texture/color
    }): PhysicalMaterial

    interface TerrainLayer {
        color: Color
        roughness?: number
        condition: 'slope' | 'height' | 'curvature' | 'attribute'
        range: [number, number]       // min/max of the condition
        blendWidth?: number           // smooth transition width
        attributeName?: string        // for condition='attribute'
    }

    function createVertexColorMaterial(options?: {
        roughness?: number
        metalness?: number
    }): PhysicalMaterial
}
```

---

## Layer B: `ProceduralGeneratorPlugin` Base Class

### The Critical Fix: `generate()` takes params

```typescript
@uiFolder('Generator')
abstract class ProceduralGeneratorPlugin extends AViewerPluginSync {
    static readonly PluginType: string
    abstract readonly generatorType: string

    // --- Lifecycle ---
    protected _output: IObject3D | null = null

    // THE FIX: generate() takes explicit params, doesn't read from `this`
    // This makes it a pure function suitable for composition
    abstract generate(params: Record<string, any>, rng: SeededRandom): IObject3D

    // regenerate() is the UI-facing method that reads from `this`
    // and calls generate() with the current param values
    regenerate(): void {
        if (this._output) {
            this._viewer?.scene.removeObject(this._output)
            this.disposeObject(this._output)
        }
        const params = this.getParams()
        const rng = new SeededRandom(params.seed ?? 42)
        this._output = this.generate(params, rng)
        this._viewer?.scene.addObject(this._output)
        this._viewer?.setDirty()
    }

    // Collect all @serialize() properties into a params object
    getParams(): Record<string, any> {
        // framework introspects decorated properties
        return ThreeSerialization.serializeProperties(this)
    }

    // Proper disposal
    protected disposeObject(obj: IObject3D): void {
        obj.traverse(child => {
            if (child instanceof Mesh) {
                child.geometry?.dispose()
                // materials disposed only if owned (not from module kit)
            }
        })
    }
}
```

**Why this matters:** A city generator can now do:

```typescript
// Clean — no mutation of the building generator's state
const buildingMesh = buildingGen.generate({
    width: 15, depth: 12, floors: 8,
    floorHeight: 3, baysX: 5, baysZ: 4,
    roofStyle: 'flat', seed: rng.int(0, 99999),
}, rng.fork())
```

No saving/restoring state. No race conditions. No side effects. The decorated properties on the building generator plugin are *only* for the UI — they're the "default" params that `regenerate()` reads, but any code can call `generate()` directly with different params.

---

## What Changes From v1

### REMOVED

| v1 Component | Why Removed |
|---|---|
| `ModuleLibraryPlugin` (as plugin) | Replaced by `ModuleKit` class. Not everything needs to be a plugin. Generators that don't use modules shouldn't pay the cost. |
| `InstancePlacerPlugin` (as plugin) | Replaced by `Instancer` namespace of pure functions. Instancing is an operation, not a feature that needs lifecycle management. |
| `PlacementSlot` / `PlacementRule` types | Replaced by `PointCloud` + `InstanceRule`. Same idea but generic — not building-specific. |
| `GeometryAttributes` as interface | Replaced by `GeoAttributes` namespace of pure functions on BufferGeometry. |
| 5-layer architecture | Collapsed to 2 layers: utilities (functions) + generators (plugins). |
| `CSGPlugin` | Replaced by `GeoOps.booleanOp()` function. |
| `NoisePlugin` | Replaced by `createNoise2D()` / `fbm()` functions. |
| `LODGeneratorPlugin` | Deferred. Use existing `MeshOptSimplifyModifierPlugin` when needed. |
| `SnapPointSystem` | Deferred. Can be a later addition for visual editing. |
| `ProceduralMaterialPlugin` as plugin | Replaced by `ProceduralMaterial` namespace of utility functions. |

### KEPT (improved)

| v1 Component | v2 Form | What Changed |
|---|---|---|
| `SeededRandom` | `SeededRandom` class | Added `fork()`, `gaussian()`, `shuffle()` |
| Attribute system concept | `GeoAttributes` namespace | Now works on real BufferGeometry, not parallel slot arrays |
| Module library concept | `ModuleKit` class | Lighter weight, not a plugin, optional |
| Instance placement concept | `Instancer` namespace | Generic `PointCloud` input, automatic `InstancedMesh` batching |
| `ProceduralGeneratorPlugin` | Same name, fixed API | `generate(params, rng)` is now pure; `regenerate()` is the UI bridge |
| Rule-based placement | `InstanceRule` | Simplified, operates on `ProceduralPoint.attrs` |
| Geometry primitives | `GeoOps` namespace | Expanded with curve operations |

### ADDED (new)

| Component | What It Does | Why Needed |
|---|---|---|
| `PointCloud` / `ProceduralPoint` | Universal intermediate: array of attributed 3D points | This is the "Instance on Points" equivalent from Blender. It unifies buildings (points on wall grid), terrain (points on surface), roads (points along curve), scatter (random points). |
| `PointDistribute` namespace | Functions to generate PointClouds from surfaces, grids, curves | The six `PointDistribute` functions replace the manual nested loops that every generator was writing. |
| `GeoOps.displaceVertices()` | Displace mesh vertices with a function | Core terrain operation. |
| `GeoOps.createProfileExtrude()` | Extrude a 2D profile along a 3D path | Core road/pipe/cornice operation. |
| `GeoOps.curveToRibbonMesh()` | Create flat mesh along a curve | Roads, paths, rivers. |
| `SeededRandom.fork()` | Create independent child RNG | Prevents butterfly effect when composing generators. |
| `Noise.voronoiNoise()` | Cell/Voronoi noise | City block layouts, organic patterns. |
| `ProceduralMaterial.createTerrainMaterial()` | Attribute-driven material | Terrain biome rendering. |

---

## How the Building Generator Looks Now

```typescript
@uiFolder('Building Generator')
export class BuildingGenerator extends ProceduralGeneratorPlugin {
    static readonly PluginType = 'BuildingGenerator'
    readonly generatorType = 'building'

    @uiSlider('Width', [4, 30], 1)
    @serialize() @onChange(BuildingGenerator.prototype.regenerate)
    width = 12

    // ... other decorated params ...

    @uiSlider('Seed', [0, 9999], 1)
    @serialize() @onChange(BuildingGenerator.prototype.regenerate)
    seed = 42

    generate(p: BuildingParams, rng: SeededRandom): IObject3D {
        const totalH = p.floors * p.floorHeight
        const building = new Group()

        // Body
        const body = new Mesh(new BoxGeometry(p.width, totalH, p.depth), MAT.concrete())
        body.position.y = totalH / 2
        building.add(body)

        // Generate facade points using the generic PointDistribute
        const allFacePoints: PointCloud = []
        for (const face of ['front', 'back', 'left', 'right'] as const) {
            const isX = face === 'left' || face === 'right'
            const w = isX ? p.depth : p.width
            const bays = isX ? p.baysZ : p.baysX
            const sign = (face === 'front' || face === 'right') ? 1 : -1
            const normal = isX ? new Vector3(sign, 0, 0) : new Vector3(0, 0, sign)

            // ONE CALL generates a grid of attributed points on this wall
            const wallPoints = PointDistribute.onWallGrid(w, totalH, bays, p.floors, {
                normal,
                origin: isX
                    ? new Vector3(sign * p.width / 2, 0, 0)
                    : new Vector3(0, 0, sign * p.depth / 2),
            })

            // Tag each point with metadata
            PointDistribute.setAttr(wallPoints, 'zone', (pt) =>
                pt.position.y < p.floorHeight ? 'ground' : 'upper')
            PointDistribute.setAttr(wallPoints, 'facing', () => face)

            allFacePoints.push(...wallPoints)
        }

        // Instance by rules — generic, not building-specific
        const kit = ModuleKit.createArchitecturalKit('modern')
        const facades = Instancer.instanceByRules(allFacePoints, [
            {
                match: pt => pt.attrs.zone === 'ground' && pt.attrs.facing === 'front',
                sources: [{ mesh: kit.get('door').geometry, material: kit.get('door').material }],
            },
            {
                match: pt => pt.attrs.zone === 'upper',
                sources: [{ mesh: kit.get('window').geometry, material: kit.get('window').material }],
            },
        ], rng)

        building.add(facades)

        // Roof, ledges, etc...
        return building
    }
}
```

## How the City Generator Composes It (Clean)

```typescript
generate(p: CityParams, rng: SeededRandom): IObject3D {
    const city = new Group()
    const buildingGen = this._viewer!.getPlugin(BuildingGenerator)!

    // Generate block layout
    const blockPoints = PointDistribute.onGrid(
        p.gridX * p.blockSize, p.gridZ * p.blockSize,
        p.blockSize + p.streetWidth, p.blockSize + p.streetWidth,
        { maskFn: () => rng.next() < p.density, rng }
    )

    for (const pt of blockPoints) {
        const childRng = rng.fork()  // independent RNG per building

        // CLEAN: pass params directly, no state mutation
        const bldg = buildingGen.generate({
            width: childRng.range(8, p.blockSize * 0.7),
            depth: childRng.range(8, p.blockSize * 0.7),
            floors: childRng.int(p.minFloors, p.maxFloors),
            floorHeight: 3,
            baysX: 4, baysZ: 3,
            roofStyle: childRng.pick(['flat', 'gabled', 'hipped']),
            seed: childRng.int(0, 99999),
        }, childRng)

        bldg.position.copy(pt.position)
        city.add(bldg)
    }

    return city
}
```

No mutation. No state save/restore. Each building gets a forked RNG so inserting a new block doesn't change all subsequent buildings.

## How a CABLE Generator Would Look (proving generality)

```typescript
generate(p: CableParams, rng: SeededRandom): IObject3D {
    // Sample the curve
    const curvePoints = PointDistribute.alongCurve(p.path, { spacing: 0.5 })

    // Add sag via displacement
    const sagged = curvePoints.map((pt, i) => {
        const t = i / curvePoints.length
        const sag = Math.sin(t * Math.PI) * p.sagAmount
        return { ...pt, position: pt.position.clone().add(new Vector3(0, -sag, 0)) }
    })

    // Create the cable mesh by extruding a circle profile along the sagged curve
    const cable = GeoOps.curveToTubeMesh(
        new CatmullRomCurve3(sagged.map(p => p.position)),
        p.radius, sagged.length, 8
    )

    return new Mesh(cable, MAT.metal())
}
```

Same utilities (`PointDistribute.alongCurve`, `GeoOps.curveToTubeMesh`), completely different generator. No forced PlacementRule pattern.

## How a TERRAIN Generator Would Look (proving generality)

```typescript
generate(p: TerrainParams, rng: SeededRandom): IObject3D {
    const terrain = new Group()
    const noise = createNoise2D(p.seed)

    // Generate heightmap mesh
    const geo = GeoOps.createGrid(p.size, p.size, p.resolution, p.resolution)
    GeoOps.displaceVertices(geo, (pos) =>
        fbm(noise, pos.x, pos.z, { octaves: p.octaves, scale: p.noiseScale }) * p.heightScale
    )

    // Compute attributes from geometry (slope, height, curvature)
    const slopes = GeoAttributes.computeVertexSlope(geo)
    GeoAttributes.setVertexAttr(geo, 'slope', slopes)

    // Attribute-driven material
    const mat = ProceduralMaterial.createTerrainMaterial({
        layers: [
            { color: new Color(0x4a7a3b), condition: 'slope', range: [0, 25], roughness: 0.95 },
            { color: new Color(0x777770), condition: 'slope', range: [30, 90], roughness: 0.9 },
            { color: new Color(0xeeeee8), condition: 'height', range: [0.8, 1.0], roughness: 0.7 },
        ],
    })

    terrain.add(new Mesh(geo, mat))

    // Scatter trees using point distribution on the terrain surface
    const treePoints = PointDistribute.onSurface(geo, {
        density: p.treeDensity, method: 'poisson', rng,
        slopeRange: [0, 30],  // no trees on cliffs
        heightRange: [p.waterLevel + 1, p.heightScale * 0.7],  // no trees in water or on peaks
    })

    const treeKit = ModuleKit.createVegetationKit(p.biome)
    const trees = Instancer.instanceByRules(treePoints, [
        {
            match: () => true,
            sources: treeKit.getAll('tree').map(t => ({
                mesh: t.geometry, material: t.material, weight: t.meta.weight ?? 1,
            })),
            alignToNormal: true,
        },
    ], rng)

    terrain.add(trees)

    // Water plane
    if (p.waterLevel > -p.heightScale) {
        const water = new Mesh(
            new PlaneGeometry(p.size * 1.2, p.size * 1.2),
            ProceduralMaterial.createWaterMaterial()
        )
        water.rotation.x = -Math.PI / 2
        water.position.y = p.waterLevel
        terrain.add(water)
    }

    return terrain
}
```

Every operation is a generic utility call. The terrain generator doesn't know or care about buildings. But it uses the *exact same* `PointDistribute.onSurface`, `Instancer.instanceByRules`, and `GeoAttributes` that the building and city generators use.

---

## Implementation Phases (Revised)

### Phase 1: Core Utilities
- `SeededRandom` (with `fork()`)
- `Noise` (createNoise2D, fbm, voronoi)
- `GeoAttributes` (setVertexAttr, computeVertexSlope, selectFaces)
- `GeoOps` basics (createGrid, displaceVertices, merge, createProfileExtrude, curveToTubeMesh)
- `ProceduralGeneratorPlugin` base class with the pure `generate(params, rng)` pattern
- **Test:** A simple terrain generator using just these

### Phase 2: Point Distribution + Instancing
- `PointCloud` / `ProceduralPoint` types
- `PointDistribute` (onSurface, onGrid, alongCurve, onWallGrid)
- `Instancer` (instanceAtPoints, instanceByRules)
- `ModuleKit` class
- **Test:** A vegetation scatter generator and a building generator using these

### Phase 3: Advanced GeoOps
- `GeoOps.booleanOp` (via three-bvh-csg or manifold)
- `GeoOps.extrudeFaces`, `insetFaces`, `subdivideFaces`
- `GeoOps.createExtrudedPolygon`
- `ProceduralMaterial.createTerrainMaterial`
- **Test:** Advanced building generator with window cutouts, terrain with biome materials

### Phase 4: Sample Generators (as separate packages)
- `BuildingGenerator` → `@threepipe/generator-building`
- `CityGenerator` → `@threepipe/generator-city`
- `TerrainGenerator` → `@threepipe/generator-terrain`
- `RoadGenerator` → `@threepipe/generator-road`
- `VegetationScatter` → `@threepipe/generator-vegetation`
- Each is a standalone package that depends on `@threepipe/plugin-procedural-core`

### Phase 5: Community + Performance
- Documentation + generator creation guide
- Performance: WebWorker offloading for heavy generators
- Performance: LOD integration with existing `MeshOptSimplifyModifierPlugin`
- Performance: Chunked/progressive generation for city-scale scenes
- Community ModuleKit packs (architectural styles, vegetation biomes)

---

## Summary of Architectural Principles

1. **Utilities over plugins.** If it doesn't need lifecycle management, it's a function, not a plugin. Only generators are plugins.

2. **`generate(params, rng)` is pure.** No reading from `this` in the generation function. Decorated properties are for the UI; `generate()` takes explicit params. This is what makes composition clean.

3. **`PointCloud` is the universal glue.** Every placement problem (windows on walls, trees on terrain, lamps along roads, bricks on a path) is "generate points → instance at points." Standardize the point, and all generators compose.

4. **`SeededRandom.fork()` prevents butterfly effects.** When a parent generator spawns children, each gets a forked RNG. Changing one child doesn't cascade to all others.

5. **`ModuleKit` is optional.** Generators that need modular assets (buildings, cities) use it. Generators that don't (terrain, noise effects, cables) ignore it entirely. No forced dependency.

6. **Sample generators are separate packages.** The core is just utilities + base class. The building/city/terrain generators are examples that demonstrate the pattern. The real value is the utilities that let anyone build any generator.

7. **Match Blender's granularity.** Each utility function should correspond to roughly one Blender geometry node. `PointDistribute.onSurface` ≈ "Distribute Points on Faces." `Instancer.instanceAtPoints` ≈ "Instance on Points." `GeoOps.displaceVertices` ≈ "Set Position with offset." This makes it intuitive for anyone coming from the Blender GN world.
