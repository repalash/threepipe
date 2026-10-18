/**
 * `decal`: printed markings - logos, legends, scale numbers - as their own thin objects carrying a texture, the way
 * product models usually do it (the realism benchmark's reference keeps its prints on decal meshes that follow
 * the body, with a shared texture; 16-realism.md §1.2, §5).
 *
 * The geometry is a grid of quads with a `uv` layer: flat (`plane`), dropped onto another object's surface by
 * casting rays along the decal normal (`project`, what three's `DecalGeometry` does by clipping, done here as a
 * conforming grid so it stays an editable quad mesh), or bent round an axis (`wrap`, for text round a lens ring).
 * The texture is SVG - `content.svg`, or `content.text`, which becomes one SVG `<text>` - rasterised by the
 * browser. A Node session has no rasteriser: it builds the geometry and warns that the print is missing.
 */

import {AttrDomain, MeshData, shadeSmooth} from '@threepipe/mesh-kernel'
import {CanvasTexture, Color, IObject3D, PhysicalMaterial, Raycaster, SRGBColorSpace, Vector3} from 'threepipe'
import {CommandDefinition, S, schema} from './types'
import {readTarget, readVec3} from './params'
import {MATERIAL_PRESETS} from '../materials/presets'

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a); if (!(l > 0)) throw new Error('a zero-length direction'); return mul(a, 1 / l) }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface DecalText {
    text: string
    color?: string
    fontFamily?: string
    fontWeight?: string | number
    fontStyle?: string
    /** Font size as a fraction of the decal height. Default 0.8. */
    fontScale?: number
    /** Stretch the text to the decal width (SVG `textLength`). */
    fit?: boolean
    letterSpacing?: number
    align?: 'start' | 'middle' | 'end'
}

/** The SVG for a decal's content, `w` x `h` pixels. Exported for tests. */
export function decalSvg(content: {svg?: string, text?: DecalText}, w: number, h: number): string {
    if (content.svg) return content.svg
    const t = content.text
    if (!t) throw new Error('`content` needs `svg` or `text`')
    const fs = (t.fontScale ?? 0.8) * h
    const anchor = t.align ?? 'middle'
    const x = anchor === 'start' ? 0 : anchor === 'end' ? w : w / 2
    const attrs = [
        `x="${x}"`, `y="${h / 2}"`, `text-anchor="${anchor}"`, 'dominant-baseline="central"',
        `font-family="${esc(t.fontFamily ?? 'Helvetica, Arial, sans-serif')}"`, `font-size="${fs.toFixed(2)}"`,
        `font-weight="${t.fontWeight ?? 'normal'}"`, `font-style="${t.fontStyle ?? 'normal'}"`, `fill="${esc(t.color ?? '#ffffff')}"`,
        t.letterSpacing ? `letter-spacing="${t.letterSpacing * fs}"` : '',
        t.fit ? `textLength="${(w * 0.98).toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '',
    ].filter(Boolean).join(' ')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text ${attrs}>${esc(t.text)}</text></svg>`
}

/**
 * A quad grid `nx` x `ny` with a `uv` corner layer (u right, v up), positions from `at(u, v)`, which returns null for
 * a point to leave out (a projected point that missed): faces touching such a point are dropped. Exported for tests.
 */
export function decalGrid(nx: number, ny: number, at: (u: number, v: number) => V3 | null): MeshData {
    const pts: (V3 | null)[] = []
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pts.push(at(i / nx, j / ny))
    const id = (i: number, j: number) => j * (nx + 1) + i
    const gridFaces: number[][] = []
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const q = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]
        if (q.every(g => pts[g])) gridFaces.push(q)
    }
    if (!gridFaces.length) throw new Error('the decal has no faces left: every grid cell missed the surface')
    // vertices keep grid order (row by row), skipping the unused ones
    const used = new Set(gridFaces.flat()), index = new Map<number, number>(), positions: number[] = [], gridOf: number[] = []
    for (let g = 0; g < pts.length; g++) if (used.has(g)) { index.set(g, gridOf.length); gridOf.push(g); positions.push(...pts[g]!) }
    const faces = gridFaces.map(q => q.map(g => index.get(g)!))
    const mesh = MeshData.fromFaces({positions, faces})
    const uv = mesh.attributes.ensure('uv', AttrDomain.Corner, 'float2').data
    const CV = mesh.cornerVerts
    for (let c = 0; c < mesh.cornersNum; c++) {
        const g = gridOf[CV[c]], i = g % (nx + 1), j = Math.floor(g / (nx + 1))
        uv[2 * c] = i / nx
        uv[2 * c + 1] = j / ny
    }
    shadeSmooth(mesh, false)
    return mesh
}

