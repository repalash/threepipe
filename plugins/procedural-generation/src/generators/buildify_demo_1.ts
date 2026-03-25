/**
 * Buildify Demo 1 — Procedural building generator replicating the Buildify 1.0
 * Blender geometry nodes addon.
 *
 * Structure mirrors the Blender node graph:
 *   "building" (top-level) calls:
 *     → "Walls" × 3 (ground, middle, trim floors)
 *     → "Wall props" × 2 (middle floor details, first floor signs)
 *     → "Populate flat roof with details" (roof scatter)
 *
 * Each geometry node group = a function.
 * The top-level function = the graph connecting them.
 */

import {Group2, Mesh2, PhysicalMaterial, PlaneGeometry} from 'threepipe'
import {randomInt, randomFloat, randomBool} from '../blender/random_value'
import {
    normalizeAngle, alignEulerToEdgeNormal, pointOnSegment,
    meshToCurveSplitTrim,
    type CurveSegment, type Vec2,
} from '../blender/geometry_nodes'

// ─── Types ──────────────────────────────────────────────────────────

type Seg = CurveSegment

interface WallPlacement {
    x: number
    y: number
    z: number
    rotY: number
    scaleX: number
    source: string
}

interface PillarPlacement {
    x: number
    y: number
    z: number
    rotY: number
    source: string
}

interface PropPlacement {
    x: number
    y: number
    z: number
    rotY: number
    source: string
}

import type {ModuleMap} from '../graph/module'
export type {ModuleData, ModuleMap} from '../graph/module'

/** Parameters matching the Buildify "building" node group interface */
export interface BuildifyParams {
    /** Footprint polygon vertices (three.js XZ coords, CCW winding) */
    footprint: Vec2[]
    /** Flat pillar positions that split polygon edges */
    flatPillars: Vec2[]
    /** Blender's curve traversal order: [segmentIndex, reversed][] */
    segOrder: [number, boolean][]

    moduleWidth: number
    moduleHeight: number
    meshWidth: number
    floors: number

    /** Wall variant seeds per floor type */
    groundSeed: number
    middleSeed: number
    trimSeed: number

    /** Wall prop seeds */
    propSeed: number
    signSeed: number

    /** Collection names */
    groundWalls: string[]
    middleWalls: string[]
    trimWalls: string[]
    pillarSources: Record<string, Record<string, string>>
    propCollection: string[]
    signCollection: string[]
    roofDetails: string[]
}

// ─── "Walls" node group ─────────────────────────────────────────────
// Resample → Capture Attribute → Duplicate Elements → Set Position →
// Delete Geometry → Instance on Points
//
// Called 3 times from "building" with different params per floor type.

