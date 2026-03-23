# Procedural Building Generator Research

Comprehensive implementation-level research into how the best procedural building generators work, covering Blender tools, game engines, academic methods, and three.js implementations.

---

## 1. Buildify (Pavel Oliva) -- Blender Geometry Nodes

**Source:** Free addon, 3000+ Gumroad ratings. Blender 3.2+.

### Architecture

Buildify is a modular geometry nodes library with **3 main node groups**:

1. **Walls** -- The core node group. Instances wall modules (meshes from a collection) onto vertical faces of the input mesh. The system classifies faces by their normal direction: upward-facing faces become roof candidates, side-facing faces become walls.

2. **Flat Roof** -- Handles the top faces. Roof props placement uses recursive face subdivision: polygons are randomly subdivided several times, centers of those sub-faces are grouped using the ID node, and models are instanced onto those centers. **Face size classification**: based on polygon area, the node group chooses between predefined **small, medium, or large detail groups**. This prevents tiny detail models from appearing on large roof areas and vice versa. Users can add more size-category groups by editing the inner node graph.

3. **Wall Props** -- Turns wall output into a point cloud, further randomizes it, and instances models onto those points. Requires **2 inputs from the Walls node group**: wall instances and instance orientation. This is how things like AC units, pipes, signs, and window boxes are scattered onto wall surfaces.

### How Modules Are Swapped

- Modules live in **Blender Collections**. Each collection contains mesh variants for a given building element (e.g., a "Windows" collection, a "Doors" collection).
- The node graph references these collections. To swap styles, you swap the collection reference.
- Within a collection, **random selection with seed control** picks which variant to place at each location.

### How Face Instancing Works

- The user models a simple blockout mesh (extruded boxes).
- When the user **extrudes or copy-pastes faces**, buildings are generated automatically -- this is the core interactive workflow.
- The Walls node reads each face, calculates its size and orientation, and instances the appropriate module at the correct scale and rotation.
- Floor count is derived from building height / floor height parameter.

### ADE (Art-Directable Editor) Mode

In default ADE mode, the user has more creative freedom but must assign certain parameters and vertex groups manually. It is basically normal Blender edit mode where you set up parameters by hand. The alternative mode integrates with **Blender-OSM** to auto-generate building layouts from real-world city data.

### Key Parameters

- Floor height
- Number of floors
- Wall module collection references
- Roof detail collection references (small/medium/large)
- Wall prop density and randomization seed
- Building style randomization seed (for per-building variation in a scene)

### What Makes It Look Good vs Bad

**Good:** Consistent module scale across the building, proper corner handling, realistic prop scatter density, wall texture variation.
**Bad:** Without manual tweaking, all buildings look samey. The system does not handle L-shaped or complex footprints elegantly -- it works best on simple extruded boxes. Corner modules can misalign if face sizes do not divide evenly by module width.

### Implementation Complexity: MEDIUM
The core concept (instance modules on faces, classify by normal, randomize by seed) is straightforward in a geometry-nodes context. Translating to three.js would require: face classification by normal, module instancing with scale fitting, collection/variant management, and recursive subdivision for roof props.

---

## 2. PBG 2 (Isak Waltin / Coan) -- Blender Geometry Nodes

**Source:** Paid addon (Gumroad/Blender Market). Blender 4.0+.

### What Makes It Special: Works on ANY Mesh

Unlike Buildify (which works best on simple box extrusions), PBG 2 adapts to a mesh **in its entirety** -- not just a 2D floor plan. You can take Suzanne (the monkey head), a character mesh, or any complex 3D shape, drop a preset on it, and PBG 2 will make a building out of it.

This is the key differentiator. The tool does not require the input to be a box or even manifold geometry.

### The 9 Node Groups

PBG 2 ships with 9 modular node groups that can be combined:

1. **Simple Building** -- Drag onto any object, select a style, instantly get a procedural building. The all-in-one solution.
2. **Two-Part Building** -- Splits the building into two vertical segments (e.g., shops on bottom, apartments on top; stone basement + timber upper floors; doors only on ground floor).
3. **Fake Interior** -- Adds parallax-style fake interior rooms. Each room is actually one polygon but appears to have depth.
4. **Create Points** -- For multi-segment builds; generates control points along the mesh.
5. **Add Segment** -- Adds a building segment to the point chain from Create Points.
6. **Instance Assets** -- Places asset instances at specified locations.
7-9. Additional utility nodes for customization (beams, pillars, roof details).

### Face Classification System

PBG 2 classifies mesh faces into categories based on:
- **Face normal direction**: Upward-facing = roof, side-facing = wall, downward-facing = underside/foundation.
- **Face inclination angle**: Angled faces above a threshold become sloped roofs vs. walls.
- **Edge analysis**: Edges are analyzed to determine where structural elements (beams, pillars) should go.

The building elements are then instanced onto the classified faces with proper orientation matching.

