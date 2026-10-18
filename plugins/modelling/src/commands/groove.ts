/**
 * `groove`: a panel line - a narrow round-bottomed channel cut into a surface along a path, optionally with a dark
 * strip laid in it. The two ways product models draw seams between covers, doors and panels: a real groove
 * (here: a swept tube subtracted with the Manifold boolean) and a dark gap strip (the realism benchmark's reference
 * lays 9 black `GapsColor` strips into its seams, 16-realism.md §1.3).
 *
 * The path is given as points, or as a rounded-rectangle `outline` on a plane; with `project` each point is first
 * dropped onto the object along `-normal`, so the line follows a curved body.
 */

import {Matrix4, PhysicalMaterial, Color, Raycaster, Vector3, IObject3D} from 'threepipe'
import {meshBooleanManifold, Mat4, primitiveSweep, shadeSmooth} from '@threepipe/mesh-kernel'
import type {Vec3} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {readTarget, readVec3} from './params'
import {loadManifold} from '../manifold'
import {MATERIAL_PRESETS} from '../materials/presets'

type V3 = [number, number, number]
const norm = (a: V3): V3 => { const l = Math.hypot(...a); if (!(l > 0)) throw new Error('a zero-length direction'); return [a[0] / l, a[1] / l, a[2] / l] }
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Points round a rounded rectangle centred on `at` in the plane of `normal`, `up` its height direction. */
export function roundedRectPath(at: V3, normal: V3, up: V3, w: number, h: number, r: number, perCorner = 6): V3[] {
    const n = norm(normal), right = norm(cross(up, n)), u = cross(n, right)
    r = Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6)
    const out: V3[] = []
    const corners: [number, number, number][] = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]]
    for (const [cx, cy, a0] of corners) {
        for (let k = 0; k <= perCorner; k++) {
            const a = (a0 + 90 * k / perCorner) * Math.PI / 180
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
            out.push([at[0] + right[0] * x + u[0] * y, at[1] + right[1] * x + u[1] * y, at[2] + right[2] * x + u[2] * y])
        }
    }
    return out
}

