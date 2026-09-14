/**
 * FlowerGenerator — Procedural rose generator.
 * Ported from repeat_zone_flower_by_MiRA.blend.
 *
 * 8 rings × 6 petals by default. Each petal is a deformed grid mesh shaped by:
 * Rhombus, Roundness, Forke, Bend, Roll, CurlValue, Rotation, and Scale.
 * Parameters interpolate from inner to outer rings via MapRange.
 *
 * Verified: 1232/1232 petal vertices within 0.002 of Blender ground truth.
 */

import {
    BufferGeometry, DoubleSide, Float32BufferAttribute,
    Group2, Matrix4, Mesh2, MeshStandardMaterial,
    type IObject3D, type UiObjectConfig,
} from 'threepipe'
import {AProceduralGenerator} from '../AProceduralGenerator'
import {SeededRandom} from '../utils/SeededRandom'
import {mapRange} from '../blender/math_nodes'
import {createPetalVertices as createPetalVerticesMath} from './flower-math'

// ─── Parameters ─────────────────────────────────────────────────────

export interface FlowerParams {
    seed: number
    iterations: number
    verticesX: number
    verticesY: number
    petalsPerRing: number
    circleRadius: number
    petalColor: number
    // Per-ring interpolation ranges (MapRange from ring 0 → ring N)
    bendMin: number
    bendMax: number
    rollMin: number
    rollMax: number
    curlMin: number
    curlMax: number
    scaleXMin: number
    scaleXMax: number
    scaleYMin: number
    scaleYMax: number
    rhombus: number
    roundness: number
    forke: number
    rotXMinDeg: number
    rotXMaxDeg: number
    rotYMinDeg: number
    rotYMaxDeg: number
    rotZMinDeg: number
    rotZMaxDeg: number
}

// Petal vertex generation is in flower-math.ts (verified, Node-safe, single source of truth).

const DEG2RAD = Math.PI / 180

// ─── Three.js geometry builder ──────────────────────────────────────

function petalToGeometry(pos: Float64Array, nx: number, ny: number): BufferGeometry {
    const N = nx * ny
    const geo = new BufferGeometry()
    const f32 = new Float32Array(N * 3)
    for (let i = 0; i < N * 3; i++) f32[i] = pos[i]
    geo.setAttribute('position', new Float32BufferAttribute(f32, 3))

    const indices: number[] = []
    for (let ix = 0; ix < nx - 1; ix++) {
        for (let iy = 0; iy < ny - 1; iy++) {
            const a = ix * ny + iy, b = (ix + 1) * ny + iy
            const c = (ix + 1) * ny + (iy + 1), d = ix * ny + (iy + 1)
            indices.push(a, b, d, b, c, d)
        }
    }
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
}

// ─── Generator ──────────────────────────────────────────────────────

const INT_PROPS = new Set(['seed', 'iterations', 'verticesX', 'verticesY', 'petalsPerRing', 'rhombus'])
const COLOR_PROPS = new Set(['petalColor'])

export class FlowerGenerator extends AProceduralGenerator<FlowerParams> {
    constructor() {
        super('flower')
    }

    defaultParams: FlowerParams = {
        seed: 42,
        iterations: 8,
        verticesX: 14,
        verticesY: 11,
        petalsPerRing: 6,
        circleRadius: 0.001,
        petalColor: 0xcc3355,
        bendMin: -3.1, bendMax: -8.0,
        rollMin: 0, rollMax: 13.9,
        curlMin: 4.2, curlMax: 4.2,
        scaleXMin: 1.0, scaleXMax: 0.8,
        scaleYMin: 0.8, scaleYMax: 0.3,
        rhombus: 150, roundness: 1.0, forke: 0.1,
        // Rotation comes from Group.003 (bypasses animation controller)
        rotXMinDeg: -3.1, rotXMaxDeg: 13.5,
        rotYMinDeg: -30.2, rotYMaxDeg: -63.1,
        rotZMinDeg: -60, rotZMaxDeg: 106.5,
    }

    override createUiConfig(object: IObject3D): UiObjectConfig[] {
        const ui = super.createUiConfig(object)
        for (const item of ui) {
            const prop = (item as any).property
            const key = Array.isArray(prop) ? prop[1] : undefined
            if (!key) continue
            if (INT_PROPS.has(key)) { item.type = 'number'; (item as any).stepSize = 1 }
            if (COLOR_PROPS.has(key)) item.type = 'color'
        }
        return ui
    }

    generate(params: FlowerParams, _rng: SeededRandom): IObject3D {
        const p = params
        const root = new Group2()
        root.name = 'Flower'

        const mat = new MeshStandardMaterial({
            color: p.petalColor,
            roughness: 0.6,
            side: DoubleSide,
        })

        for (let id = 0; id < p.iterations; id++) {
            const t = p.iterations > 1 ? id / p.iterations : 0
            const petalParams = {
                waveWidth: 0.02,
                wrinkleScale: 0,
                wrinkleHeight: 0.02,
                bend: mapRange(t, 0, 1, p.bendMin, p.bendMax),
                roll: mapRange(t, 0, 1, p.rollMin, p.rollMax),
                curlValue: mapRange(t, 0, 1, p.curlMin, p.curlMax),
                scale: [
                    mapRange(t, 0, 1, p.scaleXMin, p.scaleXMax),
                    mapRange(t, 0, 1, p.scaleYMin, p.scaleYMax),
                    mapRange(t, 0, 1, p.scaleXMin, p.scaleXMax),
                ] as [number, number, number],
                forke: p.forke,
                roundness: p.roundness,
                rhombus: p.rhombus,
                rotation: [
                    mapRange(t, 0, 1, p.rotXMinDeg, p.rotXMaxDeg) * DEG2RAD,
                    mapRange(t, 0, 1, p.rotYMinDeg, p.rotYMaxDeg) * DEG2RAD,
                    mapRange(t, 0, 1, p.rotZMinDeg, p.rotZMaxDeg) * DEG2RAD,
                ] as [number, number, number],
            }
            const pos = createPetalVerticesMath(petalParams, p.verticesX, p.verticesY)
            const geo = petalToGeometry(pos, p.verticesX, p.verticesY)
            const z = id * 0.01

            for (let ci = 0; ci < p.petalsPerRing; ci++) {
                const angle = (2 * Math.PI * ci) / p.petalsPerRing
                const cx = Math.cos(angle) * p.circleRadius
                const cy = Math.sin(angle) * p.circleRadius

                const mesh = new Mesh2(geo as any, mat as any)
                mesh.applyMatrix4(
                    new Matrix4().makeTranslation(cx, cy, z)
                        .multiply(new Matrix4().makeRotationZ(angle)),
                )
                mesh.castShadow = true
                mesh.receiveShadow = true
                root.add(mesh)
            }
        }

        // Blender Z-up → three.js Y-up
        root.rotation.x = -Math.PI / 2

        return root
    }
}
