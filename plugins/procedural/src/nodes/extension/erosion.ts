/**
 * `ThreepipeErosion`: hydraulic (droplet) and thermal erosion of a square grid mesh's heights (`src/extension/erosion.ts`).
 * A threepipe extension node, not a Blender node. Blender cannot evaluate graphs that use it.
 *
 * The mesh must be a square grid as the Grid node makes it: vertex `i * n + j` at `(x0 + i * step, y0 + j * step)`,
 * with heights in Z. The kit's grid is row-major over (x, z) with heights in Y, so cell `j * n + i` of the kit
 * is vertex `i * n + j` here.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {erode} from '../../extension/erosion'
import {AttributeFieldInput, FieldContext, FieldEvaluation, GField} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshTagPositionsChanged} from '../../geometry/meshRuntime'
import {registerNodeType} from '../../runtime/registry'

const MASKS = ['Flow', 'Deposit', 'Eroded', 'Talus'] as const

/** The grid's size and spacing; throws when the mesh is not a square Grid-node grid. */
function gridShape(p: Float32Array, vertsNum: number): {n: number, step: number} {
    const n = Math.round(Math.sqrt(vertsNum))
    if (n < 3 || n * n !== vertsNum) throw new Error('ThreepipeErosion: the mesh must be a square grid (Grid node, Vertices X = Vertices Y >= 3)')
    const step = p[3 * n] - p[0]
    const tol = Math.abs(step) * 1e-4
    if (!(step > 0) || Math.abs((p[4] - p[1]) - step) > tol) throw new Error('ThreepipeErosion: the grid must have square cells along +X and +Y')
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const v = (i * n + j) * 3
            if (Math.abs(p[v] - (p[0] + i * step)) > tol || Math.abs(p[v + 1] - (p[1] + j * step)) > tol) {
                throw new Error('ThreepipeErosion: the mesh vertices are not a regular grid in Grid-node order')
            }
        }
    }
    return {n, step}
}

registerNodeType({
    idname: 'ThreepipeErosion',
    label: 'Erosion (threepipe)',
    dslName: 'ThreepipeErosion',
    extension: {source: 'webgi-worlds kit/erosion.ts (Beyer 2015 / Lague hydraulic erosion, Olsen 2004 thermal erosion)'},
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Hydraulic').default(true)
        b.input('FLOAT', 'Droplets per Cell').default(2).min(0)
        b.input('INT', 'Seed').default(1)
        b.input('INT', 'Radius').default(3).min(1)
        b.input('FLOAT', 'Inertia').default(0.05).min(0).max(1)
        b.input('FLOAT', 'Capacity').default(4).min(0)
        b.input('FLOAT', 'Min Capacity').default(0.01).min(0)
        b.input('FLOAT', 'Erode Speed').default(0.3).min(0).max(1)
        b.input('FLOAT', 'Deposit Speed').default(0.3).min(0).max(1)
        b.input('FLOAT', 'Evaporate Speed').default(0.01).min(0).max(1)
        b.input('FLOAT', 'Gravity').default(4).min(0)
        b.input('INT', 'Lifetime').default(30).min(1)
        b.input('BOOLEAN', 'Thermal').default(false)
        b.input('FLOAT', 'Thermal Angle').default(35).min(0).max(89)
        b.input('INT', 'Thermal Iterations').default(80).min(0)
        b.input('FLOAT', 'Weight').default(1).min(0).max(1).field()
        b.output('GEOMETRY', 'Mesh')
        for (const m of MASKS) b.output('FLOAT', m).field()
    },
    execute(p) {
        const weightField = p.field('Weight')
        const opts = {
            hydraulic: p.bool('Hydraulic') ? {
                dropletsPerCell: p.float('Droplets per Cell'), seed: p.int('Seed'), radius: p.int('Radius'), inertia: p.float('Inertia'),
                capacity: p.float('Capacity'), minCapacity: p.float('Min Capacity'), erodeSpeed: p.float('Erode Speed'),
                depositSpeed: p.float('Deposit Speed'), evaporateSpeed: p.float('Evaporate Speed'), gravity: p.float('Gravity'),
                lifetime: p.int('Lifetime'),
            } : undefined,
            thermal: p.bool('Thermal') ? {angle: p.float('Thermal Angle'), iterations: p.int('Thermal Iterations')} : undefined,
        }
        const names = MASKS.map(m => (p.outputUsed(m) ? p.anonymousName(m) : undefined))
        const out = foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.meshForWrite()
            if (!mesh) return
            const pos = mesh.attributes.get('position')!.data as Float32Array
            const {n, step} = gridShape(pos, mesh.vertsNum)
            const weight = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Point), mesh.vertsNum).evaluate(weightField)
            const kit = (i: number, j: number) => j * n + i
            const hs = new Float32Array(n * n)
            const w = new Float32Array(n * n)
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    hs[kit(i, j)] = pos[(i * n + j) * 3 + 2]
                    w[kit(i, j)] = weight.get(i * n + j)
                }
            }
            const half = (n - 1) * step / 2
            // The kit's weight callback takes world (x, z); map back to the cell.
            const masks = erode(hs, n, step, {...opts, weight: (x, z) => w[kit(Math.round((x + half) / step), Math.round((z + half) / step))]})
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pos[(i * n + j) * 3 + 2] = hs[kit(i, j)]
            meshTagPositionsChanged(mesh)
            const values = [masks.flow, masks.deposit, masks.eroded, masks.talus]
            const attrs = g.attributesForWrite('mesh')!
            names.forEach((name, k) => {
                if (!name) return
                const data = new Float32Array(n * n)
                for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) data[i * n + j] = values[k][kit(i, j)]
                attrs.remove(name)
                attrs.add(name, AttrDomain.Point, 'float', data)
            })
        }, p.options.scene)
        p.set('Mesh', out)
        MASKS.forEach((m, k) => {
            const name = names[k]
            if (name) p.set(m, GField.fromInput(new AttributeFieldInput(name, 'float')))
        })
    },
})