### How It Works on Any Mesh

The system:
1. Takes the input mesh as-is (no requirement for specific topology).
2. Analyzes every face's normal, area, and neighborhood.
3. Classifies each face into architectural roles (wall, roof, floor, corner).
4. Instances appropriate modules with scale adaptation to fit the face dimensions.
5. Handles concave faces, non-planar quads, and arbitrary topology through mesh deformation of the instanced modules.

### Preset System

- 5 base styles + 4 historic styles (Kowloon Walled City, half-timbered, wooden, Pueblo, Swedish cottage).
- Presets are drag-and-dropped from the Asset Browser onto objects.
- After applying a preset, you edit the building shape using normal Blender tools (extrude, move, loop cut).
- Changes update in real-time.

### Experimental Features

- **Deforming mesh support**: Cloth simulations, armatures, and other deformers can be applied to buildings. The building modules deform with the underlying mesh.

### Implementation Complexity: HIGH
The "works on any mesh" capability requires robust face classification, adaptive module scaling, handling of arbitrary topology, and potentially mesh deformation for non-planar faces. This is significantly harder than Buildify's approach.

---

## 3. Auto-Building (Julien Gauthier) -- Blender Geometry Nodes

**Source:** Paid addon (Gumroad/Blender Market). Blender 3.6+.

### Core Workflow: Material Index Drives Module Selection

The main concept: **assign special materials to faces, and those faces get turned into objects**. The material assignment on a face determines WHAT gets placed there.

This is a distinctly different approach from Buildify/PBG 2. Instead of algorithmic face classification, the user paints materials onto faces to art-direct the building.

### How It Works

1. **Start with a simple blockout mesh** (box, L-shape, etc.).
2. **Assign materials to faces**: Each material corresponds to a building element type (window style A, door, balcony, vent, etc.).
3. The geometry nodes system reads the material index of each face.
4. Based on the material index, it **instances the corresponding collection of objects** onto that face.
5. Objects from the collection are scattered with control over density, randomness, offset, and automatic boolean operations.

### Three Control Mechanisms

1. **Material/Shader Assignment** = controls the look of faces and adds ledges. Different materials map to different architectural element collections.

2. **Edge Crease Value** = controls pillar placement. Setting a crease value on specific edges tells the system to scatter pillar objects along those edges. The crease value essentially marks structural edges.

3. **Face Inclination** = controls roof behavior. The slope of the roof depends on the face's inclination angle relative to the vertical. Steep faces = wall behavior. Shallow faces = roof behavior. The threshold is configurable.

### Additional Features

- **Facade scattering**: Distributes elements across facade faces with density control.
- **Roof scattering**: Separate scatter system for roof elements (chimneys, vents, dormers).
- **Pillar generator**: Dedicated system for structural pillars, driven by edge creases.
- **Modular roof generator**: Generates roof geometry procedurally.
- **"Ignore Wall Inclining"**: Toggle so that instanced objects stay vertical even on angled faces (e.g., windows should be vertical even on a slightly tilted wall).
- **Object deformation to face**: Objects can be deformed to conform to the shape of the face they sit on.

### What Makes It Unique

The material-index approach gives the artist **explicit per-face control** over what goes where, rather than relying on algorithmic classification. This makes it more art-directable but requires more manual work. It is ideal for hero buildings that need specific designs rather than mass-generated cities.

### Visual Output

Can generate entire cities where "the architectural style will be similar, but the individual buildings will look very distinct." The material-driven approach ensures consistency within a style while allowing variation.

### Implementation Complexity: MEDIUM
The material-index approach is actually simpler to implement algorithmically than automatic classification. The challenge is in the UI/UX: providing an intuitive material painting workflow and managing the collection-to-material mapping.

---

## 4. Houdini Labs Building Generator (SideFX)

**Source:** Free with Houdini (Labs toolset). Industry-standard reference implementation.

### Pipeline (The Gold Standard)

The Houdini Building Generator is the reference implementation that most Blender tools are trying to replicate. Its pipeline:

1. **Input**: Low-resolution blockout mesh (proxy geometry).
2. **Volume Analysis**: Analyzes the incoming building volume's dimensions and topology.
3. **Floor Slicing**: Slices the volume into floors based on configurable floor height.
4. **Structural Region Identification**: For each floor, identifies:
   - **Walls** (flat vertical regions)
   - **Corners** (where two walls meet -- both convex and concave variants)
   - **Ledges** (top and bottom horizontal bands of each floor)
   - **Sideslop** (gaps between walls and corners that need filling)
5. **Module Replacement**: Replaces each identified region with high-resolution modules from a user-defined **module library**.

### Module Library Structure

- Modules sit on the **YZ plane** with their front lower-right corner at origin.
- Each module has a defined footprint size.
- Module types: primary wall facade, corner (convex), corner (concave), top ledge, bottom ledge, sideslop filler.
- **Facade Module Pattern**: Named patterns allow different module assignments per floor.

