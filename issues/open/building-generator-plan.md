# Production-Quality Procedural Building Generator Plan

## Research Log

1. **Cloned reference repos** to `.repos/`:
   - `threejs-procedural-building-generator` (Aljullu) -- thesis project, texture-based facades, loads Collada window meshes, old THREE.Geometry API. Useful for: floor shape variety, window placement spacing algorithm, roof object scattering.
   - `threex-proceduralcity` (jeromeetienne/mrdoob) -- mass city generation, single cube per building, procedural window texture on canvas. Useful for: city-scale composition approach, vertex color ambient occlusion trick.
   - `city-generator` (MHillier98) -- similar approach to threex, adds road layout.

2. **Studied Houdini Labs Building Generator 4.0** (SideFX docs):
   - Analyzes incoming building volumes, slices into floors, identifies structural regions (walls, corners, ledges), replaces with high-resolution modules from a user-defined library.
   - Module types: **Wall**, **Corner** (convex/concave), **Top Ledge**, **Bottom Ledge**, **Sideslop** (gap filler between wall and corner).
   - **Facade Pattern Syntax**: `<A>` = repeat to fill, `[A]` = place once, `[A]3` = place 3 times, `<A-B>` = alternate A/B to fill. Patterns define how modules fill one side of one floor.
   - Per-floor height overrides, seed for randomization, simple ledges toggle (extruded vs. module-based).

3. **Studied Houdini "Building from Patterns" node**:
   - Takes Floor Descriptions from utility nodes. Pattern syntax: `<F>` fills, `[F]` rigid. Supports ray-cast overwrite patterns for hand-placed hero facades.

4. **Studied Buildify 1.0** (Pavel Oliva):
   - Modular geometry nodes library. Two modes: ADE (art-directable editor) and BLOSM (Blender-OSM integration).
   - Users place models into named collections (wall, window, door, etc.) and link collections into the node graph.
   - Buildings auto-generated through face extrusion and module copy-paste. Kit-based: different module kits = different architectural styles.

5. **Studied Coan's PBG 2** (Procedural Building Generator):
   - 9 modular node groups. Adapts to arbitrary input mesh (not just box). Different styles on top/bottom floors.
   - Drag-and-drop presets from Asset Browser.

6. **Studied CityEngine Facade Wizard**:
   - Split-grammar approach: Y-split (ground/upper/roof), X-split (bays), then repetitive splits for module grid.
   - Z-adjustment for window depth recession. Reference image extraction for texturing.

7. **Read existing implementation** at `plugins/procedural-generation/src/generators/BuildingGenerator.ts`:
   - Already has: wall-module assembly (4 boxes framing each opening + glass + frame + sill), 4 walls, floor ledges, 3 roof types (flat/gabled/hipped), 3 styles, geometry merging per material, seed-based color variation.
   - Missing: modular facade system, corner treatments, cornice/string course details, mansard/parapet roof types, door module differentiation, material variation per floor, style presets with real architectural character, city composition.

8. **Read Blender comparison** at `issues/open/procedural-generation-blender-comparison.md`:
   - Relevant findings: MeshOps.extrudeFaces (needed for extrusion-based building), FaceClassifier (wall/roof/floor tagging), mergeByDistance, realizeInstances, selection masking.

---

## A) What a Production-Quality Building Generator Needs

Based on Buildify, PBG, Houdini Labs Building Generator, CityEngine, and the Wonka et al. "Procedural Modeling of Buildings" paper:

### A.1 Modular Facade System

The fundamental principle (shared by ALL professional tools): a wall is never a single flat plane with holes cut in it. Instead, each wall is a **grid of bays (columns) x floors (rows)**, and each cell is filled with a **module** -- a small assembly of geometry pieces.

```
Wall = Grid of Cells
Each Cell = Module (a preset geometry assembly)

   bay0    bay1    bay2    bay3
  +--------+--------+--------+--------+  <- floor 3 (top)
  | window | window | window | window |
  +--------+--------+--------+--------+  <- ledge/string course
  | window | window | window | window |
  +--------+--------+--------+--------+  <- ledge/string course
  | window | window | window | window |
  +--------+--------+--------+--------+  <- ledge/string course (ground floor separator)
  |  door  | window |  door  | window |  <- ground floor (taller)
  +--------+--------+--------+--------+
```

**Module types needed:**

1. **WindowModule** -- The workhorse. Assembly of:
   - Wall surround (4 boxes framing the opening: left strip, right strip, top strip, bottom/sill strip)
   - Glass pane (thin box, recessed 5-10cm behind wall face)
   - Window frame (4 thin boxes forming the frame perimeter)
   - Sill (protruding box below window, extends ~4cm forward)
   - Optional: lintel (protruding box above window), mullion (vertical divider), transom (horizontal divider)

