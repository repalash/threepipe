/**
 * Procedural terrain generator using noise-based displacement.
 *
 * Techniques based on:
 * - Red Blob Games: "Making maps with noise functions"
 *   https://www.redblobgames.com/maps/terrain-from-noise/
 *   (elevation redistribution via pow curve, height-based biome coloring)
 * - The Book of Shaders: "Fractal Brownian Motion"
 *   https://thebookofshaders.com/13/
 *   (fBm noise composition for terrain)
 * - The Demon Throne: "Height and Slope Based Colours"
 *   http://thedemonthrone.ca/projects/rendering-terrain/rendering-terrain-part-23-height-and-slope-based-colours/
 *   (slope-based rock blending at steep angles)
 */

import {
    BufferAttribute,
    Color,
    DoubleSide,
    Group2,
    type IObject3D,
    Mesh2,
    PhysicalMaterial,
    PlaneGeometry,
    type UiObjectConfig,
    Vector3,
} from 'threepipe'
import {AProceduralGenerator} from '../AProceduralGenerator'
import {SeededRandom} from '../utils/SeededRandom'
import {createNoise2D, fbm, ridged, type FBMOptions} from '../utils/Noise'
import * as PrimGen from '../geo/PrimGen'

export interface TerrainParams {
    type: string
    /** World size of the terrain (both X and Z). */
    size: number
    /** Number of subdivisions per axis. Higher = more detail. */
    resolution: number
    /** Seed for deterministic generation. */
    seed: number
    /** Number of noise octaves. More = more detail. */
    octaves: number
    /** Base noise scale (inverse of feature size). Smaller = broader features. */
    noiseScale: number
    /** Maximum height of the terrain. */
    heightScale: number
    /** Y position of the water surface. Set below min terrain to disable. */
    waterLevel: number
    /** Noise type: 'fbm' or 'ridged'. */
    noiseType: 'fbm' | 'ridged'
    /** Lacunarity — frequency multiplier per octave. */
    lacunarity: number
    /** Persistence — amplitude multiplier per octave. */
    persistence: number
    /**
     * Elevation redistribution exponent. Applied as pow(height, exponent).
     * Values > 1.0 push mid-heights into valleys (flatter lowlands, steeper peaks).
     * 1.0 = no redistribution, 2.0-3.0 = realistic mountain profiles.
     */
    exponent: number
    /**
     * Edge falloff: smoothly forces terrain edges toward zero for island-like shapes.
     * 0 = no falloff, 1 = full island falloff.
     */
    edgeFalloff: number
}

/**
 * Height-based color bands for vertex coloring.
 * Inspired by Red Blob Games' biome elevation thresholds:
 * https://www.redblobgames.com/maps/terrain-from-noise/#biomes
 */
interface ColorBand {
    height: number  // normalized height 0..1
    color: Color
}

const DEFAULT_COLOR_BANDS: ColorBand[] = [
    {height: 0.0, color: new Color(0x1a6b30)},  // rich dark green (low valleys)
    {height: 0.15, color: new Color(0x3a8c3a)}, // vibrant green (grass)
    {height: 0.3, color: new Color(0x6aaa42)},  // bright green (lush grass)
    {height: 0.45, color: new Color(0x8a9a3a)}, // yellow-green (dry grass)
    {height: 0.6, color: new Color(0x9a8a60)},  // tan (exposed earth)
    {height: 0.72, color: new Color(0x7a7a72)}, // warm gray (rock)
    {height: 0.85, color: new Color(0x9a9a95)}, // light gray (high rock)
    {height: 0.95, color: new Color(0xd8d8d0)}, // near-white (snow line)
    {height: 1.0, color: new Color(0xf5f5f0)},  // white (snow peak)
]