export const grooveCommand: CommandDefinition = {
    op: 'groove',
    summary: 'Cut a panel line - a narrow groove along a path or round an outline - optionally with a dark gap strip in it.',
    description: 'Sweeps a round section of `width` along the path (world space) and subtracts it from `object` with the '
        + 'Manifold boolean, so the groove is real geometry `depth` deep. Give `path` (points; `closed` for a loop) or '
        + '`outline: {at, normal, up, size: [w, h], radius}` for a rounded-rectangle panel line. `project` (default on '
        + 'with an outline) drops each point onto the object along `-normal` first. `fill: true` lays a dark strip '
        + '(`gap-black`, or `fillPreset`) in the groove as its own object `<name>`, which is how seams read at a '
        + 'distance. Cut faces keep the object\'s material.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to cut.'),
        name: S.string('Name for the gap strip (with `fill`). Default `<object>-gap`.'),
        path: S.array('World points along the line.', {type: 'array', items: {type: 'number'}}),
        closed: S.boolean('The path is a loop. Default false (true for an outline).'),
        outline: {
            type: 'object', description: 'A rounded-rectangle line: `at` centre, `normal` out of the surface, `up`, `size` [w, h], `radius`.',
            properties: {at: {type: 'array'}, normal: {type: 'array'}, up: {type: 'array'}, size: {type: 'array'}, radius: {type: 'number'}},
            required: ['at', 'normal', 'size'], additionalProperties: false,
        },
        normal: S.vec3('Surface direction for `path` (projection and depth). Default the outline normal.'),
        project: S.boolean('Drop the points onto the object along -normal first. Default true with an outline or a normal.'),
        width: S.number('Groove width. Default 0.6.', {minimum: 0.01}),
        depth: S.number('Groove depth below the surface. Default width / 2.', {minimum: 0}),
        fill: S.boolean('Lay a dark strip in the groove. Default false.'),
        fillPreset: S.enum('Material preset of the strip. Default gap-black.', Object.keys(MATERIAL_PRESETS)),
        cut: S.boolean('Cut the groove. Default true; false only lays the strip (on a surface that cannot take a boolean).'),
    }, ['object']),

    async run(p: Record<string, unknown>, ctx) {
        const target = readTarget(p, ctx.doc)
        const width = (p.width as number | undefined) ?? 0.6, r = width / 2
        const depth = (p.depth as number | undefined) ?? r
        const o = p.outline as {at: number[], normal: number[], up?: number[], size: number[], radius?: number} | undefined
        let pts: V3[]
        let closed = (p.closed as boolean | undefined) ?? !!o
        let normal: V3 | undefined = p.normal ? norm(readVec3(p.normal, [0, 0, 1], 'normal') as V3) : undefined
        if (o) {
            normal = norm(o.normal as V3)
            pts = roundedRectPath(o.at as V3, normal, (o.up as V3 | undefined) ?? [0, 1, 0], o.size[0], o.size[1], o.radius ?? Math.min(o.size[0], o.size[1]) * 0.15)
            closed = true
        } else {
            pts = (p.path as V3[] | undefined) ?? []
            if (pts.length < 2) throw new Error('`path` needs at least two points, or give `outline`')
        }
        // drop onto the surface, keeping each point's surface normal to sink the groove along
        const project = (p.project as boolean | undefined) ?? !!normal
        const normals: V3[] = pts.map(() => normal ?? [0, 0, 1])
        if (project) {
            if (!normal) throw new Error('`project` needs `normal` (or an outline)')
            const obj = target.object as unknown as IObject3D
            obj.updateMatrixWorld?.(true)
            const ray = new Raycaster(), reach = 50 + width * 10
            let misses = 0
            pts = pts.map((q, i) => {
                ray.set(new Vector3(q[0] + normal![0] * reach, q[1] + normal![1] * reach, q[2] + normal![2] * reach), new Vector3(-normal![0], -normal![1], -normal![2]))
                ray.far = reach * 2
                const hit = ray.intersectObject(obj as never, true)[0]
                if (!hit) { misses++; return q }
                if (hit.face) {
                    const fn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
                    normals[i] = [fn.x, fn.y, fn.z]
                }
                return [hit.point.x, hit.point.y, hit.point.z]
            })
            if (misses) ctx.warn(`${misses} of ${pts.length} groove points missed "${target.name}" and stay where given`)
        }
        // the round section's centre sits (depth - r) under the surface: depth below it, r above
        const sink = depth - r
        const centre = pts.map((q, i) => [q[0] - normals[i][0] * sink, q[1] - normals[i][1] * sink, q[2] - normals[i][2] * sink] as Vec3)
        const tube = primitiveSweep({path: centre, radius: r, steps: 8, closed, capEnds: !closed})

        let faces = target.mesh.facesNum
        if ((p.cut as boolean | undefined) ?? true) {
            const api = await loadManifold()
            target.object.updateMatrixWorld(true)
            const toLocal = new Matrix4().copy(target.object.matrixWorld as Matrix4).invert()
            const transforms: Mat4[] = [new Matrix4().identity().toArray(), toLocal.toArray()]
            const result = meshBooleanManifold(api, [target.mesh, tube], 'DIFFERENCE', transforms, [[], []])
            if (result.error !== 'NONE' || !result.mesh) {
                throw new Error(result.error === 'NON_MANIFOLD'
                    ? `groove needs "${target.name}" closed and manifold (check with validate), or use cut: false`
                    : 'the groove boolean failed')
            }
            ctx.doc.setMesh(target, result.mesh)
            faces = result.mesh.facesNum
        }
        let strip: string | null = null
        if (p.fill) {
            // the strip lies in the groove: a thinner tube whose top stays just under the surface and whose bottom
            // stays above the groove floor
            const gap = Math.min(0.05, depth * 0.2), sr = Math.max(0.01, Math.min(r * 0.8, (depth - gap) / 2)), ssink = sr + gap
            const scentre = pts.map((q, i) => [q[0] - normals[i][0] * ssink, q[1] - normals[i][1] * ssink, q[2] - normals[i][2] * ssink] as Vec3)
            const mesh = primitiveSweep({path: scentre, radius: sr, steps: 8, closed, capEnds: !closed})
            shadeSmooth(mesh, false)
            const entry = ctx.doc.add(mesh, {name: (p.name as string | undefined) ?? `${target.name}-gap`})
            const preset = MATERIAL_PRESETS[(p.fillPreset as string | undefined) ?? 'gap-black']
            const mat = entry.object.material as PhysicalMaterial
            mat.color = new Color(preset.color)
            mat.roughness = preset.roughness
            mat.metalness = preset.metalness
            mat.setDirty?.()
            strip = entry.name
        }
        return {objects: [target.name, ...(strip ? [strip] : [])], data: {points: pts.length, closed, width, depth, faces, strip}}
    },
}

export const grooveCommands = [grooveCommand]
