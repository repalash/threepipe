/**
 * `look` - render what the session built, and say what was rendered.
 *
 * `capture` returns pixels and nothing else; an agent then has to guess what it is looking at. `look`
 * returns the image *and* a description of it: which camera, which objects are in frame, how many of
 * the highlighted elements there are and where they landed on the image. The image is for the eyes,
 * the description is for checking the eyes against.
 *
 * Shape of the options follows the `look` tool of mcp-for-blender 2.x (viewport / camera / multi-angle
 * sheet; solid / material / wireframe / x-ray), plus `highlight`, which build123d-mcp's `render_view`
 * showed is the high-value part: an agent can check that "edge 5" is the edge it means before it bevels
 * it. The code is ours.
 *
 * It never leaves anything behind. The camera, the materials and the canvas go back to how they were,
 * so a `look` from an agent does not move the view of a person watching the same editor.
 */

import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Color,
    Frustum,
    ICamera,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    OrthographicCamera2,
    PerspectiveCamera2,
    PhysicalMaterial,
    Points,
    PointsMaterial,
    Scene,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {bakeGeometry} from '@threepipe/mesh-kernel'
import {CommandContext, CommandDefinition, S, schema} from './types'
import {readIntList} from './params'
import {ModellingEntry} from '../document'
import {applyCamera, orthographicFrustumFor, STANDARD_VIEWS, worldBounds} from './session'

export type LookStyle = 'solid' | 'material' | 'wireframe' | 'xray'

/** The four views of an `angles` sheet, in reading order. */
export const ANGLES_SHEET = ['front', 'right', 'top', 'iso'] as const

/** Above this many highlighted elements, indices are not drawn as labels - they would be noise. */
const MAX_LABELS = 64

const HIGHLIGHT = {
    face: new Color('#ff8c1a'),
    edge: new Color('#ffb000'),
    vert: new Color('#ffffff'),
}

interface CameraState {
    position: Vector3
    target: Vector3
    fov: number | null
    frustumSize: number | null
}

export interface LookViewDescription {
    /** `front`, `iso`, `viewport`, `ref:front`, a saved view name, or `custom`. */
    name: string
    /** Where this view sits in the returned image, in pixels: `[x, y, width, height]`. */
    rect: [number, number, number, number]
    camera: {
        position: number[], target: number[], up: number[],
        projection: 'perspective' | 'orthographic', fov?: number, frustumSize?: number,
    }
    /** Document objects whose world box is entirely inside the frustum. */
    inFrame: string[]
    /** Document objects cut by the frame edge. */
    partial: string[]
    /** Where the highlighted elements landed: their pixel box in the image, and how many fell outside. */
    highlight?: {rect: [number, number, number, number] | null, offscreen: number}
}

