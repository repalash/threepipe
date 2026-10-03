/**
 * Shared parameter reading and the geometry-space transform helpers the commands lean on.
 *
 * Commands arrive as loose JSON, so every value gets read through one of these rather than being
 * trusted. The transform helpers exist because "move this object" and "move these 40 vertices" are
 * the same maths applied in two different spaces, and writing it twice is how the two drift apart.
 */

import {Euler, Matrix4, Quaternion, Vector3} from 'threepipe'
import {AttrDomain, AttrName, MeshData} from '@threepipe/mesh-kernel'
import {ModellingDocument, ModellingEntry} from '../document'

export type Vec3Tuple = [number, number, number]

/** Read an `[x, y, z]`, a `{x, y, z}` or a single number meaning all three. */
export function readVec3(value: unknown, fallback: Vec3Tuple = [0, 0, 0], label = 'vector'): Vec3Tuple {
    if (value === undefined || value === null) return [...fallback] as Vec3Tuple
    if (typeof value === 'number') {
        if (!isFinite(value)) throw new Error(`${label} must be finite`)
        return [value, value, value]
    }
    if (Array.isArray(value)) {
        if (value.length !== 3) throw new Error(`${label} must have 3 components, got ${value.length}`)
        return value.map((n, i) => {
            if (typeof n !== 'number' || !isFinite(n)) throw new Error(`${label}[${i}] must be a finite number`)
            return n
        }) as Vec3Tuple
    }
    if (typeof value === 'object') {
        const o = value as Record<string, unknown>
        const get = (k: string, d: number) => {
            const n = o[k]
            if (n === undefined) return d
            if (typeof n !== 'number' || !isFinite(n)) throw new Error(`${label}.${k} must be a finite number`)
            return n
        }
        return [get('x', fallback[0]), get('y', fallback[1]), get('z', fallback[2])]
    }
    throw new Error(`${label} must be [x, y, z], {x, y, z} or a single number`)
}

