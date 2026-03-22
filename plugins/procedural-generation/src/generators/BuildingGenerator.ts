/**
 * Procedural building generator using wall-module assembly.
 *
 * Each wall is divided into a grid of bays (columns) × floors (rows).
 * Each bay cell is filled with a module — a small assembly of box geometries:
 * - Wall surround (4 boxes framing the window opening)
 * - Glass pane (recessed thin box)
 * - Sill (protruding box below window)
 * - Or solid wall / door variant
 *
 * This is the same approach used by Buildify, Coan's PBG, and real architectural modeling:
 * you build the wall WITH the opening from pieces, never cutting a hole.
 *
 * Reference dimensions from Neufert "Architects' Data":
 * - Residential floor height: 2.8-3.2m
 * - Commercial ground floor: 3.5-4.0m
 * - Standard window: 1.0-1.4m wide × 1.2-1.6m tall
 * - Sill height: 0.8-1.0m from floor
 * - Door: 0.9-1.2m wide × 2.1-2.4m tall
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
        const wallThick = 0.25

        // Style colors — wider ranges so seed changes are visually obvious
        const wallHue = rng.range(0.02, 0.15)
        const wallColor = new Color().setHSL(wallHue, rng.range(0.05, 0.3), rng.range(0.65, 0.9))
        const frameColor = params.style === 'modern' ? new Color(0x333333)
            : params.style === 'classical' ? new Color(0xf0f0f0)
                : new Color(0x555555)
        const glassColor = new Color(0x88bbdd)
        const roofColor = params.style === 'classical' ? new Color(0x8b6045) : new Color(0x555555)

        const wallMat = new PhysicalMaterial({color: wallColor, roughness: 0.85, metalness: 0}) as IMaterial
        const frameMat = new PhysicalMaterial({color: frameColor, roughness: 0.3, metalness: params.style === 'modern' ? 0.7 : 0}) as IMaterial
        const glassMat = new PhysicalMaterial({color: glassColor, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35}) as IMaterial
        const roofMat = new PhysicalMaterial({color: roofColor, roughness: 0.8, metalness: 0}) as IMaterial

        // Generate 4 walls
        const walls: {wallW: number, bays: number, normal: Vector3, origin: Vector3}[] = [
            {wallW: W, bays: baysF, normal: new Vector3(0, 0, 1), origin: new Vector3(0, 0, D / 2)},
            {wallW: W, bays: baysF, normal: new Vector3(0, 0, -1), origin: new Vector3(0, 0, -D / 2)},
            {wallW: D, bays: baysS, normal: new Vector3(1, 0, 0), origin: new Vector3(W / 2, 0, 0)},
            {wallW: D, bays: baysS, normal: new Vector3(-1, 0, 0), origin: new Vector3(-W / 2, 0, 0)},
        ]

        for (let wi = 0; wi < walls.length; wi++) {
            const wall = walls[wi]
            const isFront = wi === 0
            const bayW = wall.wallW / wall.bays

            // Collect all geometry for this wall to merge into one mesh per material
            const wallGeos: BoxGeometry[] = []
            const glassGeos: BoxGeometry[] = []
            const frameGeos: BoxGeometry[] = []

            for (let bay = 0; bay < wall.bays; bay++) {
                const bayCenter = (bay + 0.5) * bayW - wall.wallW / 2

                for (let floor = 0; floor < floors; floor++) {
                    const isGround = floor === 0
                    const fh = isGround ? groundH : floorH
                    const floorBase = isGround ? 0 : groundH + (floor - 1) * floorH
                    const isDoor = isGround && isFront && bay === Math.floor(wall.bays / 2)

                    // Window/door dimensions
                    const winW = isDoor ? Math.min(1.1, bayW * 0.5) : Math.min(bayW * 0.55, 1.3)
                    const winH = isDoor ? Math.min(2.3, fh - 0.3) : Math.min(fh * 0.45, 1.5)
                    const sillH = isDoor ? 0 : Math.min(0.9, (fh - winH) * 0.55)
                    const marginX = (bayW - winW) / 2
                    const topMargin = fh - sillH - winH

                    // 4 wall pieces around the opening:
                    // Left strip
                    if (marginX > 0.01) {
                        const g = new BoxGeometry(marginX, fh, wallThick)
                        g.translate(bayCenter - bayW / 2 + marginX / 2, floorBase + fh / 2, 0)
                        wallGeos.push(g)
                    }
                    // Right strip
                    if (marginX > 0.01) {
                        const g = new BoxGeometry(marginX, fh, wallThick)
                        g.translate(bayCenter + bayW / 2 - marginX / 2, floorBase + fh / 2, 0)
                        wallGeos.push(g)
                    }
                    // Top strip (above opening)
                    if (topMargin > 0.01) {
                        const g = new BoxGeometry(winW, topMargin, wallThick)
                        g.translate(bayCenter, floorBase + fh - topMargin / 2, 0)
                        wallGeos.push(g)
                    }
                    // Bottom strip (below opening / sill wall)
                    if (sillH > 0.01) {
                        const g = new BoxGeometry(winW, sillH, wallThick)
                        g.translate(bayCenter, floorBase + sillH / 2, 0)
                        wallGeos.push(g)
                    }

                    // Glass pane (recessed behind wall surface)
                    const gp = new BoxGeometry(winW - 0.06, winH - 0.06, 0.01)
                    gp.translate(bayCenter, floorBase + sillH + winH / 2, -0.08)
                    glassGeos.push(gp)

                    // Window frame (4 thin boxes)
                    const ft = 0.04 // frame thickness
                    const fd = 0.06 // frame depth
                    // Top rail
                    frameGeos.push((() => { const g = new BoxGeometry(winW, ft, fd); g.translate(bayCenter, floorBase + sillH + winH - ft / 2, -0.02); return g })())
                    // Bottom rail
                    frameGeos.push((() => { const g = new BoxGeometry(winW, ft, fd); g.translate(bayCenter, floorBase + sillH + ft / 2, -0.02); return g })())
                    // Left stile
                    frameGeos.push((() => { const g = new BoxGeometry(ft, winH, fd); g.translate(bayCenter - winW / 2 + ft / 2, floorBase + sillH + winH / 2, -0.02); return g })())
                    // Right stile
                    frameGeos.push((() => { const g = new BoxGeometry(ft, winH, fd); g.translate(bayCenter + winW / 2 - ft / 2, floorBase + sillH + winH / 2, -0.02); return g })())

                    // Sill (protruding ledge below window, skip for doors)
                    if (!isDoor && sillH > 0.3) {
                        const sg = new BoxGeometry(winW + 0.08, 0.04, wallThick + 0.06)
                        sg.translate(bayCenter, floorBase + sillH - 0.02, 0.02)
                        wallGeos.push(sg)
                    }
                }
            }

            // Ledge between each floor
            for (let f = 1; f < floors; f++) {
                const y = groundH + (f - 1) * floorH
                const lg = new BoxGeometry(wall.wallW + 0.06, 0.1, wallThick + 0.06)
                lg.translate(0, y, 0.02)
                wallGeos.push(lg)
            }

            // Merge all geometries per material into one mesh, then transform to wall position
            const transformWall = (geo: any) => {
                if (!geo) return null
                // Rotate to face the wall normal and translate to wall origin
                const n = wall.normal
                const angle = Math.atan2(n.x, n.z)
                // Apply rotation around Y then translate
                const positions = geo.getAttribute('position')
                const v = new Vector3()
                const cosA = Math.cos(angle), sinA = Math.sin(angle)
                for (let i = 0; i < positions.count; i++) {
                    v.set(positions.getX(i), positions.getY(i), positions.getZ(i))
                    const rx = v.x * cosA + v.z * sinA
                    const rz = -v.x * sinA + v.z * cosA
                    positions.setXYZ(i, rx + wall.origin.x, v.y + wall.origin.y, rz + wall.origin.z)
                }
                positions.needsUpdate = true
                geo.computeVertexNormals()
                return geo
            }

            const wallMerged = wallGeos.length > 0 ? mergeGeometries(wallGeos) : null
            const glassMerged = glassGeos.length > 0 ? mergeGeometries(glassGeos) : null
            const frameMerged = frameGeos.length > 0 ? mergeGeometries(frameGeos) : null

            // Dispose individual geos
            for (const g of [...wallGeos, ...glassGeos, ...frameGeos]) g.dispose()

            if (wallMerged) {
                transformWall(wallMerged)
                const m = new Mesh2(wallMerged as any, wallMat as any)
                m.name = `Wall_${wi}`
                m.castShadow = true
                m.receiveShadow = true
                root.add(m)
            }
            if (glassMerged) {
                transformWall(glassMerged)
                const m = new Mesh2(glassMerged as any, glassMat as any)
                m.name = `Glass_${wi}`
                root.add(m)
            }
            if (frameMerged) {
                transformWall(frameMerged)
                const m = new Mesh2(frameMerged as any, frameMat as any)
                m.name = `Frame_${wi}`
                root.add(m)
            }
        }

        // Floor slabs between stories
        const floorMat = new PhysicalMaterial({
            color: new Color(wallColor).offsetHSL(0, -0.05, -0.1),
            roughness: 0.9, metalness: 0,
        }) as IMaterial
        floorMat.name = 'Floor'
        // Ground floor
        const groundSlab = new Mesh2(new BoxGeometry(W - 0.1, 0.12, D - 0.1) as any, floorMat as any)
        groundSlab.position.y = 0.06
        groundSlab.name = 'Floor_ground'
        groundSlab.receiveShadow = true
        root.add(groundSlab)
        // Upper floors
        for (let f = 1; f < floors; f++) {
            const y = groundH + (f - 1) * floorH
            const slab = new Mesh2(new BoxGeometry(W - 0.1, 0.12, D - 0.1) as any, floorMat as any)
            slab.position.y = y + 0.06
            slab.name = `Floor_${f}`
            slab.receiveShadow = true
            root.add(slab)
        }
        // Top floor / ceiling
        const topSlab = new Mesh2(new BoxGeometry(W - 0.1, 0.12, D - 0.1) as any, floorMat as any)
        topSlab.position.y = totalH - 0.06
        topSlab.name = 'Floor_top'
        topSlab.receiveShadow = true
        root.add(topSlab)

        // Roof
        if (params.roofStyle === 'flat') {
            // Slab + parapet
            const slab = new Mesh2(new BoxGeometry(W + 0.1, 0.12, D + 0.1) as any, roofMat as any)
            slab.position.y = totalH + 0.06
            slab.name = 'Roof'
            root.add(slab)

            const ph = 0.7, pt = 0.12
            const parapets = [
                {w: W + 0.2, d: pt, x: 0, z: D / 2 + 0.05},
                {w: W + 0.2, d: pt, x: 0, z: -D / 2 - 0.05},
                {w: pt, d: D + 0.2, x: W / 2 + 0.05, z: 0},
                {w: pt, d: D + 0.2, x: -W / 2 - 0.05, z: 0},
            ]
            for (const pp of parapets) {
                const pm = new Mesh2(new BoxGeometry(pp.w, ph, pp.d) as any, wallMat as any)
                pm.position.set(pp.x, totalH + 0.12 + ph / 2, pp.z)
                pm.name = 'Parapet'
                root.add(pm)
            }
        } else if (params.roofStyle === 'gabled') {
            // Two angled roof planes meeting at a ridge along the X axis.
            // Each plane spans from the ridge (at top center) down to the eave (at wall edge).
            // Reference: ridge height = tan(pitch) × (depth / 2)
            const pitch = Math.max(15, Math.min(55, params.roofPitch)) * (Math.PI / 180)
            const ridgeH = Math.tan(pitch) * (D / 2)
            const slopeLen = (D / 2) / Math.cos(pitch)
            const overhang = 0.3

            for (const side of [-1, 1]) {
                const rp = new Mesh2(new BoxGeometry(W + overhang * 2, slopeLen + overhang, 0.06) as any, roofMat as any)
                // Position: center at half the slope height, offset in Z by half the slope projection
                rp.position.y = totalH + ridgeH / 2
                rp.position.z = side * (D / 4) * Math.cos(pitch)
                // Rotate around X axis: one side tilts forward, other tilts backward
                rp.rotation.x = side * (Math.PI / 2 - pitch)
                rp.name = 'Roof Slope'
                rp.castShadow = true
                root.add(rp)
            }
        } else {
            // Hipped — tapered box
            const pitch = Math.max(15, Math.min(55, params.roofPitch)) * (Math.PI / 180)
            const ridgeH = Math.tan(pitch) * (Math.min(W, D) / 2)
            const hipGeo = new BoxGeometry(W + 0.2, ridgeH, D + 0.2)
            const hp = hipGeo.getAttribute('position') as any
            for (let i = 0; i < hp.count; i++) {
                if (hp.getY(i) > 0) {
                    hp.setX(i, hp.getX(i) * 0.08)
                    hp.setZ(i, hp.getZ(i) * 0.08)
                }
            }
            hp.needsUpdate = true
            hipGeo.computeVertexNormals()
            const hip = new Mesh2(hipGeo as any, roofMat as any)
            hip.position.y = totalH + ridgeH / 2
            hip.name = 'Roof'
            hip.castShadow = true
            root.add(hip)
        }

        return root
    }
}
