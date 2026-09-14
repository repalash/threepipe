/**
 * Procedural building generator.
 *
 * Produces a proper building with:
 * - Walls built from box assemblies around window/door openings (no boolean cuts)
 * - Recessed glass panes with visible frames and sills
 * - Doors on ground floor with thicker panels
 * - Horizontal ledges (string courses) between floors
 * - Cornice at roofline, plinth at base
 * - Floor slabs visible from inside
 * - Flat, gabled, or hipped roof
 * - Style-dependent colors and material properties
 *
 * Each wall is built in local coordinates (centered on X, Y from 0 upward, Z=0),
 * then rotated and translated to its final position.
 * All geometry per material is merged into single meshes for efficient rendering.
 *
 * Reference dimensions: Neufert "Architects' Data"
 * Window: 1.0-1.4m wide × 1.2-1.6m tall, sill at 0.8-1.0m
 * Door: 0.9-1.2m wide × 2.1-2.4m tall
 * Floor height: 2.8-3.2m residential, 3.5-4.0m commercial ground floor
 */

import {
    BoxGeometry,
    Color,
    Group2,
    type IObject3D,
    type IMaterial,
    Mesh2,
    PhysicalMaterial,
    type UiObjectConfig,
    Vector3,
} from 'threepipe'
import {AProceduralGenerator} from '../AProceduralGenerator'
import {SeededRandom} from '../utils/SeededRandom'
import {mergeGeometries} from 'threepipe'

export interface BuildingParams {
    type: string
    width: number
    depth: number
    floors: number
    floorHeight: number
    groundFloorHeight: number
    baysPerWallFront: number
    baysPerWallSide: number
    roofStyle: 'flat' | 'gabled' | 'hipped'
    roofPitch: number
    style: 'modern' | 'classical' | 'industrial'
    seed: number
}

// Helper to create a box at a specific position
function box(w: number, h: number, d: number, x: number, y: number, z: number): BoxGeometry {
    const g = new BoxGeometry(w, h, d)
    g.translate(x, y, z)
    return g
}

export class BuildingGenerator extends AProceduralGenerator<BuildingParams> {
    readonly type = 'building'

    defaultParams: BuildingParams = {
        type: 'building',
        width: 12,
        depth: 10,
        floors: 4,
        floorHeight: 3.0,
        groundFloorHeight: 3.8,
        baysPerWallFront: 4,
        baysPerWallSide: 3,
        roofStyle: 'flat',
        roofPitch: 35,
        style: 'modern',
        seed: 42,
    }

    constructor() {
        super('building')
    }

    override createUiConfig(object: IObject3D): UiObjectConfig[] {
        const p = object.userData?.generationParams as BuildingParams
        if (!p) return []
        return [
            {type: 'slider', label: 'Seed', property: [p, 'seed'], bounds: [0, 9999], stepSize: 1},
            {type: 'slider', label: 'Width', property: [p, 'width'], bounds: [4, 30], stepSize: 0.5},
            {type: 'slider', label: 'Depth', property: [p, 'depth'], bounds: [4, 20], stepSize: 0.5},
            {type: 'slider', label: 'Floors', property: [p, 'floors'], bounds: [1, 10], stepSize: 1},
            {type: 'slider', label: 'Floor Height', property: [p, 'floorHeight'], bounds: [2.5, 4.0], stepSize: 0.1},
            {type: 'slider', label: 'Ground Floor', property: [p, 'groundFloorHeight'], bounds: [3.0, 5.0], stepSize: 0.1},
            {type: 'slider', label: 'Front Bays', property: [p, 'baysPerWallFront'], bounds: [1, 8], stepSize: 1},
            {type: 'slider', label: 'Side Bays', property: [p, 'baysPerWallSide'], bounds: [1, 6], stepSize: 1},
            {type: 'slider', label: 'Roof Pitch', property: [p, 'roofPitch'], bounds: [15, 55], stepSize: 1},
            {type: 'dropdown', label: 'Roof', property: [p, 'roofStyle'], children: [
                {label: 'Flat', value: 'flat'}, {label: 'Gabled', value: 'gabled'}, {label: 'Hipped', value: 'hipped'},
            ]},
            {type: 'dropdown', label: 'Style', property: [p, 'style'], children: [
                {label: 'Modern', value: 'modern'}, {label: 'Classical', value: 'classical'}, {label: 'Industrial', value: 'industrial'},
            ]},
        ]
    }