export const lookCommand: CommandDefinition = {
    op: 'look',
    summary: 'Render the model and describe what was rendered: views, objects in frame, highlighted elements.',
    description:
        'The eyes, after the ruler: run `measure`, `inspect` and `selftest` first, then `look` to see it. '
        + 'Returns an image (`data.image`, a data URL, or a file at `path`) and a JSON description of each '
        + 'view in it: camera, objects fully and partly in frame, and where the highlighted elements are.\n\n'
        + '`view`: `angles` (default) is an auto-framed 2x2 sheet - front, right, top, iso. `viewport` is '
        + 'exactly what the person at the screen sees now; `camera` is where the last `camera` command '
        + 'left it, even if someone has orbited since. `front`/`back`/`left`/`right`/`top`/`bottom`/`iso` '
        + 'frame one standard view, `ref:<name>` looks square-on at a reference plane, any other string is '
        + 'a saved camera view, and `{position, target}` is explicit.\n\n'
        + '`style`: `solid` (flat grey, for silhouettes), `material`, `wireframe`, `xray` (see-through, '
        + 'for hidden structure). `highlight: {object, faces|edges|verts}` draws those elements in orange '
        + '(dimmed where hidden) - use it to check an index before an edit spends it. Indices are the '
        + 'ones `inspect {detail: true}` lists. `labels` writes the indices (or object names) on the image.\n\n'
        + 'Nothing is changed: the camera, materials and viewport go back to how they were.',
    mutates: false,
    schema: schema({
        view: {
            description: '`angles` (default), `viewport`, `camera`, a standard view name, `ref:<name>`, a '
                + 'saved view name, or `{position: [x,y,z], target: [x,y,z]}`.',
            oneOf: [
                {type: 'string'},
                {type: 'object', properties: {position: {type: 'array'}, target: {type: 'array'}},
                    required: ['position', 'target'], additionalProperties: false},
            ],
        },
        style: S.enum('Shading. Default `solid`.', ['solid', 'material', 'wireframe', 'xray']),
        fit: S.objectRef('What auto-framed views frame. Default: the highlighted object, else everything.'),
        highlight: {
            type: 'object',
            description: 'Elements to draw over the render: `{object, faces?, edges?, verts?}`, indices as '
                + 'lists or `{from, to}`. `{object}` alone highlights the whole object.',
            properties: {
                object: {type: 'string'},
                faces: {},
                edges: {},
                verts: {},
            },
            required: ['object'],
            additionalProperties: false,
        },
        labels: S.boolean('Write highlighted indices, or object names when nothing is highlighted, on the image.'),
        size: {
            description: 'Image width in pixels, or `[width, height]`. Default 640 for one view, 960 for `angles`.',
            oneOf: [{type: 'integer', minimum: 64, maximum: 4096},
                {type: 'array', items: {type: 'integer'}, minItems: 2, maxItems: 2}],
        },
        format: S.enum('Image format. Default `jpeg` - a tenth of the bytes, which matters to an agent.',
            ['png', 'jpeg']),
        quality: S.number('JPEG quality, 0 to 1. Default 0.85.', {minimum: 0, maximum: 1}),
        padding: S.number('Framing margin for auto-framed views: 1 just fits the bounding sphere. Default 1.05.'),
        path: S.string('Also write the image to this file (Node, or a page with a file sink).'),
        overlays: S.boolean('Draw editor widgets (grid, gizmos, selection) too. Default: on for `viewport` and '
            + '`camera`, off for every auto-framed view.'),
        includeImage: S.boolean('Return the data URL in the result. Default true; false with `path` keeps the result small.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const viewer = ctx.viewer
        const canvas = viewer.canvas
        if (!viewer.renderManager.webglRenderer) {
            throw new Error('this session cannot render - it has no WebGL context (a Node session on the '
                + 'DummyRenderManager polyfill). Use a browser session: `threepipe-modelling look` and the MCP '
                + '`look` tool start one for you.')
        }
        const style = (p.style as LookStyle | undefined) ?? 'solid'
        const format = (p.format as 'png' | 'jpeg' | undefined) ?? 'jpeg'
        const quality = (p.quality as number | undefined) ?? 0.85
        const viewParam = p.view ?? 'angles'
        const views: (string | {position: number[], target: number[]})[] =
            viewParam === 'angles' ? [...ANGLES_SHEET] : [viewParam as string]

        const highlight = p.highlight ? readHighlight(p.highlight as Record<string, unknown>, ctx) : null
        const fitEntries = readFit(p, ctx, highlight?.entry ?? null)

        // Output layout: one cell per view, cells keep the canvas aspect.
        const aspect = canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 4 / 3
        const cols = views.length > 1 ? 2 : 1
        const rows = Math.ceil(views.length / cols)
        const size = p.size
        let width: number
        let height: number
        if (Array.isArray(size)) {
            width = size[0] as number
            height = size[1] as number
        } else {
            width = (size as number | undefined) ?? (views.length > 1 ? 960 : 640)
            height = Math.round(width / cols / aspect * rows)
        }
        const cellW = Math.floor(width / cols)
        const cellH = Math.floor(height / rows)

        const out = document.createElement('canvas')
        out.width = width
        out.height = height
        const g = out.getContext('2d')
        if (!g) throw new Error('no 2D canvas context to compose the image into')
        g.fillStyle = '#202226'
        g.fillRect(0, 0, width, height)

        const camera = viewer.scene.mainCamera
        const saved = saveCamera(camera)
        const restoreMaterials = applyStyle(style, ctx)
        const overlays = (p.overlays as boolean | undefined) ?? (viewParam === 'viewport' || viewParam === 'camera')
        const restoreWidgets = overlays ? () => undefined : hideWidgets(viewer)
        const overlay = highlight ? buildOverlay(highlight, ctx) : null
        const described: LookViewDescription[] = []
        try {
            for (let i = 0; i < views.length; i++) {
                const view = views[i]
                const name = setView(view, p, ctx, fitEntries, saved)
                const rect: [number, number, number, number] =
                    [(i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH]

                ctx.plugin.renderFrame()
                if (overlay) overlay.draw(viewer, camera)
                g.drawImage(canvas, rect[0], rect[1], rect[2], rect[3])

                const description = describeView(name, rect, camera, ctx)
                if (highlight) {
                    const screen = projectHighlight(highlight, camera, rect)
                    description.highlight = {rect: screen.rect, offscreen: screen.offscreen}
                    if (p.labels) drawLabels(g, screen.labels, rect)
                } else if (p.labels) {
                    drawLabels(g, objectLabels(ctx.doc.entries, camera, rect), rect)
                }
                if (views.length > 1) drawCaption(g, name, rect)
                described.push(description)
            }
        } finally {
            overlay?.dispose()
            restoreWidgets()
            restoreMaterials()
            restoreCamera(viewer, saved)
            viewer.setDirty()
        }

        const mime = format === 'png' ? 'image/png' : 'image/jpeg'
        const dataUrl = out.toDataURL(mime, quality)
        const path = (p.path as string | undefined) ?? null
        if (path) {
            await ctx.plugin.writeCapture({dataUrl, width, height, label: null, path})
        }
        const box = worldBounds(fitEntries)
        return {
            data: {
                image: p.includeImage === false ? undefined : dataUrl,
                path,
                format,
                width,
                height,
                bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4),
                style,
                views: described,
                framed: fitEntries.map(e => e.name),
                bounds: box.isEmpty() ? null : {
                    min: box.min.toArray().map(round), max: box.max.toArray().map(round),
                    size: box.getSize(new Vector3()).toArray().map(round),
                },
                highlight: highlight ? {
                    object: highlight.entry.name,
                    faces: highlight.faces.length,
                    edges: highlight.edges.length,
                    verts: highlight.verts.length,
                } : null,
            },
        }
    },
}

// region views

function saveCamera(camera: ICamera): CameraState {
    const ortho = (camera as {isOrthographicCamera?: boolean}).isOrthographicCamera
    return {
        position: camera.position.clone(),
        target: camera.target.clone(),
        fov: ortho ? null : (camera as PerspectiveCamera2).fov,
        frustumSize: ortho ? (camera as OrthographicCamera2).frustumSize : null,
    }
}

function restoreCamera(viewer: ThreeViewer, s: CameraState): void {
    const camera = viewer.scene.mainCamera
    if (s.frustumSize !== null) (camera as OrthographicCamera2).frustumSize = s.frustumSize
    applyCamera(viewer, s.position, s.target)
}

/** Point the camera for one view, and return the view's name for the description. */
function setView(
    view: string | {position: number[], target: number[]}, p: Record<string, unknown>,
    ctx: CommandContext, fit: ModellingEntry[], saved: CameraState,
): string {
    const viewer = ctx.viewer
    const camera = viewer.scene.mainCamera
    const ortho = !!(camera as {isOrthographicCamera?: boolean}).isOrthographicCamera

    if (typeof view === 'object') {
        applyCamera(viewer, new Vector3().fromArray(view.position), new Vector3().fromArray(view.target))
        return 'custom'
    }
    if (view === 'viewport') {
        applyCamera(viewer, saved.position, saved.target)
        return 'viewport'
    }
    if (view === 'camera') {
        const s = ctx.plugin.sessionCamera
        if (!s) {
            ctx.warn('no `camera` command has run in this session, so `camera` is the current viewport')
            applyCamera(viewer, saved.position, saved.target)
        } else {
            applyCamera(viewer, new Vector3(...s.position), new Vector3(...s.target))
        }
        return 'camera'
    }
    if (view.startsWith('ref:')) {
        const state = ctx.plugin.references.get(view.slice(4))
        if (!state) {
            const names = [...ctx.plugin.references.keys()]
            throw new Error(`no reference "${view.slice(4)}"` + (names.length ? ` - have: ${names.join(', ')}` : ''))
        }
        const centre = state.object.getWorldPosition(new Vector3())
        const normal = state.object.getWorldDirection(new Vector3())
        let distance: number
        if (ortho) {
            (camera as OrthographicCamera2).frustumSize = state.height
            distance = Math.max(state.width, state.height) * 2
        } else {
            distance = state.height / 2 / Math.tan((camera as PerspectiveCamera2).fov * Math.PI / 360)
        }
        applyCamera(viewer, centre.clone().addScaledVector(normal, distance), centre)
        return view
    }
    const dir = STANDARD_VIEWS[view]
    if (!dir) {
        const views = viewer.getPlugin<any>('CameraViews')
        const savedView = views?.camViews?.find((v: any) => v.name === view)
        if (!savedView) {
            throw new Error(`unknown view "${view}" - use angles, viewport, camera, `
                + `${Object.keys(STANDARD_VIEWS).join(', ')}, ref:<name>, a saved view, or {position, target}`)
        }
        views.setView(savedView)
        applyCamera(viewer, null, camera.target.clone())
        return view
    }

    const box = worldBounds(fit)
    const target = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3())
    if (box.isEmpty()) ctx.warn('nothing to frame - the document is empty')
    const padding = (p.padding as number | undefined) ?? 1.05
    const distance = ortho
        ? Math.max(0.05, box.getSize(new Vector3()).length() * 1.5)
        : box.isEmpty() ? 5 : Math.max(0.05, sphereFitDistance(camera as PerspectiveCamera2, box) * padding)
    const position = target.clone().addScaledVector(new Vector3(...dir).normalize(), distance)
    applyCamera(viewer, position, target)
    if (ortho && !box.isEmpty()) {
        (camera as OrthographicCamera2).frustumSize = orthographicFrustumFor(camera, box, 1 + padding * 0.1 / 1.4)
        viewer.scene.refreshActiveCameraNearFar()
    }
    return view
}

/**
 * The distance at which the box's bounding sphere fits the frame in both directions.
 *
 * Fitting the sphere rather than the box (as `getFittingDistance` does for `camera`) is what makes
 * every direction of a sheet - including the diagonal iso view, where a box's corners stick out
 * furthest - keep the whole subject in frame, so `inFrame` is true of what the image shows.
 */
function sphereFitDistance(camera: PerspectiveCamera2, box: Box3): number {
    const radius = box.getSize(new Vector3()).length() / 2
    const vertical = camera.fov * Math.PI / 180
    const aspect = isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect)
    return radius / Math.sin(Math.min(vertical, horizontal) / 2)
}