function wallsNodeGroup(
    segments: Seg[],
    segOrder: [number, boolean][],
    p: {
        moduleWidth: number, moduleHeight: number, meshWidth: number,
        wallCollection: string[], pillarOffset: number, seed: number,
        numFloors: number, removeFromBottom: number, removeFromTop: number,
    },
): WallPlacement[] {
    const placements: WallPlacement[] = []

    // Compute wall positions per segment (ground floor uses pillar offset for count)
    const segWalls: {px: number, pz: number}[][] = segments.map(seg => {
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1]
        const len = Math.sqrt(dx * dx + dz * dz)
        const dirX = dx / len, dirZ = dz / len
        const usable = len - 2 * p.pillarOffset
        const n = Math.max(1, Math.round(usable / p.moduleWidth))
        const spacing = usable / n
        const walls: {px: number, pz: number}[] = []
        for (let mi = 0; mi < n; mi++) {
            const t = p.pillarOffset + (mi + 0.5) * spacing
            walls.push({px: seg.from[0] + dirX * t, pz: seg.from[1] + dirZ * t})
        }
        return walls
    })

    // Build point index mapping following Blender's traversal order
    const pointOrder: {segIdx: number, wallIdx: number}[] = []
    for (const [segIdx, reversed] of segOrder) {
        const walls = segWalls[segIdx]
        if (reversed) {
            for (let i = walls.length - 1; i >= 0; i--) pointOrder.push({segIdx, wallIdx: i})
        } else {
            for (let i = 0; i < walls.length; i++) pointOrder.push({segIdx, wallIdx: i})
        }
    }

    // Two-stage variant selection (Capture Attribute + Random Value)
    function pickVariant(pointIdx: number): string {
        if (p.wallCollection.length === 1) return p.wallCollection[0]
        const stage1 = randomInt(0, 100, pointIdx, 0)
        const stage2 = randomInt(0, 200, stage1, p.seed)
        return p.wallCollection[stage2 % p.wallCollection.length]
    }

    // Generate walls: for each segment, for each wall slot, for each surviving floor
    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si]
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1]
        const len = Math.sqrt(dx * dx + dz * dz)
        const dirX = dx / len, dirZ = dz / len
        const rotY = alignEulerToEdgeNormal(seg.from[0], seg.from[1], seg.to[0], seg.to[1])
        const walls = segWalls[si]

        for (let mi = 0; mi < walls.length; mi++) {
            const pointIdx = pointOrder.findIndex(po => po.segIdx === si && po.wallIdx === mi)

            // Blender: Delete where ID < removeFromBottom OR ID > (numFloors - removeFromTop)
            const maxFloor = Math.min(p.numFloors - 1, p.numFloors - p.removeFromTop)
            for (let floor = p.removeFromBottom; floor <= maxFloor; floor++) {
                // Per-floor offset: ground uses pillarOffset, upper floors use 0
                const floorOffset = floor === 0 ? p.pillarOffset : 0
                const usable = len - 2 * floorOffset
                const n = Math.max(1, Math.round(usable / p.moduleWidth))
                const spacing = usable / n
                const scaleX = spacing / p.meshWidth

                const t = floorOffset + (mi + 0.5) * spacing
                placements.push({
                    x: seg.from[0] + dirX * t,
                    y: floor * p.moduleHeight,
                    z: seg.from[1] + dirZ * t,
                    rotY,
                    scaleX,
                    source: pickVariant(pointIdx),
                })
            }
        }
    }

    return placements
}

// ─── Corner + flat pillar classification ────────────────────────────

function pillarPlacements(
    footprint: Vec2[], flatPillars: Vec2[],
    pillarSources: Record<string, Record<string, string>>,
    numFloors: number, moduleHeight: number,
): PillarPlacement[] {
    const placements: PillarPlacement[] = []

    function floorType(f: number): string {
        if (f === 0) return 'ground'
        if (f === numFloors - 1) return 'trim'
        return 'middle'
    }

    // Corner pillars
    for (let i = 0; i < footprint.length; i++) {
        const prev = footprint[(i - 1 + footprint.length) % footprint.length]
        const curr = footprint[i]
        const next = footprint[(i + 1) % footprint.length]
        const cross = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0])
        const type = cross > 0 ? 'cv' : 'cc'

        const rPrev = alignEulerToEdgeNormal(prev[0], prev[1], curr[0], curr[1])
        const rCurr = alignEulerToEdgeNormal(curr[0], curr[1], next[0], next[1])
        let a = rPrev, b = rCurr
        while (a - b > Math.PI) a -= 2 * Math.PI
        while (b - a > Math.PI) b -= 2 * Math.PI
        const pillarRot = normalizeAngle((a + b) / 2 + Math.PI)

        for (let floor = 0; floor < numFloors; floor++) {
            placements.push({
                x: curr[0], y: floor * moduleHeight, z: curr[1],
                rotY: pillarRot,
                source: pillarSources[floorType(floor)][type],
            })
        }
    }

    // Flat pillars
    for (const fp of flatPillars) {
        let fpRotY = 0
        for (let i = 0; i < footprint.length; i++) {
            const j = (i + 1) % footprint.length
            if (pointOnSegment(fp, footprint[i][0], footprint[i][1], footprint[j][0], footprint[j][1]) !== null) {
                fpRotY = normalizeAngle(alignEulerToEdgeNormal(footprint[i][0], footprint[i][1], footprint[j][0], footprint[j][1]) + Math.PI)
                break
            }
        }
        for (let floor = 0; floor < numFloors; floor++) {
            placements.push({
                x: fp[0], y: floor * moduleHeight, z: fp[1],
                rotY: fpRotY,
                source: pillarSources[floorType(floor)].flat,
            })
        }
    }

    return placements
}