### Key Parameters

- Full floor height (in Houdini units)
- Per-floor height overrides via "Floor Overrides" (floor index-based customization)
- Facade module pattern names for walls
- Separate patterns for ledges
- Corner behavior toggles (enable/disable corner modules)
- Module library references

### Implementation Complexity: HIGH
This is the most structured and production-ready approach. Implementing the full floor-slicing + structural-region-identification pipeline is the most complex part.

---

## 5. Townscaper (Oskar Stalberg)

**Source:** Commercial indie game. Award-winning procedural building toy.

### The Algorithm: Three Systems Working Together

Townscaper combines three algorithms into one seamless system:

#### A. Irregular Grid Generation

1. Start with a **hexagonal grid** (chunked for infinite tiling).
2. Within each hexagonal chunk, create a **triangular grid** with flat-sided orientation: `TriangleGrid(0.5f, FlatSides, bound: HexBound(4))`.
3. **Randomly merge pairs of triangles** to create irregular quadrilaterals. This breaks the regularity.
4. Apply **Conway's Ortho operator** to subdivide the merged triangles into quads.
5. **Weld duplicate vertices** at chunk boundaries.
6. Apply **mesh relaxation** (two stages):
   - Skip relaxation within individual hexes during generation (to maintain hex boundaries).
   - Apply `RelaxModifier` across the entire grid to smooth cell transitions.
7. The result: an organic-looking grid of irregular quads that tiles infinitely.

**Infinite tiling**: A `PlanarLazyMeshGrid` manages infinite tiling. Each hex chunk uses **deterministic random seeding** based on hex cell identity (not global random), so chunks are consistent regardless of generation order.

**3D extension**: `PlanarPrismModifier` stacks 2D grid layers vertically to create deformed cube structures (voxels on the irregular grid).

#### B. Modified Marching Cubes

- Standard marching cubes: 256 possible configurations per cube, 15 unique tile patterns.
- Townscaper's variant: Instead of simple triangle meshlets, uses **custom "atoms"** -- hand-modeled architectural modules imported from Blender.
- Each module is **labeled with the empty/full neighbor configurations** it fits (its marching cubes case).
- **378 total modules** were needed to cover all possible cases in the various townscape configurations.
- Because the grid is irregular, modules must be **deformed to fit** each cell. This uses **cage-based mesh deformation** with **Spherical Mean Value Coordinates** for real-time deformation.

#### C. Wave Function Collapse (Constrained Tile Selection)

- WFC determines which architectural modules are valid at each position.
- Each position maintains a set of possible modules.
- Adjacent positions constrain each other through **adjacency rules** (which modules can neighbor which).
- The algorithm collapses positions with lowest entropy first.

#### Data Structure