function readFit(p: Record<string, unknown>, ctx: CommandContext, highlighted: ModellingEntry | null): ModellingEntry[] {
    const fit = p.fit
    if (fit === undefined) return highlighted ? [highlighted] : ctx.doc.entries.filter(e => e.object.visible)
    if (fit === '*' || fit === 'all') return ctx.doc.entries.filter(e => e.object.visible)
    return ctx.doc.resolve(fit as string | string[])
}

function describeView(
    name: string, rect: [number, number, number, number], camera: ICamera, ctx: CommandContext,
): LookViewDescription {
    camera.updateMatrixWorld(true)
    const ortho = !!(camera as {isOrthographicCamera?: boolean}).isOrthographicCamera
    const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const inFrame: string[] = []
    const partial: string[] = []
    for (const e of ctx.doc.entries) {
        if (!e.object.visible) continue
        e.object.updateWorldMatrix(true, false)
        const box = new Box3().expandByObject(e.object as never)
        if (box.isEmpty() || !frustum.intersectsBox(box)) continue
        let inside = true
        for (let i = 0; i < 8 && inside; i++) {
            const c = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y,
                i & 4 ? box.max.z : box.min.z)
            if (!frustum.containsPoint(c)) inside = false
        }
        ;(inside ? inFrame : partial).push(e.name)
    }
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    return {
        name, rect,
        camera: {
            position: camera.position.toArray().map(round),
            target: camera.target.toArray().map(round),
            up: up.toArray().map(round),
            projection: ortho ? 'orthographic' : 'perspective',
            ...ortho ? {frustumSize: round((camera as OrthographicCamera2).frustumSize)}
                : {fov: round((camera as PerspectiveCamera2).fov)},
        },
        inFrame, partial,
    }
}