/** Read a list of points: `[[x,y,z], ...]`, or `[[u,v], ...]` for a 2D profile. */
export function readPoints(value: unknown, label: string, allow2D = false): number[][] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array of points`)
    return value.map((p, i) => {
        if (!Array.isArray(p)) throw new Error(`${label}[${i}] must be an array`)
        if (p.length === 2 && allow2D) return [p[0], p[1]]
        if (p.length !== 3) {
            throw new Error(`${label}[${i}] must have ${allow2D ? '2 or 3' : '3'} numbers, got ${p.length}`)
        }
        for (const n of p) if (typeof n !== 'number' || !isFinite(n)) throw new Error(`${label}[${i}] has a non-finite value`)
        return [...p]
    })
}

/** Read the `object` / `objects` pair that most commands accept. */
export function readTargets(
    params: Record<string, unknown>, doc: ModellingDocument, required = true,
): ModellingEntry[] {
    const ref = (params.objects ?? params.object) as string | string[] | undefined
    if (ref === undefined) {
        if (!required) return []
        throw new Error('this command needs an "object" (a name) or "objects" (a list of names)')
    }
    return doc.resolve(ref as string | string[])
}

/** Read exactly one target. */
export function readTarget(params: Record<string, unknown>, doc: ModellingDocument): ModellingEntry {
    const list = readTargets(params, doc)
    if (list.length !== 1) throw new Error(`this command works on one object at a time, got ${list.length}`)
    return list[0]
}

// region transforms

/**
 * The matrix a `move` / `rotate` / `scale` / `pivot` parameter set describes.
 *
 * Order is scale, then rotate, then translate, all about `pivot` - the order every modelling tool
 * uses, and the one that makes "scale 0.9 about the hull centre" mean what a person expects.
 */
export function transformMatrix(spec: {
    move?: Vec3Tuple, rotate?: Vec3Tuple, scale?: Vec3Tuple, pivot?: Vec3Tuple,
}): Matrix4 {
    const pivot = new Vector3(...(spec.pivot ?? [0, 0, 0]))
    const m = new Matrix4().compose(
        new Vector3(...(spec.move ?? [0, 0, 0])),
        new Quaternion().setFromEuler(new Euler(...(spec.rotate ?? [0, 0, 0]))),
        new Vector3(...(spec.scale ?? [1, 1, 1])))
    if (pivot.lengthSq() === 0) return m
    return new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
        .multiply(m)
        .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}

/** Apply a matrix to a subset of a mesh's vertices, in place. Pass `null` for all of them. */
export function transformMeshVerts(mesh: MeshData, matrix: Matrix4, verts: number[] | null): void {
    const pos = mesh.positions
    const v = new Vector3()
    const indices = verts ?? range(mesh.vertsNum)
    for (const i of indices) {
        if (i < 0 || i >= mesh.vertsNum) {
            throw new Error(`vertex ${i} is out of range - the mesh has ${mesh.vertsNum}`)
        }
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(matrix)
        pos[i * 3] = v.x
        pos[i * 3 + 1] = v.y
        pos[i * 3 + 2] = v.z
    }
}

/**
 * Move an object by a transform spec, about a pivot in the object's parent space.
 *
 * This changes the object's transform, not its geometry - the distinction Blender draws between
 * object mode and edit mode, and the reason a later `vertices` command still addresses the same
 * vertex ids after the object has been placed.
 */
export function transformObject(entry: ModellingEntry, matrix: Matrix4): void {
    const o = entry.object
    o.updateMatrix()
    const composed = matrix.clone().multiply(o.matrix)
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    composed.decompose(p, q, s)
    o.position.copy(p)
    o.quaternion.copy(q)
    o.scale.copy(s)
    o.updateMatrix()
    o.setDirty?.()
}

/** The vertex ids a command's `verts` / `faces` selection resolves to, or `null` for the whole mesh. */
export function readVertSelection(
    params: Record<string, unknown>, mesh: MeshData,
): number[] | null {
    const verts = params.verts as unknown
    const faces = params.faces as unknown
    if (verts === undefined && faces === undefined) return null

    const out = new Set<number>()
    if (verts !== undefined) {
        for (const i of readIntList(verts, 'verts')) out.add(i)
    }
    if (faces !== undefined) {
        for (const f of readIntList(faces, 'faces')) {
            if (f < 0 || f >= mesh.facesNum) {
                throw new Error(`face ${f} is out of range - the mesh has ${mesh.facesNum}`)
            }
            for (const v of mesh.faceVerts(f)) out.add(v)
        }
    }
    return [...out]
}

/** Read `[1, 2, 3]` or `{from, to}` - the report's "selective ID range". */
export function readIntList(value: unknown, label: string): number[] {
    if (Array.isArray(value)) {
        return value.map((n, i) => {
            if (!Number.isInteger(n)) throw new Error(`${label}[${i}] must be a whole number`)
            return n as number
        })
    }
    if (value && typeof value === 'object') {
        const o = value as Record<string, unknown>
        const from = o.from
        const to = o.to
        if (Number.isInteger(from) && Number.isInteger(to)) {
            const out: number[] = []
            for (let i = from as number; i <= (to as number); i++) out.push(i)
            return out
        }
    }
    throw new Error(`${label} must be a list of indices or {from, to}`)
}

export function range(n: number): number[] {
    const out = new Array<number>(n)
    for (let i = 0; i < n; i++) out[i] = i
    return out
}

// endregion

/** Axis-aligned bounds of a mesh in its own space. */
export function meshBounds(mesh: MeshData): {min: Vec3Tuple, max: Vec3Tuple, size: Vec3Tuple, center: Vec3Tuple} {
    const pos = mesh.positions
    const min: Vec3Tuple = [Infinity, Infinity, Infinity]
    const max: Vec3Tuple = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < mesh.vertsNum; i++) {
        for (let k = 0; k < 3; k++) {
            const v = pos[i * 3 + k]
            if (v < min[k]) min[k] = v
            if (v > max[k]) max[k] = v
        }
    }
    if (!mesh.vertsNum) return {min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0]}
    return {
        min, max,
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    }
}

/**
 * Set or clear the `sharp_face` flag on every face, which is what "flat" and "smooth" shading mean
 * on the kernel side. `auto` leaves the mesh alone and lets the bake decide from face angles.
 */
export function setShading(mesh: MeshData, shading: 'flat' | 'smooth' | 'auto'): void {
    if (shading === 'auto') return
    const layer = mesh.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool')
    const data = layer.data as Uint8Array
    data.fill(shading === 'flat' ? 1 : 0)
}