/** Sample color bands at normalized height t, writing result into `out`. */
function sampleColorBands(t: number, bands: ColorBand[], out: Color): Color {
    if (t <= bands[0].height) return out.copy(bands[0].color)
    if (t >= bands[bands.length - 1].height) return out.copy(bands[bands.length - 1].color)
    for (let i = 1; i < bands.length; i++) {
        if (t <= bands[i].height) {
            const prev = bands[i - 1]
            const curr = bands[i]
            const frac = (t - prev.height) / (curr.height - prev.height)
            return out.copy(prev.color).lerp(curr.color, frac)
        }
    }
    return out.copy(bands[bands.length - 1].color)
}

export class TerrainGenerator extends AProceduralGenerator<TerrainParams> {
    readonly type = 'terrain'

    defaultParams: TerrainParams = {
        type: 'terrain',
        size: 100,
        resolution: 128,
        seed: 42,
        octaves: 6,
        noiseScale: 0.02,
        heightScale: 20,
        waterLevel: 0,
        noiseType: 'fbm',
        lacunarity: 2.0,
        persistence: 0.5,
        exponent: 1.5,
        edgeFalloff: 0,
    }

    constructor() {
        super('terrain')
    }

    override createUiConfig(object: IObject3D): UiObjectConfig[] {
        const params = object.userData?.generationParams as TerrainParams
        if (!params) return []
        return [
            {type: 'slider', label: 'Seed', property: [params, 'seed'], bounds: [0, 99999], stepSize: 1},
            {type: 'slider', label: 'Size', property: [params, 'size'], bounds: [10, 500], stepSize: 1},
            {type: 'slider', label: 'Resolution', property: [params, 'resolution'], bounds: [16, 256], stepSize: 1},
            {type: 'slider', label: 'Height Scale', property: [params, 'heightScale'], bounds: [1, 100], stepSize: 0.5},
            {type: 'slider', label: 'Octaves', property: [params, 'octaves'], bounds: [1, 8], stepSize: 1},
            {type: 'slider', label: 'Noise Scale', property: [params, 'noiseScale'], bounds: [0.001, 0.2], stepSize: 0.001},
            {type: 'slider', label: 'Lacunarity', property: [params, 'lacunarity'], bounds: [1.0, 4.0], stepSize: 0.1},
            {type: 'slider', label: 'Persistence', property: [params, 'persistence'], bounds: [0.1, 0.9], stepSize: 0.05},
            {type: 'slider', label: 'Exponent', property: [params, 'exponent'], bounds: [0.5, 5.0], stepSize: 0.1},
            {type: 'slider', label: 'Edge Falloff', property: [params, 'edgeFalloff'], bounds: [0, 1], stepSize: 0.05},
            {type: 'slider', label: 'Water Level', property: [params, 'waterLevel'], bounds: [-50, 50], stepSize: 0.5},
            {
                type: 'dropdown',
                label: 'Noise Type',
                property: [params, 'noiseType'],
                children: [
                    {label: 'FBM', value: 'fbm'},
                    {label: 'Ridged', value: 'ridged'},
                ],
            },
        ]
    }

    generate(params: TerrainParams, _rng: SeededRandom): IObject3D {
        const root = new Group2()
        root.name = 'Terrain'

        // Clamp params to safe ranges to prevent NaN
        const size = Math.max(1, params.size)
        const resolution = Math.max(2, Math.min(512, Math.floor(params.resolution)))
        const seed = params.seed | 0
        const octaves = Math.max(1, Math.min(10, Math.floor(params.octaves)))
        const noiseScale = Math.max(0.0001, params.noiseScale)
        const heightScale = Math.max(0, params.heightScale)
        const waterLevel = params.waterLevel
        const noiseType = params.noiseType
        const lacunarity = Math.max(1, params.lacunarity)
        const persistence = Math.max(0.01, Math.min(1, params.persistence))
        const exponent = Math.max(0.1, params.exponent)
        const edgeFalloff = Math.max(0, Math.min(1, params.edgeFalloff))

        // Create terrain mesh
        const geo = PrimGen.grid(size, size, resolution, resolution)
        const positions = geo.getAttribute('position') as BufferAttribute
        const noise = createNoise2D(seed)

        const fbmOpts: FBMOptions = {octaves, lacunarity, persistence, scale: noiseScale}
        const noiseFn = noiseType === 'ridged' ? ridged : fbm
        const halfSize = size / 2

        // Displace Y by noise with redistribution and edge falloff
        let minY = Infinity, maxY = -Infinity
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i)
            const z = positions.getZ(i)