// endregion

// region style

/**
 * Switch every document material to a look style, and return how to put them back.
 *
 * Properties are set and restored rather than materials swapped, so nothing re-registers with the
 * material manager and no shader recompiles. A `display {mode: 'solid'}` already in force keeps the
 * real colour in `userData.__modellingSolidColor`; `material` style reads it from there.
 */
function applyStyle(style: LookStyle, ctx: CommandContext): () => void {
    const restores: (() => void)[] = []
    const seen = new Set<unknown>()
    for (const e of ctx.doc.entries) {
        const mat = e.object.material as PhysicalMaterial | undefined
        if (!mat || seen.has(mat) || !mat.color) continue
        seen.add(mat)
        const before = {
            color: mat.color.clone(), wireframe: mat.wireframe, transparent: mat.transparent,
            opacity: mat.opacity, depthWrite: mat.depthWrite, roughness: mat.roughness, metalness: mat.metalness,
        }
        restores.push(() => {
            mat.color.copy(before.color)
            mat.wireframe = before.wireframe
            mat.transparent = before.transparent
            mat.opacity = before.opacity
            mat.depthWrite = before.depthWrite
            mat.roughness = before.roughness
            mat.metalness = before.metalness
            mat.setDirty?.()
        })
        const real = mat.userData.__modellingSolidColor as string | undefined
        if (style === 'material') {
            if (ctx.plugin.displayMode === 'solid' && real) mat.color.set(real)
            mat.wireframe = false
        } else {
            mat.color.set('#c8c8c8')
            mat.roughness = 0.8
            mat.metalness = 0
            mat.wireframe = style === 'wireframe'
            if (style === 'xray') {
                mat.transparent = true
                mat.opacity = 0.3
                mat.depthWrite = false
            } else {
                mat.transparent = false
                mat.opacity = 1
                mat.depthWrite = true
            }
        }
        mat.setDirty?.()
    }
    return () => {
        for (const r of restores) r()
    }
}