    generate(params: BuildingParams, rng: SeededRandom): IObject3D {
        const root = new Group2()
        root.name = 'Building'

        const W = Math.max(3, params.width)
        const D = Math.max(3, params.depth)
        const floors = Math.max(1, Math.floor(params.floors))
        const floorH = Math.max(2.5, params.floorHeight)
        const groundH = Math.max(3.0, params.groundFloorHeight)
        const baysF = Math.max(1, Math.floor(params.baysPerWallFront))
        const baysS = Math.max(1, Math.floor(params.baysPerWallSide))
        const totalH = groundH + (floors - 1) * floorH
        const wT = 0.25 // wall thickness

        // --- Materials ---
        const wallColor = new Color().setHSL(rng.range(0.02, 0.15), rng.range(0.05, 0.3), rng.range(0.65, 0.9))
        const frameColor = params.style === 'modern' ? 0x333333 : params.style === 'classical' ? 0xf0f0f0 : 0x555555
        const wallMat = new PhysicalMaterial({color: wallColor, roughness: 0.85, metalness: 0}) as IMaterial
        const frameMat = new PhysicalMaterial({color: frameColor, roughness: 0.3, metalness: params.style === 'modern' ? 0.7 : 0}) as IMaterial
        const glassMat = new PhysicalMaterial({color: 0x6699bb, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3}) as IMaterial
        const doorMat = new PhysicalMaterial({color: params.style === 'modern' ? 0x333333 : 0x654321, roughness: 0.6, metalness: params.style === 'modern' ? 0.3 : 0}) as IMaterial
        const roofMat = new PhysicalMaterial({color: params.style === 'classical' ? 0x8b6045 : 0x555555, roughness: 0.8, metalness: 0}) as IMaterial
        const plinthMat = new PhysicalMaterial({color: new Color(wallColor).offsetHSL(0, -0.05, -0.15), roughness: 0.9, metalness: 0}) as IMaterial
        wallMat.name = 'Wall'; frameMat.name = 'Frame'; glassMat.name = 'Glass'
        doorMat.name = 'Door'; roofMat.name = 'Roof'; plinthMat.name = 'Plinth'

        // --- Build each wall ---
        const wallDefs: {wallW: number, bays: number, nx: number, nz: number, ox: number, oz: number}[] = [
            {wallW: W, bays: baysF, nx: 0, nz: 1, ox: 0, oz: D / 2},   // front
            {wallW: W, bays: baysF, nx: 0, nz: -1, ox: 0, oz: -D / 2}, // back
            {wallW: D, bays: baysS, nx: 1, nz: 0, ox: W / 2, oz: 0},   // right
            {wallW: D, bays: baysS, nx: -1, nz: 0, ox: -W / 2, oz: 0}, // left
        ]

        const allWall: BoxGeometry[] = []
        const allGlass: BoxGeometry[] = []
        const allFrame: BoxGeometry[] = []
        const allDoor: BoxGeometry[] = []

        for (let wi = 0; wi < wallDefs.length; wi++) {
            const wd = wallDefs[wi]
            const isFront = wi === 0
            const bayW = wd.wallW / wd.bays
            const angle = Math.atan2(wd.nx, wd.nz)
            const cosA = Math.cos(angle), sinA = Math.sin(angle)

            // Transform a local-space box to world position on this wall
            const place = (g: BoxGeometry) => {
                const pos = g.getAttribute('position')
                for (let i = 0; i < pos.count; i++) {
                    const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i)
                    pos.setXYZ(i, lx * cosA + lz * sinA + wd.ox, ly, -lx * sinA + lz * cosA + wd.oz)
                }
                pos.needsUpdate = true
            }

            for (let bay = 0; bay < wd.bays; bay++) {
                const bx = (bay + 0.5) * bayW - wd.wallW / 2 // bay center X in local coords

                for (let fl = 0; fl < floors; fl++) {
                    const isGround = fl === 0
                    const fh = isGround ? groundH : floorH
                    const fy = isGround ? 0 : groundH + (fl - 1) * floorH // floor base Y
                    const isDoor = isGround && isFront && bay === Math.floor(wd.bays / 2)

                    // Opening dimensions
                    const openW = isDoor ? Math.min(1.1, bayW * 0.45) : Math.min(bayW * 0.5, 1.3)
                    const openH = isDoor ? Math.min(2.3, fh - 0.3) : Math.min(fh * 0.42, 1.5)
                    const sillH = isDoor ? 0 : 0.9
                    const mx = (bayW - openW) / 2 // margin X (wall strip width on each side)
                    const topH = fh - sillH - openH // wall above opening

                    // 4 wall strips around the opening
                    // Left strip (full floor height)
                    if (mx > 0.02) { const g = box(mx, fh, wT, bx - bayW / 2 + mx / 2, fy + fh / 2, 0); place(g); allWall.push(g) }
                    // Right strip
                    if (mx > 0.02) { const g = box(mx, fh, wT, bx + bayW / 2 - mx / 2, fy + fh / 2, 0); place(g); allWall.push(g) }
                    // Top strip (above opening)
                    if (topH > 0.02) { const g = box(openW, topH, wT, bx, fy + fh - topH / 2, 0); place(g); allWall.push(g) }
                    // Bottom strip (sill wall, below opening)
                    if (sillH > 0.02) { const g = box(openW, sillH, wT, bx, fy + sillH / 2, 0); place(g); allWall.push(g) }

                    // Lintel (header above opening — slight protrusion)
                    if (params.style !== 'modern') {
                        const g = box(openW + 0.08, 0.1, wT + 0.03, bx, fy + sillH + openH + 0.05, 0.015)
                        place(g); allWall.push(g)
                    }

                    // Glass or door panel — recessed behind wall face
                    const recess = -0.08
                    if (isDoor) {
                        const g = box(openW - 0.06, openH - 0.06, 0.04, bx, fy + openH / 2, recess)
                        place(g); allDoor.push(g)
                    } else {
                        const g = box(openW - 0.06, openH - 0.06, 0.008, bx, fy + sillH + openH / 2, recess)
                        place(g); allGlass.push(g)
                    }

                    // Frame — 4 thin boxes forming the opening perimeter
                    const ft = 0.04, fd = 0.06
                    const fcx = bx, fcy = fy + sillH + openH / 2, fcz = -0.02
                    // Top rail
                    { const g = box(openW, ft, fd, fcx, fcy + openH / 2 - ft / 2, fcz); place(g); allFrame.push(g) }
                    // Bottom rail
                    { const g = box(openW, ft, fd, fcx, fcy - openH / 2 + ft / 2, fcz); place(g); allFrame.push(g) }
                    // Left stile
                    { const g = box(ft, openH, fd, fcx - openW / 2 + ft / 2, fcy, fcz); place(g); allFrame.push(g) }
                    // Right stile
                    { const g = box(ft, openH, fd, fcx + openW / 2 - ft / 2, fcy, fcz); place(g); allFrame.push(g) }

                    // Sill ledge (protruding, not for doors)
                    if (!isDoor && sillH > 0.3) {
                        const g = box(openW + 0.08, 0.04, wT + 0.06, bx, fy + sillH - 0.02, 0.02)
                        place(g); allWall.push(g)
                    }
                }
            }

            // String course / ledge between each floor
            for (let f = 1; f < floors; f++) {
                const y = groundH + (f - 1) * floorH
                const g = box(wd.wallW + 0.04, 0.08, wT + 0.05, 0, y + 0.04, 0.02)
                place(g); allWall.push(g)
            }

            // Cornice at top of wall (3-part for classical, simple for others)
            if (params.style === 'classical') {
                // Fascia
                { const g = box(wd.wallW + 0.02, 0.1, wT, 0, totalH + 0.05, 0); place(g); allWall.push(g) }
                // Cyma (projects forward)
                { const g = box(wd.wallW + 0.04, 0.06, wT + 0.08, 0, totalH + 0.13, 0.04); place(g); allWall.push(g) }
                // Corona (projects most)
                { const g = box(wd.wallW + 0.06, 0.04, wT + 0.16, 0, totalH + 0.18, 0.08); place(g); allWall.push(g) }
            } else {
                // Simple cornice band
                const g = box(wd.wallW + 0.04, 0.08, wT + 0.06, 0, totalH + 0.04, 0.02)
                place(g); allWall.push(g)
            }

            // Plinth at base
            { const g = box(wd.wallW + 0.04, 0.4, wT + 0.04, 0, 0.2, 0.02); place(g); allWall.push(g) }
        }