            // Raw noise in [0, 1] range
            let h = (noiseFn(noise, x, z, fbmOpts) + 1) * 0.5

            // Elevation redistribution — pow curve pushes mid-heights into valleys
            if (exponent !== 1.0) h = Math.pow(Math.max(0, h), exponent)

            // Edge falloff — smooth island shape
            if (edgeFalloff > 0) {
                const dx = Math.abs(x) / halfSize  // 0 at center, 1 at edge
                const dz = Math.abs(z) / halfSize
                const edgeDist = Math.max(dx, dz)
                const falloff = 1.0 - Math.pow(Math.min(1, edgeDist), 2)
                h *= 1.0 - edgeFalloff + edgeFalloff * falloff
            }

            const y = (h * 2 - 1) * heightScale  // map back to [-heightScale, heightScale]
            positions.setY(i, y)
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
        positions.needsUpdate = true

        // Vertex colors based on normalized height
        const heightRange = maxY - minY || 1
        const colors = new Float32Array(positions.count * 3)
        const tempColor = new Color()
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i)
            const t = (y - minY) / heightRange
            sampleColorBands(t, DEFAULT_COLOR_BANDS, tempColor).toArray(colors, i * 3)
        }
        geo.setAttribute('color', new BufferAttribute(colors, 3))

        // Recompute normals after displacement
        geo.computeVertexNormals()

        // Add slope-based darkening (steep = more rock-like)
        const normals = geo.getAttribute('normal') as BufferAttribute
        const up = new Vector3(0, 1, 0)
        const normalVec = new Vector3()
        const rockColor = new Color(0x6a6a62)
        for (let i = 0; i < normals.count; i++) {
            normalVec.set(normals.getX(i), normals.getY(i), normals.getZ(i))
            const slope = Math.acos(Math.min(1, Math.max(-1, normalVec.dot(up)))) * (180 / Math.PI)
            if (slope > 40) {
                const rockBlend = Math.min(1, (slope - 40) / 30)
                tempColor.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])
                tempColor.lerp(rockColor, rockBlend * 0.5)
                colors[i * 3] = tempColor.r
                colors[i * 3 + 1] = tempColor.g
                colors[i * 3 + 2] = tempColor.b
            }
        }
        (geo.getAttribute('color') as BufferAttribute).needsUpdate = true

        // Terrain material — uses vertex colors
        const terrainMat = new PhysicalMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.0,
            flatShading: false,
        })
        terrainMat.name = 'Terrain Material'

        const terrainMesh = new Mesh2(geo as any, terrainMat as any)
        terrainMesh.name = 'Terrain Mesh'
        terrainMesh.receiveShadow = true
        terrainMesh.castShadow = true
        root.add(terrainMesh)

        // Water plane
        if (waterLevel > minY) {
            const waterGeo = new PlaneGeometry(size * 1.2, size * 1.2)
            const waterMat = new PhysicalMaterial({
                color: 0x3388aa,
                roughness: 0.1,
                metalness: 0.1,
                transparent: true,
                opacity: 0.7,
                side: DoubleSide,
            })
            waterMat.name = 'Water Material'
            const waterMesh = new Mesh2(waterGeo as any, waterMat as any)
            waterMesh.name = 'Water'
            waterMesh.rotation.x = -Math.PI / 2
            waterMesh.position.y = waterLevel
            waterMesh.receiveShadow = true
            root.add(waterMesh)
        }

        return root
    }
}