2. **DoorModule** -- Ground floor variant:
   - Wider opening (0.9-1.2m vs 1.0-1.4m for windows)
   - Taller opening (2.1-2.4m), sill height = 0
   - Optional: door frame surround, transom window above, canopy/awning
   - Optional: recessed entrance (set-back wall plane for doorway depth)

3. **SolidWallModule** -- No opening:
   - Full wall panel, used for corners, party walls, blind walls
   - Optional: decorative panel, rustication texture

4. **ShopfrontModule** -- Commercial ground floor:
   - Large glazed opening (full bay width minus thin mullions)
   - Low sill (0.3-0.5m) or floor-to-ceiling
   - Sign band above

5. **BalconyModule** -- Extends window module:
   - Slab protruding from wall face (0.8-1.5m depth)
   - Railing (thin boxes or baluster pattern)
   - Glass door instead of window behind

### A.2 Horizontal Bands (Ledges, Cornices, String Courses)

These run the full width of each wall and visually separate floors:

1. **String Course / Band Course** -- Thin horizontal band at each floor line:
   - Box: wallWidth x 0.06-0.10m tall x (wallThick + 0.04m) deep
   - Positioned at each floor plate level
   - Current implementation already has this (ledge between floors)

2. **Cornice** -- Major projecting moulding:
   - At roofline (main cornice) and sometimes at ground floor top
   - Multi-part profile: flat face + curved underside + drip edge
   - For box-geometry approach: 2-3 stacked boxes of decreasing projection
   - Main cornice profile (top to bottom):
     ```
     |----|        <- corona (flat slab, projects 15-25cm)
     |-----|       <- cyma (larger projection, 5-8cm tall)
     |---|         <- fascia (flush with wall, 10-15cm tall)
     ```

3. **Plinth / Base Course** -- At building base:
   - Slightly wider than wall (2-5cm each side)
   - 0.3-0.6m tall
   - Often different material (stone vs plaster)

4. **Parapet Cap** -- Flat coping stone atop parapet wall:
   - Projects 2-3cm beyond parapet face
   - 5-8cm tall

### A.3 Corner Treatments

Houdini identifies these as distinct module zones:

1. **Pilasters** -- Flat columns at corners:
   - Box: 0.3-0.5m wide x full height x (wallThick + 0.05m)
   - Can have base, shaft, and capital subdivisions

2. **Quoins** -- Alternating large/small stone blocks at corners:
   - Series of boxes alternating in width (0.3m / 0.2m) stacked vertically
   - Project 3-5cm from wall face

3. **Chamfered Corner** -- 45-degree cut:
   - Diagonal wall segment at building corners
   - May contain its own window module

4. **Simple Corner Overlap** -- Default:
   - One wall extends to cover the corner, other wall butts against it
   - Current implementation does this implicitly

### A.4 Roof Types

1. **Flat + Parapet** (current: implemented)
   - Slab + 4 parapet walls + parapet cap

2. **Gabled** (current: implemented, but uses flat box planes)
   - Two angled planes meeting at ridge
   - Need: proper thickness (not paper-thin), rake board at gable edge, optional gable window

3. **Hipped** (current: implemented via vertex deformation)
   - All sides slope inward
   - Need: proper hip ridges, not just squished box

4. **Mansard** (not implemented)
   - Lower steep slope + upper shallow slope (or flat)
   - Classic Parisian style
   - Dormer windows in the steep slope section
   - Construction: 4 lower trapezoid panels + 4 upper panels (or flat top)

5. **Shed / Mono-pitch** (not implemented)
   - Single sloped plane
   - Industrial/modern style

6. **Dutch Gable** (not implemented)
   - Gable with a small hip at the top
   - Combines gable and hip construction

### A.5 Material System

Each building should have a coherent material palette derived from style + seed:

```typescript
interface BuildingMaterials {
    wallPrimary: IMaterial      // main wall surface
    wallSecondary: IMaterial    // ground floor / accent wall
    frame: IMaterial            // window/door frames
    glass: IMaterial            // glass panes
    sill: IMaterial             // sills, ledges, cornices (often stone)
    roof: IMaterial             // roof surface
    metalwork: IMaterial        // railings, decorative iron
}
```