// ─── "Wall props" node group ────────────────────────────────────────
// Instances to Points → density filter → type selection →
// Instance on Points → Translate Instances (local offset)
//
// Called from "building" with wall instances as input.

function wallPropsNodeGroup(
    segments: Seg[], segOrder: [number, boolean][],
    p: {
        moduleWidth: number, moduleHeight: number,
        seed: number, collection: string[], density: number,
        horizOffset: number, vertOffset: number,
        removeFromBottom: number, removeFromTop: number,
    },
): PropPlacement[] {
    const placements: PropPlacement[] = []

    // Build wall instance list in Blender's spline traversal order:
    // per segment → per floor → per wall point within floor
    const wallInstances: {x: number, y: number, z: number, rotY: number, floor: number}[] = []
    for (const [segIdx, reversed] of segOrder) {
        const seg = segments[segIdx]
        const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1]
        const len = Math.sqrt(dx * dx + dz * dz)
        const dirX = dx / len, dirZ = dz / len
        const n = Math.max(1, Math.round(len / p.moduleWidth))
        const spacing = len / n
        const rotY = alignEulerToEdgeNormal(seg.from[0], seg.from[1], seg.to[0], seg.to[1])

        const positions: {x: number, z: number}[] = []
        for (let mi = 0; mi < n; mi++) {
            const t = (mi + 0.5) * spacing
            positions.push({x: seg.from[0] + dirX * t, z: seg.from[1] + dirZ * t})
        }
        const ordered = reversed ? [...positions].reverse() : positions

        // Duplicate Elements (SPLINE domain): floor first, then points within floor
        for (let floor = 1; floor <= 5; floor++) {
            for (const wp of ordered) {
                wallInstances.push({x: wp.x, y: floor * p.moduleHeight, z: wp.z, rotY, floor})
            }
        }
    }

    // Delete Geometry: filter by floor ID range
    const filtered = wallInstances.filter(w => w.floor >= p.removeFromBottom && w.floor <= p.removeFromTop)

    // Density filter → type selection → offset (all using sequential point index)
    for (let i = 0; i < filtered.length; i++) {
        // Random Value BOOLEAN (seed+5): delete if true (probability = 1 - density)
        if (randomBool(1 - p.density, i, p.seed + 5)) continue

        const w = filtered[i]

        // Random Value INT (seed): pick prop type from collection
        const typeIdx = randomInt(0, 100, i, p.seed) % p.collection.length
        const source = p.collection[typeIdx]

        // Random Value FLOAT (seed+1): position offset in wall's local space
        const h = randomFloat(0, 1, i, p.seed + 1)
        const hOff = h * (2 * p.horizOffset) - p.horizOffset
        const vOff = h * (2 * p.vertOffset) - p.vertOffset

        // Translate Instances (Local Space=true)
        const cr = Math.cos(w.rotY), sr = Math.sin(w.rotY)
        placements.push({
            x: w.x + hOff * cr,
            y: w.y + vOff,
            z: w.z - hOff * sr,
            rotY: w.rotY,
            source,
        })
    }

    return placements
}

// ─── "building" top-level node group ────────────────────────────────
// This is the main graph that calls all sub-groups and joins the results.

