/**
 * Graph definition for Procedural Buildings (Grid-based).
 * Replicates the "Procedural Building" Blender geometry node tree.
 *
 * Verify: ./plugins/procedural-generation/porting/scripts/compare.sh \
 *           examples/buildify-demo-3/graph.ts /tmp/buildings_gt/all_ground_truth.json
 */

import {
    defineNodeType, defineGraph, connect,
    randomBool, fromLocRotScale,
    type GraphModule, type GeneratedInstance,
} from '@threepipe/plugin-procedural-generation/graph'

// ─── Point type ─────────────────────────────────────────────────────

interface WallPoint {
    x: number; y: number; z: number
    rotZ: number // radians
    sx: number; sy: number; sz: number
}

// ─── Grid sub-group ─────────────────────────────────────────────────
// Creates wall points for 4 faces. Classifies corners vs sides.
// Stores rotation (Euler Z) and scale per point.
// Output Z is shifted by +Z/2 so it ranges from 0 to Z.

function gridSubGroup(X: number, Y: number, Z: number, modLen: number): {sides: WallPoint[], corners: WallPoint[]} {
    const wallX = (X + 1) * modLen / 2
    const wallY = (Y + 1) * modLen / 2
    const threshX = X * modLen / 2 - 1
    const threshY = Y * modLen / 2 - 1

    // Generate one wall face's points from MeshGrid in row-major order (X fastest)
    // Column-major order: horizontal position outer, Z inner (matches Blender's evaluated output)
    function fbWall(y: number, rotZ: number, mixA: number, mixB: number) {
        const s: WallPoint[] = [], c: WallPoint[] = []
        for (let ix = 0; ix <= X; ix++) {
            const px = (ix / X - 0.5) * X * modLen
            const isL = px < -threshX, isR = px > threshX
            const sx = isL ? mixB : mixA
            for (let iz = 0; iz <= Z; iz++) {
                const p: WallPoint = {x: px, y, z: iz, rotZ, sx, sy: 1, sz: 1}
                if (isL || isR) c.push(p); else s.push(p)
            }
        }
        return {s, c}
    }

    // Left/right grid: MeshGrid(verts_x=Z+1, verts_y=Y+1). Source: X outer, Y inner.
    // After Ry(90°): grid-X → world -Z (descending), grid-Y → world Y (ascending).
    function lrWall(x: number, rotZ: number, mixA: number, mixB: number) {
        const s: WallPoint[] = [], c: WallPoint[] = []
        for (let iz = Z; iz >= 0; iz--) { // grid-X outer → world Z descending
            for (let iy = 0; iy <= Y; iy++) { // grid-Y inner → world Y ascending
                const py = (iy / Y - 0.5) * Y * modLen
                const isN = py < -threshY, isP = py > threshY
                const sx = isN ? mixB : mixA
                const p: WallPoint = {x, y: py, z: iz, rotZ, sx, sy: 1, sz: 1}
                if (isN || isP) c.push(p); else s.push(p)
            }
        }
        return {s, c}
    }

    // Generate in Blender's processing order:
    // Front (StoreRot Z=0°), Back (Z=180°), Right (Z=90°), Left (Z=-90°)
    const front = fbWall(-wallY, 0, 1, -1) // Mix: A=[1,1,1] B=[-1,1,1]
    const back = fbWall(wallY, Math.PI, -1, 1) // Mix: A=[-1,1,1] B=[1,1,1]
    const right = lrWall(wallX, Math.PI / 2, 1, -1) // Mix: A=[1,1,1] B=[-1,1,1]
    const left = lrWall(-wallX, -Math.PI / 2, -1, 1) // Mix: A=[-1,1,1] B=[1,1,1]

    // Join order: front+back then right+left (matching Blender's Join Geometry wiring)
    const sides = [...front.s, ...back.s, ...right.s, ...left.s]
    const corners = [...front.c, ...back.c, ...right.c, ...left.c]

    return {sides, corners}
}

// ─── Modules height sub-group ───────────────────────────────────────
// Transform: z' = z * winH + (gfH - winH)

function modulesHeight(points: WallPoint[], gfHeight: number, winHeight: number): WallPoint[] {
    const off = gfHeight - winHeight
    return points.map(p => ({...p, z: p.z * winHeight + off}))
}

// ─── Separate GF (bottom row at minimum Z) ──────────────────────────