async function rasterise(svg: string, w: number, h: number): Promise<CanvasTexture> {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 8
    return tex
}

export const decalCommand: CommandDefinition = {
    op: 'decal',
    summary: 'A printed marking - text, logo or legend - as a thin textured object on a surface.',
    description: 'Builds a grid of quads `size` [width, height] across, centred on `at`, and textures it with `content` '
        + '(SVG, or `text` turned into SVG). `mode`: `plane` - flat, facing `normal`; `project` - each grid point dropped '
        + 'onto `object` along `-normal` and lifted by `offset`, so the print follows a curved body (cells that miss it are '
        + 'left out); `wrap` - bent round '
        + '`wrap.axis` through `wrap.center` at the radius of `at` (or `wrap.radius`), width measured along the arc, for '
        + 'text round a lens ring. `up` is the text\'s up direction. The print is rasterised by the browser; in a Node '
        + 'session only the geometry is made.',
    mutates: true,
    schema: schema({
        name: S.string('Name of the new decal object. Default `decal`.'),
        object: S.objectRef('`project`: the object to drop the decal onto.'),
        mode: S.enum('plane, project or wrap. Default plane.', ['plane', 'project', 'wrap']),
        at: S.vec3('Centre of the decal (on or near the surface), world space.'),
        normal: S.vec3('Facing direction (out of the surface). Required for plane and project.'),
        up: S.vec3('Up direction of the print. Default +y, or the wrap axis.'),
        size: S.array('[width, height] in scene units. Width is along the arc for wrap.', {type: 'number'}),
        offset: S.number('Lift off the surface, scene units. Default 0.05.'),
        segments: S.array('[across, up] grid segments. Default [1, 1] for plane, [24, 6] for project and wrap.', {type: 'integer'}),
        wrap: {
            type: 'object', description: 'wrap: the axis direction and a point on it; `radius` defaults to the distance of `at` from the axis.',
            properties: {axis: {type: 'array', items: {type: 'number'}}, center: {type: 'array', items: {type: 'number'}}, radius: {type: 'number'}},
            required: ['axis', 'center'], additionalProperties: false,
        },
        content: {
            type: 'object', description: '`svg` (a full SVG document) or `text` {text, color, fontFamily, fontWeight, fontStyle, fontScale, fit, letterSpacing, align}.',
            properties: {svg: {type: 'string'}, text: {type: 'object'}},
            additionalProperties: false,
        },
        pxPerUnit: S.number('Raster resolution, pixels per scene unit. Default 24 (about 0.04 mm per pixel at mm scale).'),
        preset: S.enum('Material preset for the print. Default print-white.', Object.keys(MATERIAL_PRESETS)),
        roughness: S.number('Override the preset roughness.', {minimum: 0, maximum: 1}),
    }, ['at', 'size', 'content']),

    async run(p: Record<string, unknown>, ctx) {
        const mode = (p.mode as string | undefined) ?? 'plane'
        const at = readVec3(p.at, [0, 0, 0], 'at') as V3
        const [w, h] = p.size as number[]
        if (!(w > 0 && h > 0)) throw new Error('`size` must be [width, height], both positive')
        const offset = (p.offset as number | undefined) ?? 0.05
        const seg = (p.segments as number[] | undefined) ?? (mode === 'plane' ? [1, 1] : [24, 6])
        const [nx, ny] = [Math.max(1, seg[0] | 0), Math.max(1, (seg[1] ?? seg[0]) | 0)]
        let mesh: MeshData

        if (mode === 'wrap') {
            const wrap = p.wrap as {axis: number[], center: number[], radius?: number} | undefined
            if (!wrap) throw new Error('mode wrap needs `wrap: {axis, center}`')
            const axis = norm(wrap.axis as V3), c = wrap.center as V3
            const rel = sub(at, c), along = dot(rel, axis), radial = sub(rel, mul(axis, along))
            const r0 = wrap.radius ?? Math.hypot(...radial)
            if (!(r0 > 0)) throw new Error('`at` is on the wrap axis: give `wrap.radius`')
            const e1 = norm(radial), e2 = cross(axis, e1)
            const upGiven = p.up ? norm(readVec3(p.up, [0, 1, 0], 'up') as V3) : axis
            const s = dot(upGiven, axis) >= 0 ? 1 : -1  // text up along +axis or -axis
            // the print reads from outside: right = up x outward normal = s (axis x e1) = s e2 at the centre
            const r = r0 + offset, span = w / r0
            mesh = decalGrid(nx, ny, (u, v) => {
                const ang = s * (u - 0.5) * span
                const out = add(mul(e1, Math.cos(ang)), mul(e2, Math.sin(ang)))
                return add(add(c, mul(axis, along + s * (v - 0.5) * h)), mul(out, r))
            })
        } else {
            const n = norm(readVec3(p.normal, [0, 0, 0], 'normal') as V3)
            const up0 = readVec3(p.up, [0, 1, 0], 'up') as V3
            const right = norm(cross(up0, n)), up = cross(n, right)
            const point = (u: number, v: number) => add(at, add(mul(right, (u - 0.5) * w), mul(up, (v - 0.5) * h)))
            if (mode === 'plane') mesh = decalGrid(nx, ny, (u, v) => add(point(u, v), mul(n, offset)))
            else if (mode === 'project') {
                const target = readTarget(p, ctx.doc)
                const obj = target.object as unknown as IObject3D
                obj.updateMatrixWorld?.(true)
                const ray = new Raycaster()
                const reach = Math.max(w, h) * 2
                let misses = 0
                mesh = decalGrid(nx, ny, (u, v) => {
                    const q = point(u, v)
                    ray.set(new Vector3(...add(q, mul(n, reach))), new Vector3(...mul(n, -1)))
                    ray.far = reach * 2
                    const hit = ray.intersectObject(obj as never, true)[0]
                    if (!hit) { misses++; return null }
                    const fn = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new Vector3(...n)
                    return [hit.point.x + fn.x * offset, hit.point.y + fn.y * offset, hit.point.z + fn.z * offset]
                })
                if (misses) ctx.warn(`${misses} of ${(nx + 1) * (ny + 1)} decal points missed "${target.name}"; the cells around them are left out`)
            } else throw new Error(`unknown mode "${mode}" - use plane, project or wrap`)
        }

        const entry = ctx.doc.add(mesh, {name: (p.name as string | undefined) ?? 'decal'})
        const mat = entry.object.material as PhysicalMaterial
        const preset = MATERIAL_PRESETS[(p.preset as string | undefined) ?? 'print-white']
        if (!preset) throw new Error(`unknown preset "${p.preset}"`)
        mat.color = new Color('#ffffff')
        mat.roughness = (p.roughness as number | undefined) ?? preset.roughness
        mat.metalness = preset.metalness
        mat.transparent = true
        mat.depthWrite = false

        const ppu = (p.pxPerUnit as number | undefined) ?? 24
        const scale = Math.min(1, 2048 / Math.max(w * ppu, h * ppu))
        const pw = Math.max(8, Math.round(w * ppu * scale)), ph = Math.max(8, Math.round(h * ppu * scale))
        const svg = decalSvg(p.content as {svg?: string, text?: DecalText}, pw, ph)
        let printed = false
        if (ctx.viewer.renderManager.webglRenderer) {
            mat.map = await rasterise(svg, pw, ph) as never
            mat.needsUpdate = true
            printed = true
        } else {
            ctx.warn('this session cannot rasterise (a Node session): the decal geometry is made, its print is not - run it in a browser session')
        }
        mat.setDirty?.()
        return {objects: [entry.name], data: {name: entry.name, mode, verts: mesh.vertsNum, faces: mesh.facesNum, raster: [pw, ph], printed}}
    },
}

export const decalCommands = [decalCommand]
