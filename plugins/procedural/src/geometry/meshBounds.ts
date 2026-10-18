/**
 * Bounds of geometry components as Blender's `bounds_min_max()` computes them: `Mesh::bounds_min_max`
 * (`blenkernel/intern/mesh.cc:1923`, the eager bounds a primitive set, else the min/max of the positions),
 * `PointCloud::bounds_min_max` (`pointcloud.cc:251`, padded by the radius), and
 * `GeometrySet::compute_boundbox_without_instances` (`geometry_set.cc:179`).
 *
 * Mesh bounds are cached in the mesh runtime (`Mesh::runtime->bounds_cache`, `meshRuntime.ts`): computed on demand or
 * set eagerly by a primitive (`Mesh::bounds_set_eager`, `mesh.cc:1944`), shared by copies and dropped when the positions
 * change.
 */

import {MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import type {GeometrySet} from './GeometrySet'
import {meshRuntime} from './meshRuntime'
import type {CurvesGeometry} from './components'
import {CURVE_TYPE_POLY, CurvesEvaluator, curveTypes} from './curvesEval'

export interface Bounds3 {
    min: [number, number, number]
    max: [number, number, number]
}

/** `Mesh::bounds_set_eager` (`mesh.cc:1944`): `bounds_cache.ensure` - kept when bounds are already cached. */
export function meshBoundsSetEager(mesh: MeshData, bounds: Bounds3): void {
    const r = meshRuntime(mesh)
    if (!r.bounds) r.bounds = {min: [...bounds.min], max: [...bounds.max]}
}

/** The cached bounds (`bounds_cache.is_cached()` / `data()`), if any. */
export function meshCachedBounds(mesh: MeshData): Bounds3 | undefined {
    return meshRuntime(mesh).bounds
}

/** `bounds::min_max` over flat xyz triples (`BLI_bounds.hh`). */
function minMax(positions: ArrayLike<number>, count: number): Bounds3 | undefined {
    if (!count) return undefined
    const b: Bounds3 = {min: [positions[0], positions[1], positions[2]], max: [positions[0], positions[1], positions[2]]}
    for (let i = 1; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            const v = positions[i * 3 + k]
            if (v < b.min[k]) b.min[k] = v
            if (v > b.max[k]) b.max[k] = v
        }
    }
    return b
}

/** `bounds::merge`. */
export function mergeBounds(a: Bounds3 | undefined, b: Bounds3 | undefined): Bounds3 | undefined {
    if (!a) return b
    if (!b) return a
    return {
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    }
}

/** `Mesh::bounds_min_max` (`mesh.cc:1923`): `bounds_cache.ensure(min_max(positions))`. */
export function meshBoundsMinMax(mesh: MeshData): Bounds3 | undefined {
    if (mesh.vertsNum === 0) return undefined
    const r = meshRuntime(mesh)
    return r.bounds ??= minMax(mesh.positions, mesh.vertsNum)
}

/**
 * `calculate_bounds_radial_primitive` (`geometry/intern/mesh_primitive_uv_sphere.cc:17`): analytic bounds of the
 * round primitives, `std::cos`/`std::sin` of floats.
 */
export function boundsRadialPrimitive(radiusTop: number, radiusBottom: number, segments: number, height: number): Bounds3 {
    const radius = radiusTop < radiusBottom ? radiusBottom : radiusTop
    const deltaPhi = f32((2 * Math.PI) / segments)
    const roundf = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x))
    const xMax = radius
    const xMin = f32(f32(Math.cos(f32(roundf(f32(0.5 * segments)) * deltaPhi))) * radius)
    const yMax = f32(f32(Math.sin(f32(roundf(f32(0.25 * segments)) * deltaPhi))) * radius)
    return {min: [xMin, -yMax, -height], max: [xMax, yMax, height]}
}

/**
 * `GeometrySet::compute_boundbox_without_instances(use_radius)` (`geometry_set.cc:179`): point cloud, mesh and
 * curves bounds merged (volumes and grease pencil are not components here).
 */
export function computeBoundboxWithoutInstances(g: GeometrySet, useRadius: boolean): Bounds3 | undefined {
    let bounds: Bounds3 | undefined
    const pc = g.pointCloud
    if (pc && pc.pointsNum) {
        let b = minMax(pc.positions, pc.pointsNum)!
        if (useRadius) {
            const layer = pc.attributes.get('radius')
            // `PointCloud::radius()` is the single default 0.01 (`pointcloud.cc:205`): `Bounds::pad`.
            b = layer ? minMaxWithRadii(pc.positions, layer.data, pc.pointsNum) : padBounds(b, f32(0.01))
        }
        bounds = mergeBounds(bounds, b)
    }
    if (g.mesh) bounds = mergeBounds(bounds, meshBoundsMinMax(g.mesh))
    if (g.curves && g.curves.curvesNum) bounds = mergeBounds(bounds, curvesBoundsMinMax(g.curves, useRadius))
    return bounds
}

/** `Bounds::pad` (`BLI_bounds_types.hh`). */
function padBounds(b: Bounds3, r: number): Bounds3 {
    return {min: b.min.map(v => f32(v - r)) as [number, number, number], max: b.max.map(v => f32(v + r)) as [number, number, number]}
}

/** `bounds::min_max_with_radii` (`BLI_bounds.hh:119`): starts from the first position itself. */
function minMaxWithRadii(p: ArrayLike<number>, r: ArrayLike<number>, count: number): Bounds3 {
    const b: Bounds3 = {min: [p[0], p[1], p[2]], max: [p[0], p[1], p[2]]}
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            const lo = f32(p[i * 3 + k] - r[i]), hi = f32(p[i * 3 + k] + r[i])
            if (lo < b.min[k]) b.min[k] = lo
            if (b.max[k] < hi) b.max[k] = hi
        }
    }
    return b
}

/** `CurvesGeometry::bounds_min_max(use_radius)` (`curves_geometry.cc:1386`). */
export function curvesBoundsMinMax(curves: CurvesGeometry, useRadius: boolean): Bounds3 | undefined {
    if (curves.curvesNum === 0) return undefined
    const ev = new CurvesEvaluator(curves)
    if (!useRadius) return minMax(ev.positions, ev.evaluatedPointsNum)
    const radius = curves.attributes.get('radius')
    // `radius()` is the single default 0.01 without the attribute.
    if (!radius) return padBounds(minMax(ev.positions, ev.evaluatedPointsNum)!, f32(0.01))
    const types = curveTypes(curves)
    if (Array.prototype.every.call(types, (t: number) => t === CURVE_TYPE_POLY)) return minMaxWithRadii(curves.positions, radius.data, curves.pointsNum)
    const radii = new Float32Array(ev.evaluatedPointsNum)
    for (let c = 0; c < curves.curvesNum; c++) {
        const [s, e] = curves.pointsRange(c)
        const [es, ee] = ev.evaluatedRange(c)
        ev.interpolateToEvaluated(c, 'float', (radius.data as Float32Array).subarray(s, e), radii.subarray(es, ee))
    }
    return minMaxWithRadii(ev.positions, radii, ev.evaluatedPointsNum)
}