function separateGF(points: WallPoint[]): {gf: WallPoint[], upper: WallPoint[]} {
    let minZ = Infinity
    for (const p of points) if (p.z < minZ) minZ = p.z
    const gf: WallPoint[] = []
    const upper: WallPoint[] = []
    for (const p of points) {
        if (Math.abs(p.z - minZ) < 0.01) gf.push({...p, z: 0})
        else upper.push(p)
    }
    return {gf, upper}
}

// ─── Top floor sub-group ────────────────────────────────────────────
// Translate Z by (Z + 1) * winH + divH

function topFloorTranslate(points: WallPoint[], Z: number, winHeight: number, divHeight: number): WallPoint[] {
    const dz = Z * winHeight + divHeight
    return points.map(p => ({...p, z: p.z + dz}))
}

// ─── Windows points (top-level sub-group) ───────────────────────────

function windowsPoints(
    X: number, Y: number, Z: number, topFloors: number,
    modLen: number, gfH: number, winH: number, divH: number,
) {
    // Main grid → Modules height → separate GF
    const main = gridSubGroup(X, Y, Z, modLen)
    const mhSides = modulesHeight(main.sides, gfH, winH)
    const mhCorners = modulesHeight(main.corners, gfH, winH)
    const gfS = separateGF(mhSides)
    const gfC = separateGF(mhCorners)

    // Top floor grid (smaller: topFloors levels) → Modules height → separate GF → translate
    let tfSide: WallPoint[] = []
    let tfCorner: WallPoint[] = []
    if (topFloors > 0) {
        const tfGrid = gridSubGroup(X, Y, topFloors, modLen)
        const tfMhS = modulesHeight(tfGrid.sides, gfH, winH)
        const tfMhC = modulesHeight(tfGrid.corners, gfH, winH)
        const tfGfS = separateGF(tfMhS)
        const tfGfC = separateGF(tfMhC)
        tfSide = topFloorTranslate(tfGfS.upper, Z, winH, divH)
        tfCorner = topFloorTranslate(tfGfC.upper, Z, winH, divH)
    }

    return {
        gf: gfS.gf, gfCorner: gfC.gf,
        window: gfS.upper, windowCorner: gfC.upper,
        topFloorSide: tfSide, topFloorCorner: tfCorner,
    }
}

// ─── Roof points (top-level sub-group) ──────────────────────────────
// Inner grid (no +1 offset), all scale [1,1,1].
// Corner rotations: clockwise assignment from the wall to its left.

function roofPointsFn(
    X: number, Y: number, Z: number, topFloors: number,
    modLen: number, gfH: number, winH: number, divH: number,
) {
    const divZ = gfH + Z * winH
    const roofZ = gfH + Z * winH + divH + topFloors * winH
    const innerX = X * modLen / 2
    const innerY = Y * modLen / 2

    function innerWallPoints(z: number) {
        const side: WallPoint[] = []
        const corner: WallPoint[] = []

        // Front (y=-innerY): X-1 inner points
        for (let ix = 1; ix < X; ix++) {
            const px = (ix / X - 0.5) * X * modLen
            side.push({x: px, y: -innerY, z, rotZ: 0, sx: 1, sy: 1, sz: 1})
        }
        // Back (y=+innerY)
        for (let ix = 1; ix < X; ix++) {
            const px = (ix / X - 0.5) * X * modLen
            side.push({x: px, y: innerY, z, rotZ: Math.PI, sx: 1, sy: 1, sz: 1})
        }
        // Left (x=-innerX)
        for (let iy = 1; iy < Y; iy++) {
            const py = (iy / Y - 0.5) * Y * modLen
            side.push({x: -innerX, y: py, z, rotZ: -Math.PI / 2, sx: 1, sy: 1, sz: 1})
        }
        // Right (x=+innerX)
        for (let iy = 1; iy < Y; iy++) {
            const py = (iy / Y - 0.5) * Y * modLen
            side.push({x: innerX, y: py, z, rotZ: Math.PI / 2, sx: 1, sy: 1, sz: 1})
        }

        // Corners: clockwise rotation assignment
        corner.push({x: -innerX, y: -innerY, z, rotZ: -Math.PI / 2, sx: 1, sy: 1, sz: 1})
        corner.push({x: innerX, y: -innerY, z, rotZ: 0, sx: 1, sy: 1, sz: 1})
        corner.push({x: innerX, y: innerY, z, rotZ: Math.PI / 2, sx: 1, sy: 1, sz: 1})
        corner.push({x: -innerX, y: innerY, z, rotZ: Math.PI, sx: 1, sy: 1, sz: 1})

        return {side, corner}
    }

    const div = innerWallPoints(divZ)
    const roof = innerWallPoints(roofZ)

    // Roof middle points (interior grid)
    const roofMiddle: WallPoint[] = []
    for (let ix = 1; ix < X; ix++) {
        for (let iy = 1; iy < Y; iy++) {
            const px = (ix / X - 0.5) * X * modLen
            const py = (iy / Y - 0.5) * Y * modLen
            roofMiddle.push({x: px, y: py, z: roofZ, rotZ: 0, sx: 1, sy: 1, sz: 1})
        }
    }

    return {
        divSide: div.side, divCorner: div.corner,
        roofSide: roof.side, roofMiddle, roofCorner: roof.corner,
    }
}