**Style-driven palette generation:**
- **Modern**: white/gray wall, dark aluminum frames, blue-tint glass, flat roof
- **Classical**: cream/ochre wall, white painted frames, clear glass, stone sills, clay tile roof
- **Industrial**: exposed brick (warm red-brown), steel frames, wire glass, corrugated metal roof
- **Art Deco**: ivory/gold wall, bronze frames, green-tint glass, geometric stone details, stepped parapet
- **Mediterranean**: white/terracotta wall, dark wood frames, clear glass, terracotta tile roof

### A.6 Ground Floor Differentiation

Real buildings almost always have a distinct ground floor:
- Taller floor height (3.5-4.0m vs 2.8-3.2m for upper floors) -- **already implemented**
- Different module (doors, shopfronts) -- partially implemented (center door only)
- Different material (stone base, rusticated wall)
- Plinth/base course at bottom

### A.7 Bay Width/Height Auto-Calculation

Given a wall width and bay count, the system must:
1. Calculate raw bay width = wallWidth / bayCount
2. Clamp window width to architectural range (0.6m - 2.0m)
3. If raw bay width < minimum wall margin (0.15m each side) + minimum window width (0.6m), reduce bay count
4. Distribute remainder evenly (don't let edge bays be wider/narrower)

Current implementation handles this adequately but doesn't auto-adjust bay count.

---

## B) What an Interactive Demo Needs

### B.1 Real-Time Parameter Editing (Tweakpane)

The current demo already has tweakpane integration. Needed additions:

**Dimensions folder:**
- Width (4-30m, step 0.5)
- Depth (4-20m, step 0.5)
- Floors (1-12, step 1)
- Floor Height (2.5-4.0m, step 0.1)
- Ground Floor Height (3.0-5.0m, step 0.1)
- Front Bays (1-8, step 1)
- Side Bays (1-6, step 1)

**Style folder:**
- Style preset dropdown (Modern, Classical, Industrial, Art Deco, Mediterranean)
- Roof Style dropdown (Flat, Gabled, Hipped, Mansard, Shed)
- Roof Pitch (15-55 degrees, step 1)
- Ground Floor Mode (Residential, Commercial/Shopfront)
- Corner Treatment (None, Pilasters, Quoins, Chamfered)

**Variation folder:**
- Seed (0-9999, step 1)
- Wall Color Hue offset (-0.1 to 0.1)
- Window Style (Standard, Arched, Full-height)
- Balcony Probability (0-1)

**Composition folder:**
- Building Count (1-5)
- Spacing (2-10m)
- Randomize All button

### B.2 Style Presets

Each preset sets a coherent combination of parameters:

```typescript
const PRESETS = {
    modern: {
        roofStyle: 'flat', cornerTreatment: 'none',
        windowStyle: 'full-height', groundFloor: 'commercial',
        balconyProbability: 0.3,
        palette: { wall: [0.0, 0.0, 0.85], frame: [0.0, 0.0, 0.2], ... }
    },
    classical: {
        roofStyle: 'hipped', cornerTreatment: 'quoins',
        windowStyle: 'standard', groundFloor: 'residential',
        hasCornice: true, hasStringCourse: true, hasPlinth: true,
        palette: { wall: [0.08, 0.15, 0.88], frame: [0.0, 0.0, 0.95], ... }
    },
    // ...
}
```

### B.3 Scene Composition

- Multiple buildings on a ground plane with different seeds
- Ground plane: large flat box with shadow-receiving material, slight grid texture
- Shadows: DirectionalLight with shadow map (already in current demo)
- Good default camera: elevated ~30 degrees, looking at building center
- Optional: simple sidewalk (slightly raised strip around building base)

### B.4 Export

- GLTF export via threepipe's built-in AssetExporterPlugin
- Each material as separate GLTF material
- Merged geometry per material for efficiency

---

## C) Implementation Phases

### Phase 1: Core Module System (Wall Sections with Openings)

**Goal:** Refactor current monolithic wall generation into a modular system where each bay-cell is filled by a pluggable module function.

**Tasks:**

1. Define `FacadeModule` interface:
   ```typescript
   interface FacadeModule {
       /** Generate geometry pieces for this module within a bay cell. */
       generate(ctx: ModuleContext): ModuleGeometry
   }

   interface ModuleContext {
       bayWidth: number      // width of this bay cell
       floorHeight: number   // height of this floor
       wallThick: number     // wall thickness
       isGroundFloor: boolean
       floorIndex: number
       bayIndex: number
       totalBays: number
       style: BuildingStyle
       rng: SeededRandom
   }

   interface ModuleGeometry {
       wall: BoxGeometry[]    // opaque wall pieces
       glass: BoxGeometry[]   // glass panes
       frame: BoxGeometry[]   // frame elements
       detail: BoxGeometry[]  // sills, lintels, decorative
   }
   ```

2. Implement concrete modules:
   - `StandardWindowModule` -- extract from current code (4 wall strips + glass + frame + sill)
   - `DoorModule` -- wider opening, no sill, optional transom
   - `SolidWallModule` -- full wall panel, no opening
   - `ShopfrontModule` -- large glazed opening, low sill

3. Implement `ModuleSelector` that picks which module to place in each cell:
   ```typescript
   function selectModule(floor: number, bay: number, totalBays: number,
                         isGroundFloor: boolean, isFrontWall: boolean,
                         style: BuildingStyle, rng: SeededRandom): FacadeModule
   ```
   Rules:
   - Ground floor + front wall + center bay(s) = DoorModule
   - Ground floor + front wall + commercial style = ShopfrontModule
   - Upper floors = StandardWindowModule
   - Edge bays with corner treatment = SolidWallModule or half-module

4. Refactor `generate()` to use module system instead of inline geometry creation.

**Estimated geometry per module (triangles):**
- StandardWindowModule: 4 wall boxes (48 tri) + 1 glass (12 tri) + 4 frame (48 tri) + 1 sill (12 tri) = **~120 triangles**
- DoorModule: similar, ~100 triangles
- SolidWallModule: 1 box = 12 triangles

**Estimated total for a 4-floor, 4x3 bay building:**
- 4 walls x 4 floors x avg 3.5 bays = 56 modules x ~120 tri = **~6,720 triangles** for facade
- Plus floor slabs, ledges, roof = ~1,500 triangles
- **Total: ~8,000-10,000 triangles per building** (very reasonable)

### Phase 2: Roof System

**Goal:** Proper 3D roof construction for all types.

**Tasks:**

1. Refactor roof into `RoofGenerator` with method per type:
   ```typescript
   interface RoofResult {
       geometry: BoxGeometry[]  // or custom BufferGeometry for sloped surfaces
       material: IMaterial
   }
   ```

2. **Flat roof** (refine current):
   - Slab + parapet walls + parapet cap (thin wider box on top of each parapet wall)
   - Optional: slight inward slope (not visible but architecturally correct)

3. **Gabled roof** (improve current):
   - Two slope planes with proper thickness (not paper-thin)
   - Use extruded pentagon profile: create a box, then shift top vertices to form triangular cross-section
   - Ridge board: thin box along the ridge line
   - Rake/verge board: thin box along each gable edge
   - Overhang: extend slope 0.2-0.3m beyond wall face
   - **Gable wall infill**: triangular wall piece filling the gable end (currently missing)

4. **Hipped roof** (improve current):
   - Construct from 4 trapezoid planes (front/back) + 2 triangle planes (sides), or vice versa
   - Each plane = box with top vertices shifted inward and up
   - Proper hip ridge lines and main ridge
   - Overhang on all sides

5. **Mansard roof** (new):
   - Lower section: 4 steep trapezoid planes (60-70 degrees)
   - Upper section: 4 shallow planes or flat top
   - Break line between lower and upper = horizontal ledge
   - Dormer windows: small gabled boxes protruding from lower slope

6. **Shed/mono-pitch** (new):
   - Single sloped plane, higher at front, lower at back
   - Trivial: one box with top-front vertices raised

**Triangle budget for roofs:**
- Flat + parapet: ~84 triangles (slab + 4 parapets + 4 caps)
- Gabled: ~60 triangles (2 slopes + ridge + 2 rake boards + 2 gable fills)
- Hipped: ~72 triangles (4 slope faces, each from deformed box)
- Mansard: ~120 triangles (8 slope faces + dormers)

### Phase 3: Detail Elements (Cornices, Sills, Ledges)

**Goal:** Add architectural detail that makes buildings look real.

**Tasks:**

1. **Multi-part Cornice** at roofline:
   - 3 stacked boxes per wall side:
     - Fascia: wallWidth x 0.12m x wallThick (flush with wall)
     - Cyma: wallWidth x 0.06m x (wallThick + 0.08m) (projects forward)
     - Corona: wallWidth x 0.04m x (wallThick + 0.15m) (projects most)
   - Applied to all 4 wall tops, with mitered corners (extend boxes to overlap at 45 degrees, or use corner blocks)
   - Style-dependent: classical = full 3-part; modern = none or minimal; industrial = simple flat band

2. **String Courses** between floors:
   - Already partially implemented as simple box
   - Improve: 2-part (flat band + slight projection), same material as sill
   - Only on classical/traditional styles

3. **Plinth / Base Course**:
   - Box: (wallWidth + 0.04m) x 0.4m x (wallThick + 0.04m)
   - Runs around building base
   - Different material (stone color, lower roughness)

4. **Window Sill** improvements:
   - Already implemented as simple box
   - Add: drip edge (tiny box below sill, offset forward 1cm)
   - Classical style: wider sill with moulding profile (2 stacked boxes)

5. **Window Lintel / Header**:
   - Box above window opening, projects 2-3cm from wall face
   - Classical: visible stone lintel
   - Modern: hidden (flush with wall)
   - Industrial: steel angle (thin L-shaped profile, approximate with 2 thin boxes)

6. **Corner Quoins** (classical style):
   - Series of boxes at each building corner
   - Alternate large (0.35m wide x 0.25m tall) and small (0.25m wide x 0.15m tall)
   - Stack from ground to cornice
   - Project 3cm from wall face
   - Stone material

7. **Corner Pilasters** (classical style variant):
   - Single tall box at each corner: 0.4m wide x full height x (wallThick + 0.05m)
   - Optional: base box (wider) + capital box (wider) at top

**Triangle budget for details (4-floor building):**
- Cornice: 4 walls x 3 parts x 12 tri = ~144 triangles
- String courses: 4 walls x 3 floors x 12 tri = ~144 triangles
- Plinth: 4 walls x 12 tri = ~48 triangles
- Lintels: ~56 modules x 12 tri = ~672 triangles (only for classical)
- Quoins: 4 corners x ~30 blocks x 12 tri = ~1,440 triangles
- **Total details: ~800-2,400 triangles** depending on style

### Phase 4: Style Presets and Material System

**Goal:** Coherent architectural styles that look convincing.

**Tasks:**

1. Define `BuildingStyle` interface:
   ```typescript
   interface BuildingStyle {
       name: string
       // Module selection
       upperFloorModule: 'standard' | 'arched' | 'full-height'
       groundFloorModule: 'residential-door' | 'shopfront' | 'garage'
       // Detail toggles
       hasCornice: boolean
       hasCorniceProfile: 'simple' | 'classical' | 'none'
       hasStringCourse: boolean
       hasPlinth: boolean
       hasLintel: boolean
       cornerTreatment: 'none' | 'quoins' | 'pilasters' | 'chamfer'
       // Roof
       preferredRoof: RoofStyle
       // Materials
       palette: StylePalette
       // Proportions
       windowWidthRatio: number   // 0.4-0.8 of bay width
       windowHeightRatio: number  // 0.35-0.6 of floor height
       sillHeight: number         // meters from floor
       frameThickness: number     // meters
       frameDepth: number         // meters
   }
   ```

2. Implement 5 preset styles:

   **Modern:**
   - No cornice, no string course, no quoins
   - Full-height or floor-to-ceiling windows
   - Thin aluminum frames (0.03m), dark color
   - Flat roof with glass/metal parapet
   - White/light gray walls, high contrast
   - Balconies with glass railings

   **Classical (European):**
   - Full 3-part cornice, string courses at every floor
   - Quoins at corners, stone plinth
   - Standard proportioned windows with visible lintels
   - Hipped or mansard roof
   - Cream/ochre walls, white frames, stone sills

   **Industrial/Loft:**
   - Simple flat cornice band, no string courses
   - Large multi-pane windows (add mullion + transom subdivisions)
   - Steel frames, wire glass
   - Flat roof with simple parapet
   - Red-brown brick walls, dark metal frames
   - Fire escape balconies (simple metal platform + ladder, optional)

   **Art Deco:**
   - Stepped cornice/parapet (crown)
   - Geometric window proportions
   - Bronze/gold metalwork frames
   - Vertical pilasters between bays
   - Ivory/cream walls, geometric stone inlays
   - Setback upper floors (building steps back at top 1-2 floors)

   **Mediterranean/Colonial:**
   - Simple cornice, no string course
   - Arched window tops (approximate with extra box above window)
   - Dark wood frames, wrought iron balconies
   - Low-pitch hipped roof with clay tile color
   - White walls, terracotta roof
   - Decorative iron railings on select windows

3. Material palette generation from seed:
   - Base hue + saturation + lightness from style definition
   - Seed offsets each value within a constrained range
   - Ensures visually varied but style-coherent buildings

### Phase 5: City-Scale Composition

**Goal:** Generate multiple buildings forming a street or block.

**Tasks:**

1. `BuildingBlockGenerator`:
   - Input: block footprint (rectangle), building count, spacing
   - Places buildings along edges of the block
   - Each building gets unique seed, varied height/width
   - Shared ground plane

2. `StreetGenerator`:
   - Two rows of buildings facing each other
   - Road surface between them
   - Sidewalks

3. Performance for city scale:
   - 10 buildings at ~10K triangles each = 100K triangles (fine for WebGL)
   - 50 buildings = 500K triangles (still manageable with merged geometry)
   - 100+ buildings: switch to InstancedMesh2 for repeated modules
   - LOD: at distance, replace full building with simple box + window texture (mrdoob approach)

4. Ground plane:
   - Large flat box with subtle grid or pavement material
   - Receives shadows
   - Optional: grass patches, tree instances from VegetationScatterGenerator

---

## D) Specific Geometry Construction Details

### D.1 Window Module (Standard) -- Exact Dimensions

Given: `bayWidth` (bW), `floorHeight` (fH), `wallThick` (wT = 0.25m)

```
Window opening:
  winW = min(bW * 0.55, 1.3m)     -- window width
  winH = min(fH * 0.45, 1.5m)     -- window height
  sillH = min(0.9m, (fH - winH) * 0.55)  -- sill height from floor base
  marginX = (bW - winW) / 2       -- horizontal margin each side
  topMargin = fH - sillH - winH   -- space above window

Geometry pieces (all in local bay-cell coordinates, origin at cell bottom-center):

1. LEFT WALL STRIP:
   Box(marginX, fH, wT)
   Position: (-bW/2 + marginX/2, fH/2, 0)
   Triangles: 12

2. RIGHT WALL STRIP:
   Box(marginX, fH, wT)
   Position: (+bW/2 - marginX/2, fH/2, 0)
   Triangles: 12

3. TOP WALL STRIP:
   Box(winW, topMargin, wT)
   Position: (0, fH - topMargin/2, 0)
   Triangles: 12

4. BOTTOM WALL STRIP (sill wall):
   Box(winW, sillH, wT)
   Position: (0, sillH/2, 0)
   Triangles: 12

5. GLASS PANE:
   Box(winW - 0.06, winH - 0.06, 0.01)
   Position: (0, sillH + winH/2, -0.08)  -- recessed behind wall face
   Triangles: 12

6. FRAME TOP RAIL:
   Box(winW, 0.04, 0.06)
   Position: (0, sillH + winH - 0.02, -0.02)
   Triangles: 12

7. FRAME BOTTOM RAIL:
   Box(winW, 0.04, 0.06)
   Position: (0, sillH + 0.02, -0.02)
   Triangles: 12

8. FRAME LEFT STILE:
   Box(0.04, winH, 0.06)
   Position: (-winW/2 + 0.02, sillH + winH/2, -0.02)
   Triangles: 12

9. FRAME RIGHT STILE:
   Box(0.04, winH, 0.06)
   Position: (+winW/2 - 0.02, sillH + winH/2, -0.02)
   Triangles: 12

10. SILL LEDGE:
    Box(winW + 0.08, 0.04, wT + 0.06)
    Position: (0, sillH - 0.02, 0.02)  -- projects forward
    Triangles: 12

TOTAL: 10 boxes x 12 triangles = 120 triangles per window module
```

### D.2 Door Module -- Exact Dimensions

```
Door opening:
  doorW = min(1.1m, bW * 0.5)
  doorH = min(2.3m, fH - 0.3m)
  sillH = 0  (door goes to floor)
  marginX = (bW - doorW) / 2
  topMargin = fH - doorH

Geometry pieces:

1-2. LEFT/RIGHT WALL STRIPS: same as window, using doorW/doorH
3. TOP WALL STRIP: Box(doorW, topMargin, wT) at (0, fH - topMargin/2, 0)
4. NO BOTTOM STRIP (door reaches floor)
5. DOOR PANEL: Box(doorW - 0.06, doorH - 0.06, 0.04) at (0, doorH/2, -0.06)
   -- thicker than glass, opaque material
6-9. FRAME: same pattern as window, using doorW/doorH
10. THRESHOLD: Box(doorW + 0.1, 0.02, wT + 0.1) at (0, 0.01, 0.02)
11. Optional TRANSOM WINDOW: Box(doorW - 0.08, 0.3, 0.01) at (0, doorH - 0.15, -0.08)

TOTAL: ~110-130 triangles per door module
```

### D.3 Cornice -- Exact Dimensions

```
For each wall of width wallW:

1. FASCIA (bottom, flush):
   Box(wallW + 0.02, 0.12, wT)
   Position: (0, totalH + 0.06, 0)  -- at wall top
   Triangles: 12

2. CYMA (middle, small projection):
   Box(wallW + 0.04, 0.06, wT + 0.08)
   Position: (0, totalH + 0.12 + 0.03, 0.04)
   Triangles: 12

3. CORONA (top, maximum projection):
   Box(wallW + 0.06, 0.04, wT + 0.18)
   Position: (0, totalH + 0.18 + 0.02, 0.09)
   Triangles: 12

Corner resolution: each wall's cornice extends to the building corner.
At meeting point, one wall's cornice overlaps the other's -- acceptable for box geometry.
For cleaner corners: add a small cube block at each corner intersection.

TOTAL: 4 walls x 3 parts x 12 tri = 144 triangles + 4 corner blocks = ~192 triangles
```

### D.4 Gabled Roof -- Construction

```
Given: building width W, depth D, roof pitch angle P

ridgeHeight = tan(P) * (D/2)
slopeLength = (D/2) / cos(P)
overhang = 0.3m
roofThick = 0.08m

SLOPE PANELS (2):
  Each is a box deformed to form a wedge:
  Start: Box(W + overhang*2, slopeLength + overhang, roofThick)
  Rotate around X by (90 - P) degrees for front slope, -(90 - P) for back
  Position.y = totalH + ridgeHeight/2
  Position.z = +/- (D/4) adjusted for pitch

  Better approach -- construct as 6-vertex prism:
  Bottom-left, bottom-right at eave line
  Top-left, top-right at ridge line
  Creates a proper sloped quad, not a rotated box

GABLE WALL FILL (2, front and back):
  Triangle: vertices at (W/2, totalH), (-W/2, totalH), (0, totalH + ridgeHeight)
  Construct from 3 thin boxes forming a triangular shape, or:
  Custom BufferGeometry with 2 triangles (1 quad = 2 tris)

RIDGE BOARD:
  Box(W + overhang*2, 0.04, 0.08)
  Position: (0, totalH + ridgeHeight, 0)

RAKE BOARDS (4, one per gable edge):
  Box(slopeLength + overhang, 0.04, 0.06)
  Rotated to match slope angle
  Positioned along gable edges

TOTAL: 2 slopes (24 tri) + 2 gable fills (4 tri) + ridge (12 tri) + 4 rakes (48 tri) = ~88 triangles
```

### D.5 Hipped Roof -- Construction

```
Given: W, D, P (pitch angle)

ridgeHeight = tan(P) * min(W,D)/2
ridgeLength = abs(W - D)  -- ridge runs along longer dimension

If W > D (wider than deep):
  Front/back faces: trapezoids (wide base, narrower top)
  Side faces: triangles (base = D, apex at ridge end)

Each face constructed from deformed box:
  Start: Box(faceWidth, slopeLength, roofThick)
  Shift top vertices inward to form trapezoid/triangle cross-section

4 hip faces, each ~24 triangles = ~96 triangles
Plus 4 overhang fascia boards = ~48 triangles
TOTAL: ~144 triangles
```

### D.6 Mansard Roof -- Construction

```
Lower slope angle: 65-75 degrees (steep)
Upper slope angle: 20-30 degrees (shallow) or flat

lowerH = totalH * 0.3  -- lower slope section height
upperH = ridgeHeight - lowerH
breakWidth = W - 2 * (lowerH / tan(lowerAngle))  -- width at break line
breakDepth = D - 2 * (lowerH / tan(lowerAngle))

LOWER SLOPES (4):
  Trapezoid panels, steep angle
  Each: Box deformed, base at eave, top at break line

UPPER SECTION:
  Either 4 shallow slope panels (hipped top) or flat slab

BREAK LEDGE:
  Horizontal band at break line between lower and upper
  4 boxes running around the building at break height

DORMER WINDOWS (optional, placed in lower slope):
  Mini gabled box protruding from slope surface
  Each dormer: ~60-80 triangles (small gable + window + cheeks)
  2-4 dormers per building face

TOTAL: ~200-400 triangles depending on dormers
```

### D.7 Quoin Blocks -- Construction

```
At each of 4 building corners, alternating large/small blocks:

Block count per corner = floor(totalH / 0.4)  -- roughly 0.4m per block
Large block: Box(0.35, 0.25, wT + 0.03)
Small block: Box(0.25, 0.15, wT + 0.03)

Two quoin strips per corner (one per wall face):
  Each strip offset to sit at the corner edge
  Large blocks at even indices, small at odd

Per corner: ~20-30 blocks x 2 sides = 40-60 boxes x 12 tri = 480-720 triangles
4 corners: 1,920-2,880 triangles

Optimization: merge all quoin geometry into single mesh per wall
```

---

## E) Triangle/Vertex Budget Summary

| Component | Triangles (4-floor, 4x3 bay building) |
|---|---|
| Facade modules (56 bays) | ~6,720 |
| Floor slabs (5) | ~60 |
| Ledges/string courses (12) | ~144 |
| Cornice (4 walls) | ~192 |
| Plinth (4 walls) | ~48 |
| Roof (hipped) | ~144 |
| Corner quoins (4 corners) | ~2,400 |
| **TOTAL (Classical style)** | **~9,700** |
| **TOTAL (Modern, no details)** | **~7,100** |

For city-scale with 20 buildings: **~140K-200K triangles** -- well within WebGL budget.

With geometry merging per material (current approach), this results in ~3-5 draw calls per building, ~60-100 draw calls for 20 buildings. Excellent performance.

---

## F) File Structure

No new files need to be created in this plan phase. The implementation would modify/add:

```
plugins/procedural-generation/src/
  generators/
    BuildingGenerator.ts          -- refactor to use module system
    building/
      FacadeModule.ts             -- interface + ModuleContext
      StandardWindowModule.ts     -- window module implementation
      DoorModule.ts               -- door module
      ShopfrontModule.ts          -- commercial ground floor
      SolidWallModule.ts          -- blank wall
      RoofGenerator.ts            -- all roof type construction
      CornerTreatment.ts          -- quoins, pilasters
      HorizontalBands.ts          -- cornice, string course, plinth
      BuildingStyle.ts            -- style presets and palette
      ModuleSelector.ts           -- rule-based module selection

examples/
  procedural-building/
    script.ts                     -- enhanced demo with full UI
  procedural-city-block/
    script.ts                     -- city composition demo (Phase 5)
```

---

## G) Key Differences from Current Implementation

| Aspect | Current | Planned |
|---|---|---|
| Module system | Inline geometry in generate() | Pluggable FacadeModule interface |
| Module types | Window + door (hardcoded center) | Window, Door, Shopfront, Solid, Balcony |
| Ground floor | Center door only | Configurable: residential doors, shopfronts |
| Corner treatment | None (walls overlap) | Quoins, pilasters, chamfer |
| Cornice | None | 3-part classical profile, style-dependent |
| Plinth | None | Base course, different material |
| Lintels | None | Above each window, style-dependent |
| Roof types | 3 (flat, gabled, hipped) | 5+ (add mansard, shed, dutch gable) |
| Roof construction | Paper-thin planes, squished box | Proper thickness, ridge boards, gable fill |
| Styles | 3 (color only) | 5 (full material + proportion + detail) |
| Material system | 4 materials (wall, frame, glass, roof) | 7 materials (add sill/stone, metalwork, secondary wall) |
| Bay count | Manual | Auto-adjust if wall too narrow |
| Window proportions | Fixed ratios | Style-dependent ratios |
| City composition | None | BuildingBlockGenerator, StreetGenerator |

---

## H) References

### Cloned Repos (in `.repos/`)
- `threejs-procedural-building-generator` -- Aljullu's thesis, floor shape variety + window placement
- `threex-proceduralcity` -- mrdoob's city, mass generation + procedural window texture
- `city-generator` -- MHillier98, road layout + building placement

### Documentation Studied
- [Houdini Labs Building Generator 4.0](https://www.sidefx.com/docs/houdini/nodes/sop/labs--building_generator-4.0.html) -- module types, facade pattern syntax, floor slicing
- [Houdini Labs Building from Patterns](https://www.sidefx.com/docs/houdini/nodes/sop/labs--building_from_patterns-1.1.html) -- pattern language for module placement
- [Buildify 1.0](https://paveloliva.gumroad.com/l/buildify) -- modular GN library, kit-based styles
- [Coan's PBG 2](https://coan.gumroad.com/l/pbg-2) -- mesh-adaptive building generation, 9 node groups
- [CityEngine Facade Wizard](https://doc.arcgis.com/en/cityengine/latest/tutorials/tutorial-13a-facade-wizard-basic-facade-creation.htm) -- split-grammar facade, Z-depth for windows
- [Wonka et al. "Procedural Modeling of Buildings"](https://dl.acm.org/doi/10.1145/1141911.1141931) -- CGA shape grammar, academic foundation
- [SideFX Building Generator Tutorial](https://www.sidefx.com/tutorials/building-generator/) -- facade pattern syntax, handplaced overrides
- [Proc-GS: Procedural Building Generation](https://arxiv.org/html/2412.07660v1) -- recent 3DGS approach, shared foundational assets