/**
 * Hide editor widgets - the grid, transform gizmos, selection boxes - for the duration of a look.
 *
 * threepipe marks these `isWidget` (asset type `widget`, `IObject.isWidget`); its own scene-bounds code
 * skips them the same way (`RootScene` ignoreWidgets). They describe the editor, not the model.
 */
function hideWidgets(viewer: ThreeViewer): () => void {
    const hidden: {visible: boolean}[] = []
    viewer.scene.traverse((o: any) => {
        if (!o.visible) return
        if (o.isWidget || o.assetType === 'widget' || o.userData?.isWidgetRoot) {
            o.visible = false
            hidden.push(o)
        }
    })
    return () => {
        for (const o of hidden) o.visible = true
    }
}

// endregion

// region highlight

interface Highlight {
    entry: ModellingEntry
    faces: number[]
    edges: number[]
    verts: number[]
}

function readHighlight(h: Record<string, unknown>, ctx: CommandContext): Highlight {
    if (typeof h.object !== 'string') throw new Error('`highlight.object` must name one object')
    const entry = ctx.doc.require(h.object)
    const mesh = entry.mesh
    const read = (key: 'faces' | 'edges' | 'verts', count: number) => {
        if (h[key] === undefined) return []
        const list = readIntList(h[key], `highlight.${key}`)
        for (const i of list) {
            if (i < 0 || i >= count) {
                throw new Error(`highlight.${key}: ${i} is out of range - "${entry.name}" has ${count}`)
            }
        }
        return [...new Set(list)]
    }
    const out: Highlight = {
        entry,
        faces: read('faces', mesh.facesNum),
        edges: read('edges', mesh.edgesNum),
        verts: read('verts', mesh.vertsNum),
    }
    // `{object}` alone: the whole object.
    if (h.faces === undefined && h.edges === undefined && h.verts === undefined) {
        out.faces = Array.from({length: mesh.facesNum}, (_, i) => i)
    }
    return out
}