// ─── Instance generation ────────────────────────────────────────────

function pointsToInstances(points: WallPoint[], objectName: string, originX: number): GeneratedInstance[] {
    return points.map(p => ({
        world_matrix: fromLocRotScale(p.x + originX, p.y, p.z, 0, 0, p.rotZ, p.sx, p.sy, p.sz),
        object_name: objectName,
    }))
}

/** Instance on Points with Pick Instance: picks member[index % members.length] per point.
 *  The implicit Instance Index is the ID field (node_geo_input_id.cc):
 *  "id attribute on points, or the index if that attribute does not exist".
 *  MeshGrid doesn't set an id attribute, so it falls back to sequential index.
 *  source: node_geo_instance_on_points.cc line 118-121 */
function filteredToInstances(filtered: FilteredPoint[], members: string[], originX: number): GeneratedInstance[] {
    if (members.length === 0) return []
    const n = members.length
    return filtered.map((f, i) => ({
        world_matrix: fromLocRotScale(f.point.x + originX, f.point.y, f.point.z, 0, 0, f.point.rotZ, f.point.sx, f.point.sy, f.point.sz),
        object_name: members[i % n],
    }))
}

// ─── Extra sub-group ────────────────────────────────────────────────
// Filters window + top floor points by density, instances with collection.
// Flow: join(window sides filtered by includeWindows, top floor sides filtered by includeTopFloors)
//     → mapRange(amount, 0, 100, 0, 1) → randomBool(probability, pointIndex, seed) → filter

/** Filtered point with its original pre-filter index (the "id" attribute in Blender). */
interface FilteredPoint { point: WallPoint; id: number }

function extraFilter(
    windowSide: WallPoint[], windowCorner: WallPoint[],
    topFloorSide: WallPoint[], topFloorCorner: WallPoint[],
    amount: number, seed: number,
    includeWindows: boolean, includeTopFloors: boolean,
): FilteredPoint[] {
    const points: WallPoint[] = []
    if (includeWindows) points.push(...windowSide, ...windowCorner)
    if (includeTopFloors) points.push(...topFloorSide, ...topFloorCorner)

    const probability = amount / 100
    // Keep original index as "id" — Instance on Points uses id attribute for Pick Instance
    // (source: node_geo_input_id.cc — "id attribute on points, or the index if not exist")
    const result: FilteredPoint[] = []
    for (let i = 0; i < points.length; i++) {
        if (randomBool(probability, i, seed)) result.push({point: points[i], id: i})
    }
    return result
}

function gfExtraFilter(
    gfSide: WallPoint[], gfCorner: WallPoint[],
    amount: number, seed: number,
    includeSides: boolean, includeCorners: boolean,
): FilteredPoint[] {
    const points: WallPoint[] = []
    if (includeSides) points.push(...gfSide)
    if (includeCorners) points.push(...gfCorner)

    const probability = amount / 100
    const result: FilteredPoint[] = []
    for (let i = 0; i < points.length; i++) {
        if (randomBool(probability, i, seed)) result.push({point: points[i], id: i})
    }
    return result
}

// ─── Asset options for dropdowns ────────────────────────────────────

const wallModuleOptions = (prefix: string) => {
    const p = (name: string) => `object_${prefix}_${name}.glb`
    return [p('Ground_floor'), p('Ground_floor_corner'), p('Window'), p('Window_corner'),
        p('Top_floor_window'), p('Top_floor_window_corner'), p('Top_floors_div'),
        p('Top_floors_div_corner'), p('Roof_side'), p('Roof_middle'), p('Roof_corner')]
}
const allModuleOptions = [...new Set(['B1', 'B2', 'B3'].flatMap(wallModuleOptions))]
const modOpts = {options: allModuleOptions}

