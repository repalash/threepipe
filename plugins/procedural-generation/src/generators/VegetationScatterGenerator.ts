/**
 * Vegetation scatter generator — distributes procedural trees and bushes on any mesh surface.
 *
 * Demonstrates the full Distribute → Instance pipeline:
 * 1. Compute slope from surface normals
 * 2. Distribute points on faces (random or Poisson disk)
 * 3. Filter by slope and height
 * 4. Instance multiple vegetation types with weighted random selection
 *
 * Vegetation geometry is procedurally created (cone+cylinder for trees,
 * sphere for bushes) — no external assets needed.
 *
 * Reference: Geo-Scatter vegetation distribution patterns
 * https://geoscatter.com/
 * - Poisson disk for non-overlapping placement
 * - Slope filtering to prevent trees on cliffs
 * - Height filtering for biome zones
 * - Random scale/rotation for natural variation
 */

import {
    BufferGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    Group2,
    type IObject3D,
    type IMaterial,
    Mesh,
    PhysicalMaterial,
    SphereGeometry,
    type UiObjectConfig,
    Vector3,
} from 'threepipe'
import {AProceduralGenerator} from '../AProceduralGenerator'
import {SeededRandom} from '../utils/SeededRandom'
import * as Distribute from '../points/Distribute'
import * as Instance from '../points/Instance'
import {mergeGeometries} from 'threepipe'

export interface VegetationScatterParams {
    type: string
    /** Points per unit area. */
    density: number
    /** Distribution method. */
    method: 'random' | 'poisson'
    /** Minimum distance between points (Poisson only). Auto-computed from density if 0. */
    minDistance: number
    /** Slope range in degrees: only place vegetation where slope is within [min, max]. */
    slopeMin: number
    slopeMax: number
    /** Height range: only place vegetation where Y is within [min, max]. */
    heightMin: number
    heightMax: number
    /** Random seed. */
    seed: number
    /** Scale range for random size variation. */
    scaleMin: number
    scaleMax: number
}

/**
 * Create simple procedural tree geometry (cone canopy + cylinder trunk).
 * No external assets needed.
 */
function createTreeGeometry(rng: SeededRandom): {geometry: BufferGeometry, material: IMaterial} {
    const trunkHeight = rng.range(0.3, 0.6)
    const trunkRadius = rng.range(0.05, 0.1)
    const canopyHeight = rng.range(0.6, 1.2)
    const canopyRadius = rng.range(0.25, 0.5)

    const trunk = new CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 6)
    trunk.translate(0, trunkHeight / 2, 0)

    const canopy = new ConeGeometry(canopyRadius, canopyHeight, 7)
    canopy.translate(0, trunkHeight + canopyHeight / 2, 0)

    const merged = mergeGeometries([trunk, canopy])
    trunk.dispose()
    canopy.dispose()

    const material = new PhysicalMaterial({
        color: new Color().setHSL(rng.range(0.25, 0.38), rng.range(0.4, 0.7), rng.range(0.25, 0.4)),
        roughness: 0.9,
        metalness: 0,
    }) as IMaterial
    material.name = 'Tree Material'

    return {geometry: merged!, material}
}

/**
 * Create simple procedural bush geometry (flattened sphere).
 */
function createBushGeometry(rng: SeededRandom): {geometry: BufferGeometry, material: IMaterial} {
    const radius = rng.range(0.15, 0.35)
    const geo = new SphereGeometry(radius, 6, 5)
    geo.scale(1, rng.range(0.5, 0.8), 1)
    geo.translate(0, radius * 0.4, 0)

    const material = new PhysicalMaterial({
        color: new Color().setHSL(rng.range(0.2, 0.4), rng.range(0.5, 0.8), rng.range(0.2, 0.35)),
        roughness: 0.95,
        metalness: 0,
    }) as IMaterial
    material.name = 'Bush Material'

    return {geometry: geo, material}
}

export class VegetationScatterGenerator extends AProceduralGenerator<VegetationScatterParams> {
    readonly type = 'vegetation'

    /**
     * The target mesh to scatter vegetation on.
     * Must be set before calling generate().
     */
    targetMesh: Mesh | null = null