/** World-space anchor of each highlighted element, for labels and the screen box. */
function highlightAnchors(h: Highlight): {label: string, p: Vector3}[] {
    const mesh = h.entry.mesh
    const pos = mesh.positions
    const m = h.entry.object.matrixWorld
    const vert = (i: number) => new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
    const out: {label: string, p: Vector3}[] = []
    for (const f of h.faces) {
        const c = new Vector3()
        const vs = mesh.faceVerts(f)
        for (const v of vs) c.add(vert(v))
        out.push({label: `f${f}`, p: c.multiplyScalar(1 / vs.length).applyMatrix4(m)})
    }
    const ev = mesh.edgeVerts
    for (const e of h.edges) {
        out.push({label: `e${e}`, p: vert(ev[e * 2]).add(vert(ev[e * 2 + 1])).multiplyScalar(0.5).applyMatrix4(m)})
    }
    for (const v of h.verts) out.push({label: `v${v}`, p: vert(v).applyMatrix4(m)})
    return out
}

function projectHighlight(h: Highlight, camera: ICamera, rect: [number, number, number, number]) {
    camera.updateMatrixWorld(true)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let offscreen = 0
    const labels: {text: string, x: number, y: number}[] = []
    const anchors = highlightAnchors(h)
    for (const a of anchors) {
        const s = toScreen(a.p, camera, rect)
        if (!s) {
            offscreen++
            continue
        }
        minX = Math.min(minX, s.x)
        minY = Math.min(minY, s.y)
        maxX = Math.max(maxX, s.x)
        maxY = Math.max(maxY, s.y)
        if (anchors.length <= MAX_LABELS) labels.push({text: a.label, x: s.x, y: s.y})
    }
    const r: [number, number, number, number] | null = isFinite(minX)
        ? [Math.round(minX), Math.round(minY), Math.round(maxX - minX), Math.round(maxY - minY)] : null
    return {rect: r, offscreen, labels}
}

function objectLabels(entries: ModellingEntry[], camera: ICamera, rect: [number, number, number, number]) {
    camera.updateMatrixWorld(true)
    const out: {text: string, x: number, y: number}[] = []
    for (const e of entries.slice(0, MAX_LABELS)) {
        if (!e.object.visible) continue
        const box = new Box3().expandByObject(e.object as never)
        if (box.isEmpty()) continue
        const s = toScreen(box.getCenter(new Vector3()), camera, rect)
        if (s) out.push({text: e.name, x: s.x, y: s.y})
    }
    return out
}

/** A world point to pixels inside `rect`, or null when it is behind the camera or outside the frame. */
function toScreen(p: Vector3, camera: ICamera, rect: [number, number, number, number]) {
    const ndc = p.clone().project(camera)
    if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null
    return {x: rect[0] + (ndc.x + 1) / 2 * rect[2], y: rect[1] + (1 - ndc.y) / 2 * rect[3]}
}

/**
 * The highlight overlay: a cheap second pass drawn straight onto the canvas after the frame.
 *
 * Nothing is added to the scene graph - the overlay is its own `Scene`, so no outliner, picking,
 * export or undo listener ever sees it. Occlusion comes from a depth-only pre-pass of the document's
 * own geometry; hidden elements are then drawn dim with the depth test off, visible ones bright with
 * it on, so "the edge at the back" still shows, and shows as being at the back.
 */
