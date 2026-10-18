/**
 * Instances as draw lists: every real component a {@link GeometrySet} draws, with the world transforms it is drawn
 * at, so a renderer can make one instanced draw per component instead of realizing (copying) it per instance.
 *
 * What gets drawn follows Blender's realization (`realize_instances.cc` `gather_realize_tasks_recursive`): an
 * instance draws its reference's geometry - object references the object's evaluated geometry in object space,
 * collection references the collection's objects at their world matrices minus the instance offset
 * ({@link referenceToGeometry}) - and nested instances multiply their transforms. Node-safe, display only: the
 * transforms are composed in double precision and are not part of any parity result.
 */

import type {MeshData} from '@threepipe/mesh-kernel'
import {CurvesGeometry, InstanceReference, PointCloud} from '../geometry/components'
import {GeometrySet} from '../geometry/GeometrySet'
import {referenceToGeometry} from '../geometry/realizeInstances'
import type {SceneProvider} from '../runtime/context'

/** One real component and every transform it is drawn at. */
export interface DrawItem<T> {
    component: T
    /** Column-major 4x4 matrices, 16 per draw. */
    transforms: Float64Array
    count: number
}

export interface DrawList {
    meshes: DrawItem<MeshData>[]
    pointClouds: DrawItem<PointCloud>[]
    curves: DrawItem<CurvesGeometry>[]
    /** Draws in total (one per component per instance). */
    draws: number
}

class Collector<T> {
    readonly items = new Map<T, {transforms: number[]}>()

    add(component: T, m: ArrayLike<number>): void {
        let e = this.items.get(component)
        if (!e) this.items.set(component, e = {transforms: []})
        for (let k = 0; k < 16; k++) e.transforms.push(m[k])
    }

    list(): DrawItem<T>[] {
        return [...this.items].map(([component, e]) => ({component, transforms: Float64Array.from(e.transforms), count: e.transforms.length / 16}))
    }
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>, ob: number, out: Float64Array): Float64Array {
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r] * b[ob + c * 4] + a[4 + r] * b[ob + c * 4 + 1] + a[8 + r] * b[ob + c * 4 + 2] + a[12 + r] * b[ob + c * 4 + 3]
        }
    }
    return out
}

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** The draw list of `geometry`; `scene` resolves object and collection references. */
export function flattenInstances(geometry: GeometrySet, scene?: SceneProvider, maxDepth = 64): DrawList {
    const meshes = new Collector<MeshData>(), points = new Collector<PointCloud>(), curves = new Collector<CurvesGeometry>()
    // A reference resolves to the same geometry set each time, so its components are shared draw items.
    const resolved = new Map<string, GeometrySet>()
    const resolve = (ref: InstanceReference): GeometrySet | undefined => {
        if (ref.type === 'none') return undefined
        if (ref.type === 'geometry') return ref.geometry
        const key = `${ref.type}:${ref.name}`
        let g = resolved.get(key)
        if (!g) resolved.set(key, g = referenceToGeometry(ref, scene))
        return g
    }
    let draws = 0
    const visit = (g: GeometrySet, transform: Float64Array, depth: number) => {
        if (g.mesh && g.mesh.facesNum + g.mesh.edgesNum + g.mesh.vertsNum > 0) { meshes.add(g.mesh, transform); draws++ }
        if (g.pointCloud && g.pointCloud.pointsNum > 0) { points.add(g.pointCloud, transform); draws++ }
        if (g.curves && g.curves.curvesNum > 0) { curves.add(g.curves, transform); draws++ }
        const inst = g.instances
        if (!inst || depth >= maxDepth) return
        const handles = inst.referenceHandles
        const transforms = inst.transforms
        const children = inst.references.map(resolve)
        for (let i = 0; i < inst.instancesNum; i++) {
            const child = children[handles[i]]
            if (child) visit(child, multiply(transform, transforms, i * 16, new Float64Array(16)), depth + 1)
        }
    }
    visit(geometry, IDENTITY, 0)
    return {meshes: meshes.list(), pointClouds: points.list(), curves: curves.list(), draws}
}