        // --- Merge and create meshes ---
        const merge = (geos: BoxGeometry[], mat: IMaterial, name: string, cast = true) => {
            if (geos.length === 0) return
            const merged = mergeGeometries(geos)
            for (const g of geos) g.dispose()
            if (!merged) return
            merged.computeVertexNormals()
            const m = new Mesh2(merged as any, mat as any)
            m.name = name
            m.castShadow = cast
            m.receiveShadow = true
            root.add(m)
        }

        merge(allWall, wallMat, 'Walls')
        merge(allGlass, glassMat, 'Glass', false)
        merge(allFrame, frameMat, 'Frames')
        merge(allDoor, doorMat, 'Doors')

        // --- Floor slabs ---
        for (let f = 0; f <= floors; f++) {
            const y = f === 0 ? 0.06 : f < floors ? groundH + (f - 1) * floorH + 0.06 : totalH - 0.06
            const slab = new Mesh2(new BoxGeometry(W - 0.1, 0.12, D - 0.1) as any, plinthMat as any)
            slab.position.y = y
            slab.name = `Floor_${f}`
            slab.receiveShadow = true
            root.add(slab)
        }

        // --- Roof ---
        this._buildRoof(root, params, W, D, totalH, roofMat, wallMat)

        return root
    }

    private _buildRoof(root: Group2, params: BuildingParams, W: number, D: number, totalH: number, roofMat: IMaterial, wallMat: IMaterial) {
        const corniceTop = params.style === 'classical' ? totalH + 0.2 : totalH + 0.08

        if (params.roofStyle === 'flat') {
            // Roof slab
            const slab = new Mesh2(new BoxGeometry(W + 0.1, 0.12, D + 0.1) as any, roofMat as any)
            slab.position.y = corniceTop + 0.06
            slab.name = 'Roof Slab'
            root.add(slab)
            // Parapet walls
            const ph = 0.7, pt = 0.12
            for (const p of [
                {w: W + 0.2, d: pt, x: 0, z: D / 2 + pt / 2},
                {w: W + 0.2, d: pt, x: 0, z: -D / 2 - pt / 2},
                {w: pt, d: D + 0.2 + pt * 2, x: W / 2 + pt / 2, z: 0},
                {w: pt, d: D + 0.2 + pt * 2, x: -W / 2 - pt / 2, z: 0},
            ]) {
                const m = new Mesh2(new BoxGeometry(p.w, ph, p.d) as any, wallMat as any)
                m.position.set(p.x, corniceTop + 0.12 + ph / 2, p.z)
                m.name = 'Parapet'
                m.castShadow = true
                root.add(m)
            }
        } else if (params.roofStyle === 'gabled') {
            const pitch = Math.max(15, Math.min(55, params.roofPitch)) * Math.PI / 180
            const halfD = D / 2
            const ridgeH = Math.tan(pitch) * halfD
            const slopeLen = halfD / Math.cos(pitch)
            const overhang = 0.3
            const thickness = 0.08

            // Two slope planes — each is a thin box, rotated around X axis
            for (const side of [1, -1]) {
                const slope = new Mesh2(new BoxGeometry(W + overhang * 2, slopeLen + overhang, thickness) as any, roofMat as any)
                // Position at mid-height of the slope, offset in Z by half the horizontal run
                slope.position.set(0, corniceTop + ridgeH / 2, side * halfD / 2)
                // Rotate so the slope goes from eave to ridge
                // For side=1 (front): rotate -pitch around X (top edge goes up-back)
                // For side=-1 (back): rotate +pitch around X (top edge goes up-front)
                slope.rotation.x = -side * pitch
                slope.name = 'Roof Slope'
                slope.castShadow = true
                root.add(slope)
            }

            // Gable wall infill (triangular shape on each end) — approximate with tapered box
            for (const side of [1, -1]) {
                const gableGeo = new BoxGeometry(thickness, ridgeH, D)
                // Taper top vertices to form triangle
                const pos = gableGeo.getAttribute('position') as any
                for (let i = 0; i < pos.count; i++) {
                    if (pos.getY(i) > 0) {
                        // Squeeze Z toward center at top
                        pos.setZ(i, pos.getZ(i) * 0.01)
                    }
                }
                pos.needsUpdate = true
                gableGeo.computeVertexNormals()
                const gable = new Mesh2(gableGeo as any, wallMat as any)
                gable.position.set(side * (W / 2 + thickness / 2), corniceTop + ridgeH / 2, 0)
                gable.name = 'Gable'
                gable.castShadow = true
                root.add(gable)
            }

            // Ridge board
            const ridge = new Mesh2(new BoxGeometry(W + overhang * 2, 0.06, 0.06) as any, roofMat as any)
            ridge.position.set(0, corniceTop + ridgeH, 0)
            ridge.name = 'Ridge'
            root.add(ridge)

        } else if (params.roofStyle === 'hipped') {
            const pitch = Math.max(15, Math.min(55, params.roofPitch)) * Math.PI / 180
            const minDim = Math.min(W, D)
            const ridgeH = Math.tan(pitch) * (minDim / 2)

            // Tapered box approximation
            const hipGeo = new BoxGeometry(W, ridgeH, D)
            const pos = hipGeo.getAttribute('position') as any
            for (let i = 0; i < pos.count; i++) {
                if (pos.getY(i) > 0) {
                    // Taper to a small rectangle at top (for ridge line)
                    const tX = W > D ? (W - D) / W * 0.5 + 0.01 : 0.01
                    const tZ = D > W ? (D - W) / D * 0.5 + 0.01 : 0.01
                    pos.setX(i, pos.getX(i) * tX)
                    pos.setZ(i, pos.getZ(i) * tZ)
                }
            }
            pos.needsUpdate = true
            hipGeo.computeVertexNormals()

            const hip = new Mesh2(hipGeo as any, roofMat as any)
            hip.position.y = corniceTop + ridgeH / 2
            hip.name = 'Hip Roof'
            hip.castShadow = true
            root.add(hip)
        }
    }
}