// ─── Single building node type ──────────────────────────────────────
// All modifier inputs in one node, matching Blender's modifier panel.

const ProceduralBuildingType = defineNodeType(
    {
        // Dimensions
        X: {default: 5, ui: {label: 'X', bounds: [1, 15], stepSize: 1}},
        Y: {default: 3, ui: {label: 'Y', bounds: [1, 15], stepSize: 1}},
        Z: {default: 5, ui: {label: 'Z (floors)', bounds: [1, 15], stepSize: 1}},
        topFloors: {default: 2, ui: {label: 'Top floors', bounds: [0, 5], stepSize: 1}},
        modLen: {default: 3.0, ui: {label: 'Modules length', bounds: [1.5, 6.0], stepSize: 0.1}},
        gfHeight: {default: 3.5, ui: {label: 'GF height', bounds: [2.0, 6.0], stepSize: 0.1}},
        winHeight: {default: 4.0, ui: {label: 'Window height', bounds: [2.0, 6.0], stepSize: 0.1}},
        divHeight: {default: 0.6, ui: {label: 'Div height', bounds: [0.1, 2.0], stepSize: 0.1}},
        // Module slots (ObjectInfo equivalents)
        gfObj: {default: 'object_B1_Ground_floor.glb', ui: {label: 'GF', ...modOpts}},
        gfCornerObj: {default: 'object_B1_Ground_floor_corner.glb', ui: {label: 'GF corner', ...modOpts}},
        windowObj: {default: 'object_B1_Window.glb', ui: {label: 'Window', ...modOpts}},
        windowCornerObj: {default: 'object_B1_Window_corner.glb', ui: {label: 'Window corner', ...modOpts}},
        tfWindowObj: {default: 'object_B1_Top_floor_window.glb', ui: {label: 'TF window', ...modOpts}},
        tfWindowCornerObj: {default: 'object_B1_Top_floor_window_corner.glb', ui: {label: 'TF window corner', ...modOpts}},
        divSideObj: {default: 'object_B1_Top_floors_div.glb', ui: {label: 'Div side', ...modOpts}},
        divCornerObj: {default: 'object_B1_Top_floors_div_corner.glb', ui: {label: 'Div corner', ...modOpts}},
        roofSideObj: {default: 'object_B1_Roof_side.glb', ui: {label: 'Roof side', ...modOpts}},
        roofMiddleObj: {default: 'object_B1_Roof_middle.glb', ui: {label: 'Roof middle', ...modOpts}},
        roofCornerObj: {default: 'object_B1_Roof_corner.glb', ui: {label: 'Roof corner', ...modOpts}},
        // Extra controls
        extra1Amount: {default: 50, ui: {label: 'Extra 1 Amount', bounds: [0, 100], stepSize: 1}},
        extra1Seed: {default: 1, ui: {label: 'Extra 1 Seed', bounds: [0, 100], stepSize: 1}},
        extra1InclWin: {default: true, ui: {label: 'Extra 1 Incl. windows'}},
        extra1InclTF: {default: false, ui: {label: 'Extra 1 Incl. top floors'}},
        extra2Amount: {default: 50, ui: {label: 'Extra 2 Amount', bounds: [0, 100], stepSize: 1}},
        extra2Seed: {default: 1, ui: {label: 'Extra 2 Seed', bounds: [0, 100], stepSize: 1}},
        extra2InclWin: {default: true, ui: {label: 'Extra 2 Incl. windows'}},
        extra2InclTF: {default: true, ui: {label: 'Extra 2 Incl. top floors'}},
        gfExtra1Amount: {default: 50, ui: {label: 'GF Extra 1 Amount', bounds: [0, 100], stepSize: 1}},
        gfExtra1Seed: {default: 1, ui: {label: 'GF Extra 1 Seed', bounds: [0, 100], stepSize: 1}},
        gfExtra1InclSides: {default: true, ui: {label: 'GF Extra 1 Incl. sides'}},
        gfExtra1InclCorners: {default: true, ui: {label: 'GF Extra 1 Incl. corners'}},
        gfExtra2Amount: {default: 50, ui: {label: 'GF Extra 2 Amount', bounds: [0, 100], stepSize: 1}},
        gfExtra2Seed: {default: 1, ui: {label: 'GF Extra 2 Seed', bounds: [0, 100], stepSize: 1}},
        gfExtra2InclSides: {default: true, ui: {label: 'GF Extra 2 Incl. sides'}},
        gfExtra2InclCorners: {default: true, ui: {label: 'GF Extra 2 Incl. corners'}},
        // Collection members (internal — arrays of GLB filenames)
        extra1Members: [] as string[],
        extra2Members: [] as string[],
        gfExtra1Members: [] as string[],
        gfExtra2Members: [] as string[],
        // Internal (won't appear in UI)
        originX: 0,
    },
    {instances: [] as GeneratedInstance[]},
    (inp) => {
        const {X, Y, Z, topFloors, modLen, gfHeight: gfH, winHeight: winH, divHeight: divH, originX} = inp

        // Windows + Roof points
        const wp = windowsPoints(X, Y, Z, topFloors, modLen, gfH, winH, divH)
        const rp = roofPointsFn(X, Y, Z, topFloors, modLen, gfH, winH, divH)

        // Wall instances
        const walls = [
            ...pointsToInstances(wp.gf, inp.gfObj, originX),
            ...pointsToInstances(wp.gfCorner, inp.gfCornerObj, originX),
            ...pointsToInstances(wp.window, inp.windowObj, originX),
            ...pointsToInstances(wp.windowCorner, inp.windowCornerObj, originX),
            ...pointsToInstances(wp.topFloorSide, inp.tfWindowObj, originX),
            ...pointsToInstances(wp.topFloorCorner, inp.tfWindowCornerObj, originX),
            ...pointsToInstances(rp.divSide, inp.divSideObj, originX),
            ...pointsToInstances(rp.divCorner, inp.divCornerObj, originX),
            ...pointsToInstances(rp.roofSide, inp.roofSideObj, originX),
            ...pointsToInstances(rp.roofMiddle, inp.roofMiddleObj, originX),
            ...pointsToInstances(rp.roofCorner, inp.roofCornerObj, originX),
        ]

        // Extras
        const ex1pts = extraFilter(wp.window, wp.windowCorner, wp.topFloorSide, wp.topFloorCorner,
            inp.extra1Amount, inp.extra1Seed, inp.extra1InclWin, inp.extra1InclTF)
        const ex2pts = extraFilter(wp.window, wp.windowCorner, wp.topFloorSide, wp.topFloorCorner,
            inp.extra2Amount, inp.extra2Seed, inp.extra2InclWin, inp.extra2InclTF)
        const gfe1pts = gfExtraFilter(wp.gf, wp.gfCorner,
            inp.gfExtra1Amount, inp.gfExtra1Seed, inp.gfExtra1InclSides, inp.gfExtra1InclCorners)
        const gfe2pts = gfExtraFilter(wp.gf, wp.gfCorner,
            inp.gfExtra2Amount, inp.gfExtra2Seed, inp.gfExtra2InclSides, inp.gfExtra2InclCorners)

        const extras = [
            ...filteredToInstances(ex1pts, inp.extra1Members, originX),
            ...filteredToInstances(ex2pts, inp.extra2Members, originX),
            ...filteredToInstances(gfe1pts, inp.gfExtra1Members, originX),
            ...filteredToInstances(gfe2pts, inp.gfExtra2Members, originX),
        ]

        return {instances: [...walls, ...extras]}
    },
)

