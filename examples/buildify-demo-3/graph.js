/**
 * Graph definition for Procedural Buildings (Grid-based).
 * Replicates the "Procedural Building" Blender geometry node tree.
 *
 * Verify: ./plugins/procedural-generation/porting/scripts/compare.sh \
 *           examples/buildify-demo-3/graph.ts /tmp/buildings_gt/all_ground_truth.json
 */
import { defineNodeType, defineGraph, connect, randomBool, fromLocRotScale, } from '@threepipe/plugin-procedural-generation/graph';
// ─── Grid sub-group ─────────────────────────────────────────────────
// Creates wall points for 4 faces. Classifies corners vs sides.
// Stores rotation (Euler Z) and scale per point.
// Output Z is shifted by +Z/2 so it ranges from 0 to Z.
function gridSubGroup(X, Y, Z, modLen) {
    const wallX = (X + 1) * modLen / 2;
    const wallY = (Y + 1) * modLen / 2;
    const threshX = X * modLen / 2 - 1;
    const threshY = Y * modLen / 2 - 1;
    // Generate one wall face's points from MeshGrid in row-major order (X fastest)
    // Column-major order: horizontal position outer, Z inner (matches Blender's evaluated output)
    function fbWall(y, rotZ, mixA, mixB) {
        const s = [], c = [];
        for (let ix = 0; ix <= X; ix++) {
            const px = (ix / X - 0.5) * X * modLen;
            const isL = px < -threshX, isR = px > threshX;
            const sx = isL ? mixB : mixA;
            for (let iz = 0; iz <= Z; iz++) {
                const p = { x: px, y, z: iz, rotZ, sx, sy: 1, sz: 1 };
                if (isL || isR)
                    c.push(p);
                else
                    s.push(p);
            }
        }
        return { s, c };
    }
    // Left/right grid: MeshGrid(verts_x=Z+1, verts_y=Y+1). Source: X outer, Y inner.
    // After Ry(90°): grid-X → world -Z (descending), grid-Y → world Y (ascending).
    function lrWall(x, rotZ, mixA, mixB) {
        const s = [], c = [];
        for (let iz = Z; iz >= 0; iz--) { // grid-X outer → world Z descending
            for (let iy = 0; iy <= Y; iy++) { // grid-Y inner → world Y ascending
                const py = (iy / Y - 0.5) * Y * modLen;
                const isN = py < -threshY, isP = py > threshY;
                const sx = isN ? mixB : mixA;
                const p = { x, y: py, z: iz, rotZ, sx, sy: 1, sz: 1 };
                if (isN || isP)
                    c.push(p);
                else
                    s.push(p);
            }
        }
        return { s, c };
    }
    // Generate in Blender's processing order:
    // Front (StoreRot Z=0°), Back (Z=180°), Right (Z=90°), Left (Z=-90°)
    const front = fbWall(-wallY, 0, 1, -1); // Mix: A=[1,1,1] B=[-1,1,1]
    const back = fbWall(wallY, Math.PI, -1, 1); // Mix: A=[-1,1,1] B=[1,1,1]
    const right = lrWall(wallX, Math.PI / 2, 1, -1); // Mix: A=[1,1,1] B=[-1,1,1]
    const left = lrWall(-wallX, -Math.PI / 2, -1, 1); // Mix: A=[-1,1,1] B=[1,1,1]
    // Join order: front+back then right+left (matching Blender's Join Geometry wiring)
    const sides = [...front.s, ...back.s, ...right.s, ...left.s];
    const corners = [...front.c, ...back.c, ...right.c, ...left.c];
    return { sides, corners };
}
// ─── Modules height sub-group ───────────────────────────────────────
// Transform: z' = z * winH + (gfH - winH)
function modulesHeight(points, gfHeight, winHeight) {
    const off = gfHeight - winHeight;
    return points.map(p => ({ ...p, z: p.z * winHeight + off }));
}
// ─── Separate GF (bottom row at minimum Z) ──────────────────────────
function separateGF(points) {
    let minZ = Infinity;
    for (const p of points)
        if (p.z < minZ)
            minZ = p.z;
    const gf = [];
    const upper = [];
    for (const p of points) {
        if (Math.abs(p.z - minZ) < 0.01)
            gf.push({ ...p, z: 0 });
        else
            upper.push(p);
    }
    return { gf, upper };
}
// ─── Top floor sub-group ────────────────────────────────────────────
// Translate Z by (Z + 1) * winH + divH
function topFloorTranslate(points, Z, winHeight, divHeight) {
    const dz = Z * winHeight + divHeight;
    return points.map(p => ({ ...p, z: p.z + dz }));
}
// ─── Windows points (top-level sub-group) ───────────────────────────
function windowsPoints(X, Y, Z, topFloors, modLen, gfH, winH, divH) {
    // Main grid → Modules height → separate GF
    const main = gridSubGroup(X, Y, Z, modLen);
    const mhSides = modulesHeight(main.sides, gfH, winH);
    const mhCorners = modulesHeight(main.corners, gfH, winH);
    const gfS = separateGF(mhSides);
    const gfC = separateGF(mhCorners);
    // Top floor grid (smaller: topFloors levels) → Modules height → separate GF → translate
    let tfSide = [];
    let tfCorner = [];
    if (topFloors > 0) {
        const tfGrid = gridSubGroup(X, Y, topFloors, modLen);
        const tfMhS = modulesHeight(tfGrid.sides, gfH, winH);
        const tfMhC = modulesHeight(tfGrid.corners, gfH, winH);
        const tfGfS = separateGF(tfMhS);
        const tfGfC = separateGF(tfMhC);
        tfSide = topFloorTranslate(tfGfS.upper, Z, winH, divH);
        tfCorner = topFloorTranslate(tfGfC.upper, Z, winH, divH);
    }
    return {
        gf: gfS.gf, gfCorner: gfC.gf,
        window: gfS.upper, windowCorner: gfC.upper,
        topFloorSide: tfSide, topFloorCorner: tfCorner,
    };
}
// ─── Roof points (top-level sub-group) ──────────────────────────────
// Inner grid (no +1 offset), all scale [1,1,1].
// Corner rotations: clockwise assignment from the wall to its left.
function roofPointsFn(X, Y, Z, topFloors, modLen, gfH, winH, divH) {
    const divZ = gfH + Z * winH;
    const roofZ = gfH + Z * winH + divH + topFloors * winH;
    const innerX = X * modLen / 2;
    const innerY = Y * modLen / 2;
    function innerWallPoints(z) {
        const side = [];
        const corner = [];
        // Front (y=-innerY): X-1 inner points
        for (let ix = 1; ix < X; ix++) {
            const px = (ix / X - 0.5) * X * modLen;
            side.push({ x: px, y: -innerY, z, rotZ: 0, sx: 1, sy: 1, sz: 1 });
        }
        // Back (y=+innerY)
        for (let ix = 1; ix < X; ix++) {
            const px = (ix / X - 0.5) * X * modLen;
            side.push({ x: px, y: innerY, z, rotZ: Math.PI, sx: 1, sy: 1, sz: 1 });
        }
        // Left (x=-innerX)
        for (let iy = 1; iy < Y; iy++) {
            const py = (iy / Y - 0.5) * Y * modLen;
            side.push({ x: -innerX, y: py, z, rotZ: -Math.PI / 2, sx: 1, sy: 1, sz: 1 });
        }
        // Right (x=+innerX)
        for (let iy = 1; iy < Y; iy++) {
            const py = (iy / Y - 0.5) * Y * modLen;
            side.push({ x: innerX, y: py, z, rotZ: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
        }
        // Corners: clockwise rotation assignment
        corner.push({ x: -innerX, y: -innerY, z, rotZ: -Math.PI / 2, sx: 1, sy: 1, sz: 1 });
        corner.push({ x: innerX, y: -innerY, z, rotZ: 0, sx: 1, sy: 1, sz: 1 });
        corner.push({ x: innerX, y: innerY, z, rotZ: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
        corner.push({ x: -innerX, y: innerY, z, rotZ: Math.PI, sx: 1, sy: 1, sz: 1 });
        return { side, corner };
    }
    const div = innerWallPoints(divZ);
    const roof = innerWallPoints(roofZ);
    // Roof middle points (interior grid)
    const roofMiddle = [];
    for (let ix = 1; ix < X; ix++) {
        for (let iy = 1; iy < Y; iy++) {
            const px = (ix / X - 0.5) * X * modLen;
            const py = (iy / Y - 0.5) * Y * modLen;
            roofMiddle.push({ x: px, y: py, z: roofZ, rotZ: 0, sx: 1, sy: 1, sz: 1 });
        }
    }
    return {
        divSide: div.side, divCorner: div.corner,
        roofSide: roof.side, roofMiddle, roofCorner: roof.corner,
    };
}
// ─── Instance generation ────────────────────────────────────────────
function pointsToInstances(points, objectName, originX) {
    return points.map(p => ({
        world_matrix: fromLocRotScale(p.x + originX, p.y, p.z, 0, 0, p.rotZ, p.sx, p.sy, p.sz),
        object_name: objectName,
    }));
}
/** Instance on Points with Pick Instance: picks member[index % members.length] per point.
 *  The implicit Instance Index is the ID field (node_geo_input_id.cc):
 *  "id attribute on points, or the index if that attribute does not exist".
 *  MeshGrid doesn't set an id attribute, so it falls back to sequential index.
 *  source: node_geo_instance_on_points.cc line 118-121 */
function filteredToInstances(filtered, members, originX) {
    if (members.length === 0)
        return [];
    const n = members.length;
    return filtered.map((f, i) => ({
        world_matrix: fromLocRotScale(f.point.x + originX, f.point.y, f.point.z, 0, 0, f.point.rotZ, f.point.sx, f.point.sy, f.point.sz),
        object_name: members[i % n],
    }));
}
function extraFilter(windowSide, windowCorner, topFloorSide, topFloorCorner, amount, seed, includeWindows, includeTopFloors) {
    const points = [];
    if (includeWindows)
        points.push(...windowSide, ...windowCorner);
    if (includeTopFloors)
        points.push(...topFloorSide, ...topFloorCorner);
    const probability = amount / 100;
    // Keep original index as "id" — Instance on Points uses id attribute for Pick Instance
    // (source: node_geo_input_id.cc — "id attribute on points, or the index if not exist")
    const result = [];
    for (let i = 0; i < points.length; i++) {
        if (randomBool(probability, i, seed))
            result.push({ point: points[i], id: i });
    }
    return result;
}
function gfExtraFilter(gfSide, gfCorner, amount, seed, includeSides, includeCorners) {
    const points = [];
    if (includeSides)
        points.push(...gfSide);
    if (includeCorners)
        points.push(...gfCorner);
    const probability = amount / 100;
    const result = [];
    for (let i = 0; i < points.length; i++) {
        if (randomBool(probability, i, seed))
            result.push({ point: points[i], id: i });
    }
    return result;
}
// ─── Node types (top-level, matching Blender's node editor) ─────────
const allModuleOptions = [...new Set(['B1', 'B2', 'B3'].flatMap(prefix => {
        const p = (name) => `object_${prefix}_${name}.glb`;
        return [p('Ground_floor'), p('Ground_floor_corner'), p('Window'), p('Window_corner'),
            p('Top_floor_window'), p('Top_floor_window_corner'), p('Top_floors_div'),
            p('Top_floors_div_corner'), p('Roof_side'), p('Roof_middle'), p('Roof_corner')];
    }))];
const modOpts = { options: allModuleOptions };
// Group Input — all 40 modifier inputs. Outputs mirror inputs (pass-through).
// This is the equivalent of Blender's Group Input nodes.
const GroupInputType = defineNodeType({
    // Dimensions
    X: { default: 5, ui: { label: 'X', bounds: [1, 15], stepSize: 1 } },
    Y: { default: 3, ui: { label: 'Y', bounds: [1, 15], stepSize: 1 } },
    Z: { default: 5, ui: { label: 'Z (floors)', bounds: [1, 15], stepSize: 1 } },
    topFloors: { default: 2, ui: { label: 'Top floors', bounds: [0, 5], stepSize: 1 } },
    modLen: { default: 3.0, ui: { label: 'Modules length', bounds: [1.5, 6.0], stepSize: 0.1 } },
    gfHeight: { default: 3.5, ui: { label: 'GF height', bounds: [2.0, 6.0], stepSize: 0.1 } },
    winHeight: { default: 4.0, ui: { label: 'Window height', bounds: [2.0, 6.0], stepSize: 0.1 } },
    divHeight: { default: 0.6, ui: { label: 'Div height', bounds: [0.1, 2.0], stepSize: 0.1 } },
    // Module objects
    gfObj: { default: '', ui: { label: 'GF', ...modOpts } },
    gfCornerObj: { default: '', ui: { label: 'GF corner', ...modOpts } },
    windowObj: { default: '', ui: { label: 'Window', ...modOpts } },
    windowCornerObj: { default: '', ui: { label: 'Window corner', ...modOpts } },
    tfWindowObj: { default: '', ui: { label: 'TF window', ...modOpts } },
    tfWindowCornerObj: { default: '', ui: { label: 'TF window corner', ...modOpts } },
    divSideObj: { default: '', ui: { label: 'Div side', ...modOpts } },
    divCornerObj: { default: '', ui: { label: 'Div corner', ...modOpts } },
    roofSideObj: { default: '', ui: { label: 'Roof side', ...modOpts } },
    roofMiddleObj: { default: '', ui: { label: 'Roof middle', ...modOpts } },
    roofCornerObj: { default: '', ui: { label: 'Roof corner', ...modOpts } },
    // Extra 1
    extra1Members: [],
    extra1Amount: { default: 50, ui: { label: 'Extra 1 Amount', bounds: [0, 100], stepSize: 1 } },
    extra1Seed: { default: 1, ui: { label: 'Extra 1 Seed', bounds: [0, 100], stepSize: 1 } },
    extra1InclWin: { default: true, ui: { label: 'Extra 1 Incl. windows' } },
    extra1InclTF: { default: false, ui: { label: 'Extra 1 Incl. top floors' } },
    // Extra 2
    extra2Members: [],
    extra2Amount: { default: 50, ui: { label: 'Extra 2 Amount', bounds: [0, 100], stepSize: 1 } },
    extra2Seed: { default: 1, ui: { label: 'Extra 2 Seed', bounds: [0, 100], stepSize: 1 } },
    extra2InclWin: { default: true, ui: { label: 'Extra 2 Incl. windows' } },
    extra2InclTF: { default: true, ui: { label: 'Extra 2 Incl. top floors' } },
    // GF Extra 1
    gfExtra1Members: [],
    gfExtra1Amount: { default: 50, ui: { label: 'GF Extra 1 Amount', bounds: [0, 100], stepSize: 1 } },
    gfExtra1Seed: { default: 1, ui: { label: 'GF Extra 1 Seed', bounds: [0, 100], stepSize: 1 } },
    gfExtra1InclSides: { default: true, ui: { label: 'GF Extra 1 Incl. sides' } },
    gfExtra1InclCorners: { default: true, ui: { label: 'GF Extra 1 Incl. corners' } },
    // GF Extra 2
    gfExtra2Members: [],
    gfExtra2Amount: { default: 50, ui: { label: 'GF Extra 2 Amount', bounds: [0, 100], stepSize: 1 } },
    gfExtra2Seed: { default: 1, ui: { label: 'GF Extra 2 Seed', bounds: [0, 100], stepSize: 1 } },
    gfExtra2InclSides: { default: true, ui: { label: 'GF Extra 2 Incl. sides' } },
    gfExtra2InclCorners: { default: true, ui: { label: 'GF Extra 2 Incl. corners' } },
    // Origin (internal)
    originX: 0,
}, {
    // Outputs mirror all inputs as pass-through
    X: 0, Y: 0, Z: 0, topFloors: 0, modLen: 0, gfHeight: 0, winHeight: 0, divHeight: 0,
    gfObj: '', gfCornerObj: '', windowObj: '', windowCornerObj: '',
    tfWindowObj: '', tfWindowCornerObj: '', divSideObj: '', divCornerObj: '',
    roofSideObj: '', roofMiddleObj: '', roofCornerObj: '',
    extra1Members: [], extra1Amount: 0, extra1Seed: 0, extra1InclWin: false, extra1InclTF: false,
    extra2Members: [], extra2Amount: 0, extra2Seed: 0, extra2InclWin: false, extra2InclTF: false,
    gfExtra1Members: [], gfExtra1Amount: 0, gfExtra1Seed: 0, gfExtra1InclSides: false, gfExtra1InclCorners: false,
    gfExtra2Members: [], gfExtra2Amount: 0, gfExtra2Seed: 0, gfExtra2InclSides: false, gfExtra2InclCorners: false,
    originX: 0,
}, (inp) => ({ ...inp }));
// Internal node types — receive all values via connections from GroupInput
const WindowsPointsType = defineNodeType({ X: 0, Y: 0, Z: 0, topFloors: 0, modLen: 0, gfHeight: 0, winHeight: 0, divHeight: 0 }, { gf: [], gfCorner: [], window: [], windowCorner: [], topFloorSide: [], topFloorCorner: [] }, (inp) => windowsPoints(inp.X, inp.Y, inp.Z, inp.topFloors, inp.modLen, inp.gfHeight, inp.winHeight, inp.divHeight));
const RoofPointsType = defineNodeType({ X: 0, Y: 0, Z: 0, topFloors: 0, modLen: 0, gfHeight: 0, winHeight: 0, divHeight: 0 }, { divSide: [], divCorner: [], roofSide: [], roofMiddle: [], roofCorner: [] }, (inp) => roofPointsFn(inp.X, inp.Y, inp.Z, inp.topFloors, inp.modLen, inp.gfHeight, inp.winHeight, inp.divHeight));
const WindowsInstancesType = defineNodeType({
    gf: [], gfCorner: [],
    window: [], windowCorner: [],
    topFloor: [], topFloorCorner: [],
    gfObj: '', gfCornerObj: '', windowObj: '', windowCornerObj: '', tfWindowObj: '', tfWindowCornerObj: '',
    originX: 0,
}, { instances: [] }, (inp) => ({ instances: [
        ...pointsToInstances(inp.gf, inp.gfObj, inp.originX),
        ...pointsToInstances(inp.gfCorner, inp.gfCornerObj, inp.originX),
        ...pointsToInstances(inp.window, inp.windowObj, inp.originX),
        ...pointsToInstances(inp.windowCorner, inp.windowCornerObj, inp.originX),
        ...pointsToInstances(inp.topFloor, inp.tfWindowObj, inp.originX),
        ...pointsToInstances(inp.topFloorCorner, inp.tfWindowCornerObj, inp.originX),
    ] }));
const RoofInstancesType = defineNodeType({
    divSide: [], divCorner: [],
    roofSide: [], roofMiddle: [], roofCorner: [],
    divSideObj: '', divCornerObj: '', roofSideObj: '', roofMiddleObj: '', roofCornerObj: '',
    originX: 0,
}, { instances: [] }, (inp) => ({ instances: [
        ...pointsToInstances(inp.divSide, inp.divSideObj, inp.originX),
        ...pointsToInstances(inp.divCorner, inp.divCornerObj, inp.originX),
        ...pointsToInstances(inp.roofSide, inp.roofSideObj, inp.originX),
        ...pointsToInstances(inp.roofMiddle, inp.roofMiddleObj, inp.originX),
        ...pointsToInstances(inp.roofCorner, inp.roofCornerObj, inp.originX),
    ] }));
const ExtraType = defineNodeType({
    window: [], windowCorner: [],
    topFloor: [], topFloorCorner: [],
    members: [], amount: 0, seed: 0, inclWin: false, inclTF: false, originX: 0,
}, { instances: [] }, (inp) => ({ instances: filteredToInstances(extraFilter(inp.window, inp.windowCorner, inp.topFloor, inp.topFloorCorner, inp.amount, inp.seed, inp.inclWin, inp.inclTF), inp.members, inp.originX) }));
const GFExtraType = defineNodeType({
    gf: [], gfCorner: [],
    members: [], amount: 0, seed: 0, inclSides: false, inclCorners: false, originX: 0,
}, { instances: [] }, (inp) => ({ instances: filteredToInstances(gfExtraFilter(inp.gf, inp.gfCorner, inp.amount, inp.seed, inp.inclSides, inp.inclCorners), inp.members, inp.originX) }));
const JoinType = defineNodeType({ a: [], b: [] }, { instances: [] }, (inp) => ({ instances: [...inp.a, ...inp.b] }));
function createBuildingGraph(name, p) {
    const obj = (n) => `object_${p.prefix}_${n}.glb`;
    const d = p.dims;
    // Group Input — the single node with all modifier inputs (UI controls)
    const gi = GroupInputType(name, {
        X: d.X, Y: d.Y, Z: d.Z, topFloors: d.topFloors,
        modLen: d.modLen, gfHeight: d.gfH, winHeight: d.winH, divHeight: d.divH,
        gfObj: obj('Ground_floor'), gfCornerObj: obj('Ground_floor_corner'),
        windowObj: obj('Window'), windowCornerObj: obj('Window_corner'),
        tfWindowObj: obj('Top_floor_window'), tfWindowCornerObj: obj('Top_floor_window_corner'),
        divSideObj: obj('Top_floors_div'), divCornerObj: obj('Top_floors_div_corner'),
        roofSideObj: obj('Roof_side'), roofMiddleObj: obj('Roof_middle'), roofCornerObj: obj('Roof_corner'),
        extra1Members: p.extra1.members, extra1Amount: p.extra1.amount, extra1Seed: p.extra1.seed, extra1InclWin: p.extra1.inclWin, extra1InclTF: p.extra1.inclTF,
        extra2Members: p.extra2.members, extra2Amount: p.extra2.amount, extra2Seed: p.extra2.seed, extra2InclWin: p.extra2.inclWin, extra2InclTF: p.extra2.inclTF,
        gfExtra1Members: p.gfExtra1.members, gfExtra1Amount: p.gfExtra1.amount, gfExtra1Seed: p.gfExtra1.seed, gfExtra1InclSides: p.gfExtra1.inclSides, gfExtra1InclCorners: p.gfExtra1.inclCorners,
        gfExtra2Members: p.gfExtra2.members, gfExtra2Amount: p.gfExtra2.amount, gfExtra2Seed: p.gfExtra2.seed, gfExtra2InclSides: p.gfExtra2.inclSides, gfExtra2InclCorners: p.gfExtra2.inclCorners,
        originX: p.originX,
    });
    // Internal nodes — all inputs connected from GroupInput
    const wp = WindowsPointsType(`${name} Windows points`);
    const rp = RoofPointsType(`${name} Roof points`);
    const wi = WindowsInstancesType(`${name} Windows instances`);
    const ri = RoofInstancesType(`${name} Roof instances`);
    const ex1 = ExtraType(`${name} Extra 1`);
    const ex2 = ExtraType(`${name} Extra 2`);
    const gfe1 = GFExtraType(`${name} GF Extra 1`);
    const gfe2 = GFExtraType(`${name} GF Extra 2`);
    const joinW = JoinType(`${name} Join Walls`);
    const joinE = JoinType(`${name} Join Extras`);
    const joinE2 = JoinType(`${name} Join GF Extras`);
    const joinE3 = JoinType(`${name} Join All Extras`);
    const joinFinal = JoinType(`${name}`);
    const graph = defineGraph([gi, wp, rp, wi, ri, ex1, ex2, gfe1, gfe2, joinW, joinE, joinE2, joinE3, joinFinal], [
        // GroupInput → Windows points (dimensions)
        connect(gi, 'X', wp, 'X'), connect(gi, 'Y', wp, 'Y'), connect(gi, 'Z', wp, 'Z'),
        connect(gi, 'topFloors', wp, 'topFloors'), connect(gi, 'modLen', wp, 'modLen'),
        connect(gi, 'gfHeight', wp, 'gfHeight'), connect(gi, 'winHeight', wp, 'winHeight'), connect(gi, 'divHeight', wp, 'divHeight'),
        // GroupInput → Roof points (dimensions)
        connect(gi, 'X', rp, 'X'), connect(gi, 'Y', rp, 'Y'), connect(gi, 'Z', rp, 'Z'),
        connect(gi, 'topFloors', rp, 'topFloors'), connect(gi, 'modLen', rp, 'modLen'),
        connect(gi, 'gfHeight', rp, 'gfHeight'), connect(gi, 'winHeight', rp, 'winHeight'), connect(gi, 'divHeight', rp, 'divHeight'),
        // GroupInput → Windows instances (module objects + origin)
        connect(gi, 'gfObj', wi, 'gfObj'), connect(gi, 'gfCornerObj', wi, 'gfCornerObj'),
        connect(gi, 'windowObj', wi, 'windowObj'), connect(gi, 'windowCornerObj', wi, 'windowCornerObj'),
        connect(gi, 'tfWindowObj', wi, 'tfWindowObj'), connect(gi, 'tfWindowCornerObj', wi, 'tfWindowCornerObj'),
        connect(gi, 'originX', wi, 'originX'),
        // GroupInput → Roof instances (module objects + origin)
        connect(gi, 'divSideObj', ri, 'divSideObj'), connect(gi, 'divCornerObj', ri, 'divCornerObj'),
        connect(gi, 'roofSideObj', ri, 'roofSideObj'), connect(gi, 'roofMiddleObj', ri, 'roofMiddleObj'), connect(gi, 'roofCornerObj', ri, 'roofCornerObj'),
        connect(gi, 'originX', ri, 'originX'),
        // GroupInput → Extra 1
        connect(gi, 'extra1Members', ex1, 'members'), connect(gi, 'extra1Amount', ex1, 'amount'),
        connect(gi, 'extra1Seed', ex1, 'seed'), connect(gi, 'extra1InclWin', ex1, 'inclWin'), connect(gi, 'extra1InclTF', ex1, 'inclTF'),
        connect(gi, 'originX', ex1, 'originX'),
        // GroupInput → Extra 2
        connect(gi, 'extra2Members', ex2, 'members'), connect(gi, 'extra2Amount', ex2, 'amount'),
        connect(gi, 'extra2Seed', ex2, 'seed'), connect(gi, 'extra2InclWin', ex2, 'inclWin'), connect(gi, 'extra2InclTF', ex2, 'inclTF'),
        connect(gi, 'originX', ex2, 'originX'),
        // GroupInput → GF Extra 1
        connect(gi, 'gfExtra1Members', gfe1, 'members'), connect(gi, 'gfExtra1Amount', gfe1, 'amount'),
        connect(gi, 'gfExtra1Seed', gfe1, 'seed'), connect(gi, 'gfExtra1InclSides', gfe1, 'inclSides'), connect(gi, 'gfExtra1InclCorners', gfe1, 'inclCorners'),
        connect(gi, 'originX', gfe1, 'originX'),
        // GroupInput → GF Extra 2
        connect(gi, 'gfExtra2Members', gfe2, 'members'), connect(gi, 'gfExtra2Amount', gfe2, 'amount'),
        connect(gi, 'gfExtra2Seed', gfe2, 'seed'), connect(gi, 'gfExtra2InclSides', gfe2, 'inclSides'), connect(gi, 'gfExtra2InclCorners', gfe2, 'inclCorners'),
        connect(gi, 'originX', gfe2, 'originX'),
        // Windows points → instances
        connect(wp, 'gf', wi, 'gf'), connect(wp, 'gfCorner', wi, 'gfCorner'),
        connect(wp, 'window', wi, 'window'), connect(wp, 'windowCorner', wi, 'windowCorner'),
        connect(wp, 'topFloorSide', wi, 'topFloor'), connect(wp, 'topFloorCorner', wi, 'topFloorCorner'),
        // Roof points → instances
        connect(rp, 'divSide', ri, 'divSide'), connect(rp, 'divCorner', ri, 'divCorner'),
        connect(rp, 'roofSide', ri, 'roofSide'), connect(rp, 'roofMiddle', ri, 'roofMiddle'), connect(rp, 'roofCorner', ri, 'roofCorner'),
        // Extras receive window/topFloor/gf points
        connect(wp, 'window', ex1, 'window'), connect(wp, 'windowCorner', ex1, 'windowCorner'),
        connect(wp, 'topFloorSide', ex1, 'topFloor'), connect(wp, 'topFloorCorner', ex1, 'topFloorCorner'),
        connect(wp, 'window', ex2, 'window'), connect(wp, 'windowCorner', ex2, 'windowCorner'),
        connect(wp, 'topFloorSide', ex2, 'topFloor'), connect(wp, 'topFloorCorner', ex2, 'topFloorCorner'),
        connect(wp, 'gf', gfe1, 'gf'), connect(wp, 'gfCorner', gfe1, 'gfCorner'),
        connect(wp, 'gf', gfe2, 'gf'), connect(wp, 'gfCorner', gfe2, 'gfCorner'),
        // Joins
        connect(wi, 'instances', joinW, 'a'), connect(ri, 'instances', joinW, 'b'),
        connect(ex1, 'instances', joinE, 'a'), connect(ex2, 'instances', joinE, 'b'),
        connect(gfe1, 'instances', joinE2, 'a'), connect(gfe2, 'instances', joinE2, 'b'),
        connect(joinE, 'instances', joinE3, 'a'), connect(joinE2, 'instances', joinE3, 'b'),
        connect(joinW, 'instances', joinFinal, 'a'), connect(joinE3, 'instances', joinFinal, 'b'),
    ]);
    return { graph, output: { node: joinFinal, output: 'instances' } };
}
// ─── 3 Buildings ────────────────────────────────────────────────────
const b1Params = {
    dims: { X: 5, Y: 3, Z: 5, topFloors: 2, modLen: 3, gfH: 3.5, winH: 4, divH: 0.6000000238418579 },
    originX: -0.09106839448213577, prefix: 'B1',
    extra1: { members: ['object_B1_Awning.glb'], amount: 50, seed: 1, inclWin: true, inclTF: false },
    extra2: { members: ['object_B1_Plants.glb', 'object_B1_Plants_001.glb', 'object_B1_Plants_002.glb', 'object_B1_Plants_003.glb'], amount: 50, seed: 1, inclWin: true, inclTF: true },
    gfExtra1: { members: ['object_B1_GF_plant.glb'], amount: 50, seed: 1, inclSides: true, inclCorners: true },
    gfExtra2: { members: ['object_B1_GF_awning.glb'], amount: 50, seed: 1, inclSides: true, inclCorners: true },
};
const b2Params = {
    dims: { X: 8, Y: 5, Z: 5, topFloors: 1, modLen: 2, gfH: 3.5, winH: 3.799999952316284, divH: 0.4000000059604645 },
    originX: -30.8080997467041, prefix: 'B2',
    extra1: { members: ['object_B2_Air.glb'], amount: 50, seed: 2, inclWin: true, inclTF: false },
    extra2: { members: ['object_B2_Balcony.glb'], amount: 50, seed: 2, inclWin: true, inclTF: true },
    gfExtra1: { members: ['object_B2_GF_Plant.glb'], amount: 50, seed: 2, inclSides: true, inclCorners: true },
    gfExtra2: { members: ['object_B2_GF_awning.glb'], amount: 50, seed: 2, inclSides: true, inclCorners: true },
};
const b3Params = {
    dims: { X: 5, Y: 4, Z: 5, topFloors: 1, modLen: 2.5999999046325684, gfH: 3.799999952316284, winH: 3.5, divH: 0.4000000059604645 },
    originX: 26.19099998474121, prefix: 'B3',
    extra1: { members: ['object_B3_Air.glb', 'object_B3_Air_001.glb', 'object_B3_Plants.glb', 'object_B3_Plants_001.glb', 'object_B3_Plants_002.glb', 'object_B3_Plants_003.glb', 'object_B3_Plants_004.glb', 'object_B3_Plants_005.glb'], amount: 50, seed: 3, inclWin: true, inclTF: false },
    extra2: { members: ['object_B3_Awning.glb'], amount: 50, seed: 3, inclWin: true, inclTF: true },
    gfExtra1: { members: ['object_B3_GF_awning.glb'], amount: 100, seed: 3, inclSides: true, inclCorners: false },
    gfExtra2: { members: ['object_B3_GF_awning_2.glb'], amount: 100, seed: 3, inclSides: false, inclCorners: true },
};
const b1 = createBuildingGraph('Building 1', b1Params);
const b2 = createBuildingGraph('Building 2', b2Params);
const b3 = createBuildingGraph('Building 3', b3Params);
// ─── Collect all assets ─────────────────────────────────────────────
const assets = [...new Set([b1Params, b2Params, b3Params].flatMap(bp => {
        const p = (name) => `object_${bp.prefix}_${name}.glb`;
        return [
            p('Ground_floor'), p('Ground_floor_corner'), p('Window'), p('Window_corner'),
            p('Top_floor_window'), p('Top_floor_window_corner'), p('Top_floors_div'), p('Top_floors_div_corner'),
            p('Roof_side'), p('Roof_middle'), p('Roof_corner'),
            ...bp.extra1.members, ...bp.extra2.members, ...bp.gfExtra1.members, ...bp.gfExtra2.members,
        ];
    }))];
// ─── Export ─────────────────────────────────────────────────────────
export const graphModule = {
    graphs: [
        { graph: b1.graph, outputs: [b1.output] },
        { graph: b2.graph, outputs: [b2.output] },
        { graph: b3.graph, outputs: [b3.output] },
    ],
    assets,
    assetsPath: './assets/',
};