    defaultParams: VegetationScatterParams = {
        type: 'vegetation',
        density: 0.5,
        method: 'poisson',
        minDistance: 0,
        slopeMin: 0,
        slopeMax: 35,
        heightMin: -Infinity,
        heightMax: Infinity,
        seed: 42,
        scaleMin: 0.7,
        scaleMax: 1.3,
    }

    constructor() {
        super('vegetation')
    }

    override createUiConfig(object: IObject3D): UiObjectConfig[] {
        const params = object.userData?.generationParams as VegetationScatterParams
        if (!params) return []
        return [
            {type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 99999], stepSize: 1},
            {type: 'slider', label: 'Density', property: [params, 'density'], bounds: [0.01, 5], stepSize: 0.01},
            {type: 'slider', label: 'Min Distance', property: [params, 'minDistance'], bounds: [0, 10], stepSize: 0.1},
            {type: 'slider', label: 'Slope Min', property: [params, 'slopeMin'], bounds: [0, 90], stepSize: 1},
            {type: 'slider', label: 'Slope Max', property: [params, 'slopeMax'], bounds: [0, 90], stepSize: 1},
            {type: 'slider', label: 'Height Min', property: [params, 'heightMin'], bounds: [-100, 100], stepSize: 0.5},
            {type: 'slider', label: 'Height Max', property: [params, 'heightMax'], bounds: [-100, 100], stepSize: 0.5},
            {type: 'slider', label: 'Scale Min', property: [params, 'scaleMin'], bounds: [0.1, 3], stepSize: 0.05},
            {type: 'slider', label: 'Scale Max', property: [params, 'scaleMax'], bounds: [0.1, 3], stepSize: 0.05},
            {
                type: 'dropdown',
                label: 'Method',
                property: [params, 'method'],
                children: [
                    {label: 'Poisson Disk', value: 'poisson'},
                    {label: 'Random', value: 'random'},
                ],
            },
        ]
    }

    generate(params: VegetationScatterParams, rng: SeededRandom): IObject3D {
        const root = new Group2()
        root.name = 'Vegetation'

        if (!this.targetMesh) {
            console.warn('VegetationScatterGenerator: no targetMesh set')
            return root
        }

        const density = Math.max(0.001, params.density)
        const slopeMin = Math.max(0, params.slopeMin)
        const slopeMax = Math.min(90, params.slopeMax)
        const heightMin = params.heightMin
        const heightMax = params.heightMax
        const scaleMin = Math.max(0.01, params.scaleMin)
        const scaleMax = Math.max(scaleMin, params.scaleMax)

        // Distribute points on target mesh surface
        const up = new Vector3(0, 1, 0)
        let cloud = Distribute.onFaces(this.targetMesh.geometry as BufferGeometry, {
            method: params.method,
            density,
            minDistance: params.minDistance > 0 ? params.minDistance : undefined,
            seed: params.seed,
            // Filter by slope and height during distribution
            densityField: (pos) => {
                if (pos.y < heightMin || pos.y > heightMax) return 0
                return 1
            },
        })

        // Post-filter by slope (normal-based)
        cloud = Distribute.filter(cloud, (pt) => {
            const dot = Math.min(1, Math.max(-1, pt.normal.dot(up)))
            const slope = Math.acos(dot) * (180 / Math.PI)
            return slope >= slopeMin && slope <= slopeMax
        })

        if (cloud.length === 0) return root

        // Create procedural vegetation sources
        const treeRng = rng.fork()
        const sources: Instance.InstanceSource[] = [
            {...createTreeGeometry(treeRng), weight: 3},   // tall conifer
            {...createTreeGeometry(treeRng), weight: 2},   // medium tree
            {...createBushGeometry(treeRng), weight: 2},    // bush
        ]

        // Instance vegetation at points
        const instances = Instance.pickFromCollection(cloud, sources, {
            alignToNormal: true,
            randomRotationY: true,
            scaleRange: [scaleMin, scaleMax],
            seed: params.seed,
        })
        root.add(instances)

        return root
    }
}