// ─── 3 Buildings ────────────────────────────────────────────────────

function b(prefix: string) {
    const p = (name: string) => `object_${prefix}_${name}.glb`
    return {
        gfObj: p('Ground_floor'), gfCornerObj: p('Ground_floor_corner'),
        windowObj: p('Window'), windowCornerObj: p('Window_corner'),
        tfWindowObj: p('Top_floor_window'), tfWindowCornerObj: p('Top_floor_window_corner'),
        divSideObj: p('Top_floors_div'), divCornerObj: p('Top_floors_div_corner'),
        roofSideObj: p('Roof_side'), roofMiddleObj: p('Roof_middle'), roofCornerObj: p('Roof_corner'),
    }
}

const b1 = ProceduralBuildingType('Building 1', {
    X: 5, Y: 3, Z: 5, topFloors: 2, modLen: 3, gfHeight: 3.5, winHeight: 4, divHeight: 0.6000000238418579,
    originX: -0.09106839448213577, ...b('B1'),
    extra1Members: ['object_B1_Awning.glb'], extra1Amount: 50, extra1Seed: 1, extra1InclWin: true, extra1InclTF: false,
    extra2Members: ['object_B1_Plants.glb', 'object_B1_Plants_001.glb', 'object_B1_Plants_002.glb', 'object_B1_Plants_003.glb'],
    extra2Amount: 50, extra2Seed: 1, extra2InclWin: true, extra2InclTF: true,
    gfExtra1Members: ['object_B1_GF_plant.glb'], gfExtra1Amount: 50, gfExtra1Seed: 1, gfExtra1InclSides: true, gfExtra1InclCorners: true,
    gfExtra2Members: ['object_B1_GF_awning.glb'], gfExtra2Amount: 50, gfExtra2Seed: 1, gfExtra2InclSides: true, gfExtra2InclCorners: true,
})