function buildOverlay(h: Highlight, ctx: CommandContext) {
    const depthScene = new Scene()
    const depthMaterial = new MeshBasicMaterial({colorWrite: false})
    for (const e of ctx.doc.entries) {
        if (!e.object.visible) continue
        const m = new Mesh(e.object.geometry as unknown as BufferGeometry, depthMaterial)
        m.matrixAutoUpdate = false
        e.object.updateWorldMatrix(true, false)
        m.matrix.copy(e.object.matrixWorld)
        m.matrixWorld.copy(e.object.matrixWorld)
        depthScene.add(m)
    }

    const mesh = h.entry.mesh
    const pos = mesh.positions
    const disposables: {dispose(): void}[] = [depthMaterial]
    const world = h.entry.object.matrixWorld

    // Faces: the selected faces' own tessellation, so a concave n-gon highlights as drawn.
    let faceGeometry: BufferGeometry | null = null
    if (h.faces.length) {
        const {data, triangleToFace} = bakeGeometry(mesh, {includeNormals: false})
        const wanted = new Set(h.faces)
        const tris: number[] = []
        for (let t = 0; t < triangleToFace.length; t++) {
            if (!wanted.has(triangleToFace[t])) continue
            for (let k = 0; k < 3; k++) {
                const i = data.index[t * 3 + k]
                tris.push(data.position[i * 3], data.position[i * 3 + 1], data.position[i * 3 + 2])
            }
        }
        faceGeometry = new BufferGeometry()
        faceGeometry.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3))
        disposables.push(faceGeometry)
    }

    // Verts: screen-sized points.
    let pointGeometry: BufferGeometry | null = null
    if (h.verts.length) {
        const pts = new Float32Array(h.verts.length * 3)
        h.verts.forEach((v, i) => pts.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], i * 3))
        pointGeometry = new BufferGeometry()
        pointGeometry.setAttribute('position', new BufferAttribute(pts, 3))
        disposables.push(pointGeometry)
    }

    const pass = (hidden: boolean) => {
        const opacity = hidden ? 0.3 : 1
        const common = {transparent: true, depthTest: !hidden, depthWrite: false, toneMapped: false}
        const scene = new Scene()
        const add = (o: Mesh | Points) => {
            o.matrixAutoUpdate = false
            o.matrix.copy(world)
            o.matrixWorld.copy(world)
            scene.add(o)
        }
        if (faceGeometry) {
            const m = new MeshBasicMaterial({color: HIGHLIGHT.face, opacity: opacity * 0.55, side: 2,
                polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, ...common})
            disposables.push(m)
            add(new Mesh(faceGeometry, m))
        }
        const edgeMaterial = new MeshBasicMaterial({color: HIGHLIGHT.edge, opacity, side: 2,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, ...common})
        disposables.push(edgeMaterial)
        if (pointGeometry) {
            const m = new PointsMaterial({color: HIGHLIGHT.vert, size: 7, sizeAttenuation: false, opacity, ...common})
            disposables.push(m)
            add(new Points(pointGeometry, m))
        }
        return {scene, edgeMaterial}
    }
    const hiddenPass = pass(true)
    const visiblePass = pass(false)

    return {
        draw(viewer: ThreeViewer, camera: ICamera) {
            const renderer = viewer.renderManager.webglRenderer
            camera.updateMatrixWorld(true)
            // Edges are camera-facing ribbons a fixed number of pixels wide: GL lines are one pixel
            // everywhere WebGL runs, which is invisible in a 640-pixel sheet.
            const ribbons = h.edges.length ? edgeRibbons(h, camera, renderer.domElement.height) : null
            const ribbonMeshes: Mesh[] = []
            if (ribbons) {
                for (const p of [hiddenPass, visiblePass]) {
                    const m = new Mesh(ribbons, p.edgeMaterial)
                    p.scene.add(m)
                    ribbonMeshes.push(m)
                }
            }
            const autoClear = renderer.autoClear
            const target = renderer.getRenderTarget()
            renderer.autoClear = false
            renderer.setRenderTarget(null)
            try {
                renderer.clearDepth()
                renderer.render(depthScene, camera)
                renderer.render(hiddenPass.scene, camera)
                renderer.render(visiblePass.scene, camera)
            } finally {
                renderer.autoClear = autoClear
                renderer.setRenderTarget(target)
                for (const m of ribbonMeshes) m.removeFromParent()
                ribbons?.dispose()
            }
        },
        dispose() {
            for (const d of disposables) d.dispose()
        },
    }
}