export function buildifyBuilding(params: BuildifyParams): {
    walls: WallPlacement[]
    pillars: PillarPlacement[]
    props: PropPlacement[]
} {
    const segments = meshToCurveSplitTrim(params.footprint, params.flatPillars)
    const numFloors = Math.max(2, params.floors)

    // ── "Walls" group × 3 (ground, middle, trim) ──
    const groundWalls = wallsNodeGroup(segments, params.segOrder, {
        moduleWidth: params.moduleWidth, moduleHeight: params.moduleHeight,
        meshWidth: params.meshWidth, wallCollection: params.groundWalls,
        pillarOffset: 0.5, seed: params.groundSeed,
        numFloors, removeFromBottom: 0, removeFromTop: numFloors,
    })
    const middleWalls = wallsNodeGroup(segments, params.segOrder, {
        moduleWidth: params.moduleWidth, moduleHeight: params.moduleHeight,
        meshWidth: params.meshWidth, wallCollection: params.middleWalls,
        pillarOffset: 0, seed: params.middleSeed,
        numFloors, removeFromBottom: 1, removeFromTop: 2,
    })
    const trimWalls = wallsNodeGroup(segments, params.segOrder, {
        moduleWidth: params.moduleWidth, moduleHeight: params.moduleHeight,
        meshWidth: params.meshWidth, wallCollection: params.trimWalls,
        pillarOffset: 0, seed: params.trimSeed,
        numFloors, removeFromBottom: numFloors - 1, removeFromTop: 0,
    })

    // ── Pillar placement ──
    const pillars = pillarPlacements(
        params.footprint, params.flatPillars,
        params.pillarSources, numFloors, params.moduleHeight,
    )

    // ── "Wall props" group × 2 ──
    const middleProps = wallPropsNodeGroup(segments, params.segOrder, {
        moduleWidth: params.moduleWidth, moduleHeight: params.moduleHeight,
        seed: params.propSeed, collection: params.propCollection,
        density: 0.2, horizOffset: 1.5, vertOffset: 0.5,
        removeFromBottom: 0, removeFromTop: numFloors - 2,
    })
    const signProps = wallPropsNodeGroup(segments, params.segOrder, {
        moduleWidth: params.moduleWidth, moduleHeight: params.moduleHeight,
        seed: params.signSeed, collection: params.signCollection,
        density: 0.2, horizOffset: 1.9, vertOffset: 0,
        removeFromBottom: 0, removeFromTop: 2,
    })

    return {
        walls: [...groundWalls, ...middleWalls, ...trimWalls],
        pillars,
        props: [...middleProps, ...signProps],
    }
}

// ─── Three.js scene builder ─────────────────────────────────────────
// Converts placement data into a Group2 scene hierarchy.

export function buildifyToGroup(
    result: ReturnType<typeof buildifyBuilding>,
    modules: ModuleMap,
    params: {moduleHeight: number, floors: number},
): Group2 {
    const root = new Group2()
    root.name = 'Buildify Building'

    function place(name: string, x: number, y: number, z: number, rotY: number, scaleX = 1) {
        const mod = modules.get(name)
        if (!mod) return
        const group = new Group2()
        group.position.set(x, y, z)
        group.rotation.y = rotY
        group.scale.set(scaleX, 1, 1)
        for (const m of mod.meshes) {
            const mesh = new Mesh2(m.geometry, m.material)
            mesh.castShadow = true
            mesh.receiveShadow = true
            group.add(mesh)
        }
        root.add(group)
    }

    for (const w of result.walls) place(w.source, w.x, w.y, w.z, w.rotY, w.scaleX)
    for (const p of result.pillars) place(p.source, p.x, p.y, p.z, p.rotY)
    for (const p of result.props) place(p.source, p.x, p.y, p.z, p.rotY)

    // Roof
    const numFloors = Math.max(2, params.floors)
    const roofY = numFloors * params.moduleHeight
    const roofMod = modules.get('building_roof')
    if (roofMod) {
        place('building_roof', 0, roofY, 0, 0)
    } else {
        const roofMat = new PhysicalMaterial({color: 0x666660, roughness: 0.9}) as any
        const roofMesh = new Mesh2(new PlaneGeometry(30, 24) as any, roofMat)
        roofMesh.rotation.x = -Math.PI / 2
        roofMesh.position.y = roofY
        roofMesh.receiveShadow = true
        root.add(roofMesh)
    }

    return root
}