const b2 = ProceduralBuildingType('Building 2', {
    X: 8, Y: 5, Z: 5, topFloors: 1, modLen: 2, gfHeight: 3.5, winHeight: 3.799999952316284, divHeight: 0.4000000059604645,
    originX: -30.8080997467041, ...b('B2'),
    extra1Members: ['object_B2_Air.glb'], extra1Amount: 50, extra1Seed: 2, extra1InclWin: true, extra1InclTF: false,
    extra2Members: ['object_B2_Balcony.glb'], extra2Amount: 50, extra2Seed: 2, extra2InclWin: true, extra2InclTF: true,
    gfExtra1Members: ['object_B2_GF_Plant.glb'], gfExtra1Amount: 50, gfExtra1Seed: 2, gfExtra1InclSides: true, gfExtra1InclCorners: true,
    gfExtra2Members: ['object_B2_GF_awning.glb'], gfExtra2Amount: 50, gfExtra2Seed: 2, gfExtra2InclSides: true, gfExtra2InclCorners: true,
})

const b3 = ProceduralBuildingType('Building 3', {
    X: 5, Y: 4, Z: 5, topFloors: 1, modLen: 2.5999999046325684, gfHeight: 3.799999952316284, winHeight: 3.5, divHeight: 0.4000000059604645,
    originX: 26.19099998474121, ...b('B3'),
    extra1Members: ['object_B3_Air.glb', 'object_B3_Air_001.glb', 'object_B3_Plants.glb', 'object_B3_Plants_001.glb', 'object_B3_Plants_002.glb', 'object_B3_Plants_003.glb', 'object_B3_Plants_004.glb', 'object_B3_Plants_005.glb'],
    extra1Amount: 50, extra1Seed: 3, extra1InclWin: true, extra1InclTF: false,
    extra2Members: ['object_B3_Awning.glb'], extra2Amount: 50, extra2Seed: 3, extra2InclWin: true, extra2InclTF: true,
    gfExtra1Members: ['object_B3_GF_awning.glb'], gfExtra1Amount: 100, gfExtra1Seed: 3, gfExtra1InclSides: true, gfExtra1InclCorners: false,
    gfExtra2Members: ['object_B3_GF_awning_2.glb'], gfExtra2Amount: 100, gfExtra2Seed: 3, gfExtra2InclSides: false, gfExtra2InclCorners: true,
})

const graph = defineGraph([b1, b2, b3], [])

// Collect all asset filenames from the assets directory
const allAssets: string[] = []
const addAssets = (...names: string[]) => names.forEach(n => { if (!allAssets.includes(n)) allAssets.push(n) })
for (const prefix of ['B1', 'B2', 'B3']) {
    const p = (name: string) => `object_${prefix}_${name}.glb`
    addAssets(p('Ground_floor'), p('Ground_floor_corner'), p('Window'), p('Window_corner'),
        p('Top_floor_window'), p('Top_floor_window_corner'), p('Top_floors_div'), p('Top_floors_div_corner'),
        p('Roof_side'), p('Roof_middle'), p('Roof_corner'))
}
// Extra member GLBs
for (const node of [b1, b2, b3]) {
    const d = node.inputDefs as any
    for (const key of ['extra1Members', 'extra2Members', 'gfExtra1Members', 'gfExtra2Members']) {
        const arr = d[key] as string[] | undefined
        if (arr) addAssets(...arr)
    }
}

export const graphModule: GraphModule = {
    graph,
    outputs: [{node: b1, output: 'instances'}, {node: b2, output: 'instances'}, {node: b3, output: 'instances'}],
    assets: allAssets,
    assetsPath: './assets/',
}