/** Quads along each highlighted edge, facing the camera, `px` pixels wide at their depth. World space. */
function edgeRibbons(h: Highlight, camera: ICamera, viewportHeight: number, px = 3): BufferGeometry {
    const mesh = h.entry.mesh
    const pos = mesh.positions
    const ev = mesh.edgeVerts
    const world = h.entry.object.matrixWorld
    const eye = camera.getWorldPosition(new Vector3())
    const ortho = !!(camera as {isOrthographicCamera?: boolean}).isOrthographicCamera
    const out = new Float32Array(h.edges.length * 18)
    const a = new Vector3()
    const b = new Vector3()
    const dir = new Vector3()
    const view = new Vector3()
    const side = new Vector3()
    const worldPerPixel = (p: Vector3) => ortho
        ? (camera as OrthographicCamera2).frustumSize / viewportHeight
        : 2 * p.distanceTo(eye) * Math.tan((camera as PerspectiveCamera2).fov * Math.PI / 360) / viewportHeight
    const inv = new Matrix4().copy(world).invert()
    h.edges.forEach((e, i) => {
        a.set(pos[ev[e * 2] * 3], pos[ev[e * 2] * 3 + 1], pos[ev[e * 2] * 3 + 2]).applyMatrix4(world)
        b.set(pos[ev[e * 2 + 1] * 3], pos[ev[e * 2 + 1] * 3 + 1], pos[ev[e * 2 + 1] * 3 + 2]).applyMatrix4(world)
        dir.subVectors(b, a)
        view.subVectors(a.clone().add(b).multiplyScalar(0.5), eye)
        side.crossVectors(dir, view).normalize()
        const wa = side.clone().multiplyScalar(worldPerPixel(a) * px / 2)
        const wb = side.clone().multiplyScalar(worldPerPixel(b) * px / 2)
        // The meshes carry the object's matrix, so bring the quad back into object space.
        const q = [a.clone().sub(wa), a.clone().add(wa), b.clone().add(wb), b.clone().sub(wb)]
            .map(v => v.applyMatrix4(inv))
        const order = [0, 1, 2, 0, 2, 3]
        order.forEach((k, j) => out.set([q[k].x, q[k].y, q[k].z], i * 18 + j * 3))
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(out, 3))
    return g
}

// endregion

// region 2D annotation

function drawLabels(g: CanvasRenderingContext2D, labels: {text: string, x: number, y: number}[], rect: number[]) {
    g.save()
    g.beginPath()
    g.rect(rect[0], rect[1], rect[2], rect[3])
    g.clip()
    g.font = '11px ui-monospace, Menlo, monospace'
    g.textBaseline = 'middle'
    for (const l of labels) {
        const w = g.measureText(l.text).width + 6
        g.fillStyle = 'rgba(20, 20, 24, 0.75)'
        g.fillRect(l.x + 4, l.y - 7, w, 14)
        g.fillStyle = '#ffd27a'
        g.fillText(l.text, l.x + 7, l.y)
    }
    g.restore()
}

function drawCaption(g: CanvasRenderingContext2D, text: string, rect: number[]) {
    g.save()
    g.font = '12px ui-monospace, Menlo, monospace'
    g.fillStyle = 'rgba(20, 20, 24, 0.7)'
    g.fillRect(rect[0] + 6, rect[1] + 6, g.measureText(text).width + 10, 18)
    g.fillStyle = '#e8e8e8'
    g.textBaseline = 'middle'
    g.fillText(text, rect[0] + 11, rect[1] + 15)
    g.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    g.strokeRect(rect[0] + 0.5, rect[1] + 0.5, rect[2] - 1, rect[3] - 1)
    g.restore()
}

// endregion

const round = (n: number) => Math.round(n * 1e4) / 1e4