A custom **BMesh implementation** (mirroring Blender's half-edge data structure) enables efficient queries like "all faces connected to a vertex" -- critical for procedural mesh generation on the irregular grid.

### Player Interaction

1. Player clicks to add/remove a single block.
2. System evaluates valid adjacent components via WFC constraints.
3. Compatible architectural modules are identified from the 378-module library.
4. Modules are deformed to fit the irregular grid cells.
5. Result: beautiful, organic-looking buildings with proper roofs, walls, windows, arches, and staircases.

### What Makes It Look So Good

- **Irregular grid**: Avoids the rigid, grid-locked look of most procedural systems. Buildings have organic footprints and winding streets.
- **Hand-crafted modules**: All 378 modules were hand-modeled to look good. The algorithm only places them; artists designed them.
- **Constraint solving**: WFC ensures architectural coherence -- no floating walls, mismatched corners, or impossible configurations.
- **Deformation**: Cage deformation makes straight-edged modules conform to the organic grid, creating subtle curvature that reads as hand-built.

### Implementation Complexity: VERY HIGH
The combination of irregular grid generation, custom marching cubes, WFC constraint solving, cage deformation, and 378 hand-modeled modules makes this the most complex system studied. A simplified version (regular grid, fewer modules, no deformation) would be HIGH complexity.

---

## 6. Wave Function Collapse (WFC) Algorithm -- General

**Source:** Maxim Gumin (2016), based on texture synthesis research.

### Complete Step-by-Step Algorithm

#### 1. Initialization
- Define a grid of cells.
- Each cell starts with ALL possible tile types in its "wavefunction" (the set of tiles it might become).

#### 2. Tile Extraction and Rule Derivation
- Analyze input examples (sample images or manually defined rules).
- For each tile type, record:
  - **Frequency/weight** (how often it appears in examples).
  - **Adjacency rules**: which tiles can appear next to it, in which directions.
- For 3D buildings: each module has **6 connectors** (one per face). Each connector has a numeric ID and symmetry information (flipped, non-flipped, or symmetric). Modules are allowed next to each other when connectors match numerically and symmetry properties align.

#### 3. Entropy Calculation (Select Next Cell)
Use **Shannon Entropy** to find the least-certain cell:

```
entropy = log(sum(weight)) - (sum(weight * log(weight)) / sum(weight))
```

The algorithm always collapses the cell with the **lowest entropy** (fewest valid options, weighted by probability). This is the "minimum entropy heuristic."

#### 4. Collapse
Randomly choose one tile from the cell's remaining options, **weighted by tile weights** from the input analysis. Remove all other options from this cell.

#### 5. Propagation
For each neighbor of the collapsed cell:
- Remove any tile options that violate adjacency rules with the newly collapsed cell.
- Recursively propagate these removals outward through the grid.
- Continue until no more removals are triggered.

#### 6. Loop or Backtrack
- Repeat steps 3-5 until all cells are collapsed.
- If a cell reaches **zero valid options** (contradiction): either restart entirely or implement **backtracking** (undo recent collapses in reverse order until the contradiction resolves).

### For Building Generation Specifically

A WFC-based building system:
- Defines modules with connectors: wall-bottom connects to wall-top, roof-edge connects to wall-top, window connects to wall-side, etc.
- **Exclusion rules** can manually prohibit otherwise-valid pairings (e.g., door module can't appear on upper floors).
- For infinite maps: use a dictionary mapping slot positions to slots, populated on-demand. Only a small active generation area expands; constraints propagate beyond it.

### Implementation Complexity: MEDIUM-HIGH
The basic WFC algorithm is well-documented and implementable in ~500 lines. The complexity comes from defining good module sets and adjacency rules, plus handling 3D (6-connectivity instead of 4).

---

## 7. Three.js Building Generators (Existing Implementations)

### A. Aljullu's Procedural Building Generator

**Repo:** `.repos/threejs-procedural-building-generator/` (cloned)
**Thesis project (2012-2013), MIT license.**

#### Algorithm

This is the most architecturally sophisticated three.js building generator found. It uses a **shape grammar / rule-based system** for floor plan generation:

1. **Floor plan generation via recursive shape rules**:
   - Start with a base shape (square, triangle, or random).
   - `FloorShape.Rule` defines: shape type, size (X,Y), center position, rotation angle, iteration depth, and children rules.
   - For each edge of the current polygon, the system probabilistically generates **child polygons** that extrude outward.
   - Children can be placed at: center (50%), symmetric (both ends), in a row (evenly spaced), left, right, or random positions along the edge.
   - Child size is `availableSpace * random(0.1, 0.9)`, clamped to `[minSolidWidth, maxSolidWidth]`.
   - Collision detection (ray casting / polygon intersection) prevents overlapping children.
   - This process is **recursive**: children can have their own children, creating complex L-shaped, T-shaped, and irregular floor plans.

2. **Floor stacking**:
   - `numberOfFloors = floor(height / floorHeight)`.
   - Each floor uses the same base shape, but with a probability (`probabilityNextFloorDifferentShape`) of changing shape via **shape pruning**: `pruneRules(0, 1/numberOfFloors*2)` randomly removes child rules from the shape tree, creating setbacks.
   - When shape changes occur between floors, the system computes **exclusion walls** (walls that exist in the larger floor but not the smaller one) and generates roof walls there.

3. **Window placement**:
   - Window meshes (Collada models) are loaded and instanced along wall faces.
   - Windows are placed at regular intervals (`windowsSeparation`) along each wall edge.
   - Supports window grouping ("pairs" mode vs "normal" mode).
   - Per-floor window overrides (e.g., ground floor gets different windows/doors).

4. **Roof handling**:
   - Roof objects are instanced on the top face.
   - `roofWallProportion` controls the height of the parapet wall around the roof edge.

5. **Material system**:
   - Uses a **texture atlas** to merge all materials into a single draw call.
   - Wall texture, roof texture, and window/door textures are packed into an atlas.
   - UV coordinates are remapped to atlas positions.

#### Key Parameters

- `sizeX`, `sizeZ`: Building footprint dimensions
- `height`, `floorHeight`: Building and floor heights
- `windowRepetition`: Window repetition pattern
- `probabilityNextFloorDifferentShape`: 0.05-0.25 range
- `windowsSeparation`: Distance between windows
- `minSolidWidth`, `maxSolidWidth`: Constraints on wall segment sizes
- `roofWallProportion`: Parapet height as fraction of floor height
- Per-floor overrides for windows, height, and separation

#### Complexity: MEDIUM-HIGH (already implemented in three.js)

### B. mrdoob/threex Procedural City

**Repo:** `.repos/threex.proceduralcity/` (cloned)
**The classic minimal implementation.**

#### Algorithm (73 lines total)

1. Create a unit cube, translate pivot to bottom, remove bottom face.
2. Set roof face UVs to (0,0) so roof gets a solid color from the texture.
3. Loop 20,000 times:
   - Random position: `floor(random * 200 - 100) * 10`
   - Random rotation: `random * PI * 2`
   - Random scale X: `random^4 * 50 + 10` (power-of-4 distribution = most buildings are small, few are tall)
   - Scale Y (height): `random^3 * scaleX * 8 + 8`
   - Scale Z = Scale X (square footprint)
   - Per-building color with ambient occlusion: top vertices get `baseColor * light`, bottom get `baseColor * shadow`
4. **Merge all into one geometry** (critical for performance).
5. Generate window texture via canvas:
   - 32x64 canvas, white fill
   - Draw 2x1 pixel "windows" every 2px horizontally, every 2px vertically
   - Random grayscale per window (simulates lights on/off)
   - Upscale to 512x1024 without smoothing (pixelated look)

#### What Makes It Work

- The `random^4` distribution for building size creates a realistic cityscape (power law distribution like real cities).
- Vertex colors for ambient occlusion (dark at base, light at top) add depth without extra rendering cost.
- Single merged geometry = one draw call for 20,000 buildings.
- Canvas-generated window texture is clever and zero-asset.

#### Complexity: LOW (good starting point for understanding)

### C. Photonlines Procedural City Generator

**Repo:** `.repos/Procedural-City-Generator/` (cloned)

#### Algorithm

1. **Perlin noise** generates a heightmap that determines block types.
2. Grid of `gridSize x gridSize` blocks, each `blockSize` units.
3. Noise value thresholds:
   - `> groundThreshold (0.85)`: water
   - `< parkThreshold (0.2)`: park/parking (with trees)
   - Otherwise: building block
4. Building blocks are subdivided (`blockSubdivisions = 2`, creating 4 buildings per block).
5. Building heights: `minBuildingHeight (50)` to `maxBuildingHeight (250)`, with per-block height deviation capped at `maxBuildingHeightDeviation (15)` (buildings in the same block have similar heights).
6. Window texture generated on canvas (similar to mrdoob approach): small canvas with random grayscale windows, upscaled without smoothing.
7. Tall buildings (above `tallPercentageCutoff = 40%`) get a larger window texture (16x32 vs 8x16).

#### Complexity: LOW-MEDIUM

### D. jstrait City Tour

**Repo:** `.repos/city-tour/` (cloned)

A more complete city with terrain, roads, and fly-through camera. Uses procedural terrain generation and building placement, but buildings themselves are simple extruded boxes.

---

## 8. CGA Shape Grammar (Muller et al., 2006)

**Source:** "Procedural Modeling of Buildings" (ACM TOG). Foundational academic paper. Basis for CityEngine.

### Complete Algorithm Pipeline

#### Phase 1: Lot to Mass Model

```
Lot -->
    extrude(height)
    Building
```

The lot (2D polygon) is extruded vertically to create a 3D building volume.

#### Phase 2: Component Split (Mass Model to Facades)

```
Building -->
    comp(f) { front : FrontFacade | side : SideFacade | top : Roof }
```

`comp(f)` is the **component split** operation -- it separates the 3D shape into its constituent faces, labeling each by orientation (front, side, top, bottom).

#### Phase 3: Facade Subdivision (Vertical)

```
FrontFacade -->
    split(y) { groundfloor_height : GroundFloor
             | { ~floor_height : Floor }* }

SideFacade -->
    split(y) { groundfloor_height : Floor
             | { ~floor_height : Floor }* }
```

**Key operations:**
- `split(axis)`: Subdivides a shape along the specified axis.
- `{ ... }*`: **Repeat operator** -- repeats the pattern as many times as it fits.
- `~` (tilde / floating size): Allows flexible sizing. Guarantees a full number of elements regardless of remaining space -- the runtime adjusts the actual size so elements fill the space evenly with no gaps.

#### Phase 4: Floor Subdivision (Horizontal)

```
Floor -->
    split(x) {      0.5 : SolidWall
             | { ~tile_width : Tile }*
             |      0.5 : SolidWall }

GroundFloor -->
    split(x) {      0.5 : SolidWall
             | { ~tile_width : Tile }*
             |  ~tile_width : EntranceTile
             |      0.5 : SolidWall }
```

Each floor is split horizontally into tiles (repeated modules) bookended by solid wall segments.

#### Phase 5: Tile Subdivision (Window Components)

```
Tile -->
    split(x) {    1 : SolidWall
             | ~1.5 : split(y) { 0.4 : SolidWall
                                | ~1.5 : Window
                                | 0.4 : SolidWall }
             |    1 : SolidWall }
```

Each tile is split into a nested grid: wall-window-wall horizontally, wall-window-wall vertically.

#### Phase 6: Window Detail

```
Window -->
    t(0, 0, -0.2)
    split(y) { 0.1 : Frame
             |  ~1 : split(x) { 0.1 : Frame
                               | { ~1 : Glass | 0.1 : Frame }* }
             | 0.1 : Frame }
```

Windows are inset (`t(0,0,-0.2)`) and subdivided into frame and glass panes.

#### Phase 7: Door Detail

```
Door -->
    t(0, 0, -0.4)
    split(y) {   ~1 : split(x) { 0.15 : Frame
                                |   ~1 : Panel
                                | 0.05 : Frame
                                |   ~1 : Panel
                                | 0.15 : Frame }
             | 0.15 : Frame }
```

#### Phase 8: Material Assignment

```
SolidWall -->
    s('1, '1, -0.4)
    primitiveCube()
    comp(f) { side : Wall
            | all : setupProjection(0, scope.xy, 1.5, 1.5, 0, '1) Wall }

Glass --> color(window_color)
Frame --> color(frame_color)
Panel --> color(door_color)
```

**Key additional operations:**
- `s(x,y,z)`: Scale scope dimensions (`'1` = relative to current size)
- `t(x,y,z)`: Translate/offset shape
- `offset(-0.4, inside)`: Inset shape inward
- `primitiveCube()`: Generate a cube primitive filling the current scope
- `setupProjection()`: Set up texture projection

### Shape Tree

The result of applying all rules is a **shape tree**:
- Root: Lot
- Inner nodes: intermediate shapes (Building, FrontFacade, Floor, Tile...)
- Leaves: terminal shapes (Glass, Frame, Panel, SolidWall) = the final renderable geometry

### Rule Types

1. **Basic rules**: predecessor --> successor operations
2. **Parameterized rules**: rules with variable parameters (height, width, color)
3. **Conditional rules**: apply only when conditions are met (e.g., if height > 10)
4. **Stochastic rules**: multiple alternatives with probabilities (e.g., 30% Victorian window, 70% modern window)
5. **Context-sensitive rules**: rules that query neighboring shapes (e.g., "if the building next door is tall, add a buttress")

### Implementation Complexity: MEDIUM-HIGH
The split/repeat grammar is well-defined and systematic. A basic implementation covering the rules above is very doable. Full CGA with context-sensitive rules and stochastic selection is harder.

---

## 9. Citygen / Split Grammar Implementation

**Source:** https://gylleus.github.io/citygen/ -- An actual web implementation of split grammars.

### Grammar Rule Format

```
Start -> split(Y) {0.7: Ground | N: Floors | 1: Top} [minY: 3]
```

Components:
- **Left side**: Input shape name
- **Right side in `{}`**: Output shapes separated by `|`, each with a size prefix
- **`N`**: Marks the flexible dimension (maximum one per rule) -- this part stretches to fill remaining space
- **`[constraints]`**: Minimum/maximum dimension thresholds

### Operations

1. **Split**: Divides shape along an axis into sub-shapes.
2. **Repeat**: Fills space with repeated copies: `Floors -> repeat(Y) {0.75N: Floor}`. Can operate across multiple dimensions (XZ, XY) -- selects the largest dimension of the input shape.
3. **Decompose**: Extracts 2D faces from 3D shapes: `Start -> decompose(XZ) { Facade | Facade }` creates a hollow box of four facades (no roof/floor).
4. **Protrude**: Scales and moves shapes for depth effects (pillars, balconies, recessed windows).
5. **Replace**: Transforms geometry type (cube to hexagon, etc.).

### Inverse Procedural Generation (from image to grammar)

The system can derive a split grammar from a segmented facade image:

1. **Input**: Facade photograph + terminal regions image (colored rectangles marking window, wall, door areas).
2. **Splitting algorithm**: Determines split direction by selecting the axis with the most alignment lines. Lines must align with terminal area boundaries for clean separation.
3. **Recursion**: Continue splitting until all regions are terminal or no further splits possible.

### Repetition Detection Algorithm (pseudocode from their documentation)

```
RR = empty  // repeated regions
DR = all split elements that have a duplicate counterpart
While DR is not empty:
    try to merge each duplicate region with a repeated split element
    remove all regions that no longer have duplicates from DR
    attempt to merge together these duplicate areas
    add such merged areas to RR
    remove all regions that no longer have duplicates from DR
Make sure regions in RR do not overlap
return RR
```

### Example Output Grammar

```
Start -> decompose(XZ) {TestBuilding | TestBuilding}
TestBuilding -> split(Y) {1.48: TB1 | 3.98N: TB2 | 0.35: TB3 | 1.15: TB4}
TB2 -> repeat(Y) {0.30: TB5 | 1.02: TB6}
```

This describes proportional vertical divisions with one repeated section. The `N` marker makes buildings stretchable on the Y axis.

---

## 10. Game Engine Approaches

### Cities: Skylines

**Building generation is NOT procedural at the geometry level.** Instead:

1. A grid of **zoning squares** is placed along roads (4x4 default, down to 1x1).
2. Each zone type (residential, commercial, industrial, office) has a **pool of pre-made building models**.
3. When a zone is activated, the game selects a building from the pool that fits the available lot dimensions.
4. Building level (1-5) determines which models are available (higher level = taller/fancier buildings).
5. The procedural element is **placement and selection**, not geometry generation.

### Minecraft Village Generation

1. **Structure sets** control placement using random spread: world is divided into squares of `spacing` chunks, one structure placed per square, with `separation` chunks of buffer.
2. **Frequency parameter** (0.0-1.0) = probability of attempting generation.
3. Village layout: a center well, then streets extend in 4 cardinal directions (3 blocks wide, straight with right-angle intersections).
4. Buildings are **pre-built templates** (NBT structure files) selected based on biome and building type.
5. Sizes range from 1x1 to 4x4 plots.
6. The system does NOT account for terrain elevation -- buildings just sit on whatever ground exists.

### General Game Dev Pattern

The standard approach for game procedural buildings:

1. **Create a set of base assets**: window, corner piece, wall segment, door, ledge, roof piece.
2. **Design procedural rules and configurations**: which assets go where, how they repeat, what varies.
3. **Assemble assets** according to rules: typically grid-based placement with floor/column indices.
4. **Randomize**: seed-based variation in asset selection, color, scale, and detail density.

---

## 11. Proc-GS: Procedural Building Generation with 3D Gaussians (2024)

**Source:** arXiv 2412.07660, CVPR 2025 Workshop.

### Approach

Combines procedural modeling with 3D Gaussian Splatting (3DGS):

1. **Asset Acquisition**: Uses procedural code during 3DGS training to acquire base assets (windows, walls, cornices). Each asset additionally learns a **variance code** for appearance variation and subtle geometry changes.
2. **Asset Assembly**: Manipulates procedural codes to generate diverse buildings and assemble cities.

### Key Innovation

By encoding building structure as procedural code (rather than raw geometry), the system:
- Reduces model size dramatically (shared foundational assets).
- Enables **infinite variety** through code manipulation.
- Provides precise control over building assembly.

Not directly applicable to real-time three.js rendering, but demonstrates the direction the field is moving.

---

## 12. Implementation Recommendations for three.js / threepipe

Based on all research, here is a ranked assessment of approaches:

### Approach A: CGA-Style Split Grammar (Recommended Starting Point)

**Why:** Well-defined algorithm, systematic subdivision, produces high-quality facades, implementable incrementally.

**Pipeline:**
1. Extrude footprint to height -> Building volume
2. `comp(f)` split into front/side/top faces
3. `split(y)` each facade into floors (with `~` flexible sizing)
4. `split(x)` each floor into tiles (with `*` repeat)
5. Nested `split(x)/split(y)` for window frames
6. Instance detail meshes or generate geometry at leaf nodes

**Estimated complexity:** ~800-1200 lines for a basic implementation. Medium difficulty.

### Approach B: Face-Based Module Instancing (Buildify/Houdini Style)

**Why:** More art-directable, works with hand-modeled modules, good for game-ready output.

**Pipeline:**
1. Take input mesh, classify faces by normal direction
2. Slice into floors by height
3. Identify wall/corner/ledge regions
4. Instance modules from a library at each region
5. Handle corners and transitions

**Estimated complexity:** ~600-900 lines for basic, ~1500+ for full corner/ledge handling. Medium-High difficulty.

### Approach C: Parameter-Driven Box Generation (mrdoob Style)

**Why:** Simplest, fastest, good for city-scale visualization.

**Pipeline:**
1. Generate box with random dimensions (power-law distribution for height)
2. Apply canvas-generated window texture
3. Vertex colors for ambient occlusion
4. Merge all geometry

**Estimated complexity:** ~100-200 lines. Low difficulty. Already exists in many forms.

### Approach D: WFC Module Assembly

**Why:** Best visual quality, most architectural coherence. But requires large module library.

**Pipeline:**
1. Define module set with connectors
2. Place seed modules
3. Run WFC propagation
4. Render result

**Estimated complexity:** ~500-800 lines for WFC core, but requires 50-300+ hand-modeled or procedurally-generated modules. High difficulty overall.

---

## Sources

### Buildify
- [Buildify 1.0 on Gumroad](https://paveloliva.gumroad.com/l/buildify)
- [Buildify Documentation (Studylib)](https://studylib.net/doc/26162800/buildify-1.0)
- [Buildify on OSArch](https://community.osarch.org/discussion/1046/buildify-blender-geometry-nodes-add-on-for-customizable-modular-buildings)
- [Buildify on blender-addons.org](https://blender-addons.org/buildify/)

### PBG 2
- [PBG 2 on Gumroad](https://coan.gumroad.com/l/pbg-2)
- [PBG 2 on Superhive/Blender Market](https://superhivemarket.com/products/pbg-2)
- [PBG 2 Documentation (Google Docs)](https://docs.google.com/document/d/1fIAmVV5dSMnwPAobCZwd3tdbuMtB7Rh3-zJoVPaR1mU/edit)
- [80.lv: New Real-Time Procedural Building Generator](https://80.lv/articles/new-real-time-procedural-building-generator-for-blender)
- [CGPress: PBG 2](https://cgpress.org/archives/procedural-building-generator-2-for-blender.html)

### Auto-Building
- [Auto-Building on Gumroad](https://juliengauthier.gumroad.com/l/nzifx)
- [80.lv: Procedural Building System](https://80.lv/articles/a-procedural-building-system-made-with-blender-s-geometry-nodes)
- [80.lv: Auto-Building Updated](https://80.lv/articles/julien-gauthier-s-procedural-building-generator-for-blender-updated)

### Townscaper
- [How Townscaper Works (Game Developer)](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- [Townscaper Grid (Boris the Brave)](https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html)
- [Irregular Grid Reproduction Thread](https://threadreaderapp.com/thread/1261950965189672961.html)
- [Hexagrid Relaxing (GitHub)](https://github.com/kchapelier/hexagrid-relaxing)
- [SketchPunkLabs Irregular Grid](https://sketchpunklabs.github.io/irregular_grid/)
- [Oskar Stalberg's Twitter/X](https://x.com/osksta)

### Wave Function Collapse
- [WFC Algorithm Explained Clearly (Robert Heaton)](https://robertheaton.com/2018/12/17/wavefunction-collapse-algorithm/)
- [WFC Explained (Boris the Brave)](https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/)
- [Infinite Procedural City with WFC (Marian42)](https://marian42.de/article/wfc/)
- [WFC Original Repo (GitHub)](https://github.com/mxgmn/WaveFunctionCollapse)
- [WFC for Building Generation (HAW Hamburg thesis)](https://reposit.haw-hamburg.de/bitstream/20.500.12738/15709/1/BA_Procedural%20Generation%20of%20Buildings_geschw%C3%A4rzt.pdf)

### Three.js Implementations
- [Aljullu's Building Generator (GitHub)](https://github.com/Aljullu/threejs-procedural-building-generator)
- [threex.proceduralcity (GitHub)](https://github.com/jeromeetienne/threex.proceduralcity)
- [Procedural City Generator (GitHub)](https://github.com/photonlines/Procedural-City-Generator)
- [City Tour (GitHub)](https://github.com/jstrait/city-tour)
- [Skyscraper City Generator (Medium)](https://medium.com/@Rototu/making-a-procedural-skyscraper-city-generator-with-three-js-and-webgl2-8f8b721bd044)

### CGA Shape Grammar / Academic
- [CGA Shape Grammar Lecture Notes (UPC)](https://www.cs.upc.edu/~virtual/SGI/docs/1.%20Theory/Unit%2011.%20Procedural%20modeling/CGA%20shape%20grammar.pdf)
- [Understanding CGA Shape Grammar (Penn State)](https://www.e-education.psu.edu/geogvr/node/891)
- [CityEngine Tutorial 6: Basic Shape Grammar](https://doc.arcgis.com/en/cityengine/latest/tutorials/tutorial-6-basic-shape-grammar.htm)
- [CityEngine Tutorial 9: Advanced Shape Grammar](https://doc.arcgis.com/en/cityengine/latest/tutorials/tutorial-9-advanced-shape-grammar.htm)
- [Muller et al., Procedural Modeling of Buildings (ACM TOG 2006)](https://dl.acm.org/doi/10.1145/1141911.1141931)
- [Instant Architecture (ResearchGate)](https://www.researchgate.net/publication/47504041_Instant_Architecture)
- [Citygen: Split Grammar Implementation](https://gylleus.github.io/citygen/)
- [Procedural Facade Modeling (Brown thesis)](https://cs.brown.edu/research/pubs/theses/ugrad/2013/zweig.pdf)

### Houdini
- [Labs Building Generator Documentation](https://www.sidefx.com/docs/houdini/nodes/sop/labs--building_generator-4.0.html)
- [Building Generator Tutorial](https://www.sidefx.com/tutorials/building-generator/)
- [Procedural Building from Modules](https://www.sidefx.com/tutorials/procedural-building-from-modules-in-houdini/)

### Game Engines
- [Cities Skylines Zoning Wiki](https://skylines.paradoxwikis.com/Zoning)
- [Minecraft Structure Sets Wiki](https://minecraft.wiki/w/Structure_set)
- [Proc-GS (arXiv 2412.07660)](https://arxiv.org/abs/2412.07660)

### Cloned Repos (in `.repos/`)
- `.repos/threejs-procedural-building-generator/` -- Aljullu's shape-grammar building generator
- `.repos/Procedural-City-Generator/` -- Photonlines' Perlin noise city generator
- `.repos/city-tour/` -- jstrait's procedural city with fly-through
- `.repos/threex.proceduralcity/` -- mrdoob's classic minimal procedural city
