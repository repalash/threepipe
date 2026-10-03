/**
 * The selection buffer: every visible vertex, edge or face drawn with its id as its colour, so the
 * element under the cursor is a pixel read rather than a geometric search.
 *
 * This is Blender's select engine (`draw/engines/select/select_engine.cc`) in WebGL:
 *
 * - The mesh's faces are drawn first. In face mode each carries its face id; otherwise they carry id 0
 *   and are there only to fill the depth buffer, so vertices and edges behind the surface lose the depth
 *   test and are never candidates. That is the occlusion Blender gets when X-ray is off.
 * - Edges and vertices are drawn over them with `LESS_EQUAL` depth (`DRW_STATE_DEFAULT`), vertices at
 *   twice the theme vertex size (`select_engine.cc:191`, `2 * vertex_size`).
 * - Only the square around the cursor is rendered - a pick matrix narrows the camera's projection to
 *   that region - and read back; `findNearestId` then spirals out from the centre exactly as
 *   `DRW_select_buffer_find_nearest_to_point` does.
 *
 * Faces are pushed slightly back with polygon offset so lines and points lying exactly on them win
 * the equal-depth test reliably; WebGL rasterises lines and triangles with slightly different depths.
 *
 * Ids are written 1-based into RGB, so 0 is "nothing" and up to 2^24 - 1 elements per domain fit.
 */

import {
    BufferAttribute,
    BufferGeometry,
    Camera,
    Color,
    LineSegments,
    Matrix4,
    Mesh,
    Points,
    Scene,
    ShaderMaterial,
    WebGLRenderTarget,
} from 'threepipe'
import {BMesh, BMEdge, BMFace, BMVert, ElemFlag, tessellatePolygon} from '@threepipe/mesh-kernel'
import {findNearestId} from './spiral'
import type {SelectDomain, SelectElements, SelectSampler} from './findNearest'

const ID_VERTEX = /* glsl */`
attribute float aId;
uniform float uPointSize;
uniform float uUniformId;
varying vec3 vId;
void main() {
    // 1-based id split into three bytes, passed whole so nothing is interpolated across a primitive.
    // A non-negative uniform id overrides the attribute, as Blender's \`select_id_uniform\` shader does.
    float id = uUniformId >= 0.0 ? uUniformId : aId;
    float r = mod(id, 256.0);
    float g = mod(floor(id / 256.0), 256.0);
    float b = floor(id / 65536.0);
    vId = vec3(r, g, b) / 255.0;
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const ID_FRAGMENT = /* glsl */`
varying vec3 vId;
void main() {
    gl_FragColor = vec4(vId, 1.0);
}
`

function idMaterial(pointSize = 1, uniformId = -1): ShaderMaterial {
    const material = new ShaderMaterial({
        vertexShader: ID_VERTEX,
        fragmentShader: ID_FRAGMENT,
        uniforms: {uPointSize: {value: pointSize}, uUniformId: {value: uniformId}},
    })
    material.toneMapped = false
    return material
}

/** Blender's default theme vertex size, in CSS pixels (`vertex_size = 3`, `U.pixelsize = 1`). */
export const VERTEX_SIZE_PX = 3

export interface SelectBufferRenderer {
    /** A WebGL renderer: `setRenderTarget`, `getRenderTarget`, `render`, `readRenderTargetPixels`, clear state. */
    getRenderTarget(): any
    setRenderTarget(target: any): void
    render(scene: any, camera: any): void
    readRenderTargetPixels(target: any, x: number, y: number, w: number, h: number, buffer: Uint8Array): void
    getClearColor(target: any): any
    getClearAlpha(): number
    setClearColor(color: any, alpha?: number): void
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void
    autoClear: boolean
}

export class SelectBuffer implements SelectSampler {
    /** Element lists in buffer order; a 1-based id `i` is `list[i - 1]`. */
    readonly elements: SelectElements = {verts: [], edges: [], faces: []}

    /** Draw elements behind the surface too. Off is Blender's default. */
    xray = false

    private readonly _scene = new Scene()
    private readonly _camera = new Camera()
    private readonly _faces: Mesh
    private readonly _faceDepth: Mesh
    private readonly _edges: LineSegments
    private readonly _verts: Points
    private _target: WebGLRenderTarget | null = null
    private _pixels = new Uint8Array(0)
    private _ids = new Uint32Array(0)
    private readonly _clearColor = new Color()

    /** The object's world matrix; the buffer's geometry is in the object's local space. */
    readonly matrixWorld = new Matrix4()

    constructor() {
        this._faces = new Mesh(new BufferGeometry(), idMaterial())
        this._faceDepth = new Mesh(this._faces.geometry, idMaterial(1, 0))
        // Depth-only faces carry id 0 and push back a little, as described above.
        for (const m of [this._faces.material, this._faceDepth.material] as ShaderMaterial[]) {
            m.polygonOffset = true
            m.polygonOffsetFactor = 1
            m.polygonOffsetUnits = 1
        }
        this._edges = new LineSegments(new BufferGeometry(), idMaterial())
        this._verts = new Points(new BufferGeometry(), idMaterial(2 * VERTEX_SIZE_PX))
        // Faces fill depth first, then edges, then vertices on top.
        this._faces.renderOrder = 0
        this._faceDepth.renderOrder = 0
        this._edges.renderOrder = 1
        this._verts.renderOrder = 2
        for (const o of [this._faces, this._faceDepth, this._edges, this._verts]) {
            o.frustumCulled = false
            o.matrixAutoUpdate = false
            this._scene.add(o)
        }
        this._camera.matrixAutoUpdate = false
        this._camera.matrixWorldAutoUpdate = false
    }

    /** Rebuild the id geometry from the mesh. Call when topology, positions or hiding change. */
    update(bm: BMesh): void {
        const verts: BMVert[] = []
        const edges: BMEdge[] = []
        const faces: BMFace[] = []
        for (const v of bm.verts) if (!(v.hflag & ElemFlag.Hidden)) verts.push(v)
        for (const e of bm.edges) if (!(e.hflag & ElemFlag.Hidden)) edges.push(e)
        for (const f of bm.faces) if (!(f.hflag & ElemFlag.Hidden)) faces.push(f)
        this.elements.verts = verts
        this.elements.edges = edges
        this.elements.faces = faces

        // Vertices: one point each.
        {
            const pos = new Float32Array(verts.length * 3)
            const id = new Float32Array(verts.length)
            for (let i = 0; i < verts.length; i++) {
                pos[i * 3] = verts[i].x
                pos[i * 3 + 1] = verts[i].y
                pos[i * 3 + 2] = verts[i].z
                id[i] = i + 1
            }
            this._setGeometry(this._verts.geometry, pos, id)
        }
        // Edges: two endpoints each, both carrying the edge's id.
        {
            const pos = new Float32Array(edges.length * 6)
            const id = new Float32Array(edges.length * 2)
            for (let i = 0; i < edges.length; i++) {
                const e = edges[i]
                pos.set([e.v1.x, e.v1.y, e.v1.z, e.v2.x, e.v2.y, e.v2.z], i * 6)
                id[i * 2] = id[i * 2 + 1] = i + 1
            }
            this._setGeometry(this._edges.geometry, pos, id)
        }
        // Faces: tessellated as the bake tessellates them, unindexed so each triangle carries its face id.
        {
            const pos: number[] = []
            const id: number[] = []
            const corners: number[] = []
            const local: number[] = []
            for (let i = 0; i < faces.length; i++) {
                const f = faces[i]
                corners.length = 0
                for (const l of f.eachLoop()) corners.push(l.v.x, l.v.y, l.v.z)
                local.length = 0
                tessellatePolygon(corners, local)
                for (const k of local) {
                    pos.push(corners[k * 3], corners[k * 3 + 1], corners[k * 3 + 2])
                    id.push(i + 1)
                }
            }
            this._setGeometry(this._faces.geometry, Float32Array.from(pos), Float32Array.from(id))
        }
    }

    private _setGeometry(g: BufferGeometry, position: Float32Array, id: Float32Array): void {
        g.setAttribute('position', new BufferAttribute(position, 3))
        g.setAttribute('aId', new BufferAttribute(id, 1))
        g.computeBoundingSphere()
    }

    // region view

    private _renderer: SelectBufferRenderer | null = null
    private _viewCamera: Camera | null = null
    private _viewWidth = 1
    private _viewHeight = 1

    /**
     * Set the view the buffer is rendered from. `width`/`height` are the canvas size in CSS pixels, the
     * units cursor positions arrive in; one buffer cell is one CSS pixel.
     */
    setView(renderer: SelectBufferRenderer, camera: Camera, width: number, height: number): void {
        this._renderer = renderer
        this._viewCamera = camera
        this._viewWidth = Math.max(1, width)
        this._viewHeight = Math.max(1, height)
    }

    // endregion

    // region SelectSampler

    findNearest(domain: SelectDomain, x: number, y: number, dist: number): {index: number, dist: number} | null {
        const r = Math.max(0, Math.ceil(dist))
        const ids = this._read(domain, x, y, r)
        if (!ids) return null
        const hit = findNearestId(ids, 2 * r + 1)
        return hit ? {index: hit.id - 1, dist: hit.dist} : null
    }

    samplePoint(domain: SelectDomain, x: number, y: number): number | null {
        const ids = this._read(domain, x, y, 0)
        if (!ids || ids[0] === 0) return null
        return ids[0] - 1
    }

    /** Every id drawn inside a screen rectangle, for box select (`DRW_select_buffer_bitmap_from_rect`). */
    idsInRect(domain: SelectDomain, x0: number, y0: number, x1: number, y1: number): Set<number> {
        const xmin = Math.floor(Math.min(x0, x1))
        const ymin = Math.floor(Math.min(y0, y1))
        const w = Math.max(1, Math.floor(Math.abs(x1 - x0)) + 1)
        const h = Math.max(1, Math.floor(Math.abs(y1 - y0)) + 1)
        const ids = this._readRect(domain, xmin, ymin, w, h)
        const out = new Set<number>()
        if (ids) for (const id of ids) if (id) out.add(id - 1)
        return out
    }

    // endregion

    /** Render and read the `(2r+1)`-square around a pixel. Rows bottom to top, as GL returns them. */
    private _read(domain: SelectDomain, x: number, y: number, r: number): Uint32Array | null {
        const cx = Math.floor(x)
        const cy = Math.floor(y)
        return this._readRect(domain, cx - r, cy - r, 2 * r + 1, 2 * r + 1)
    }

    private _readRect(domain: SelectDomain, left: number, top: number, w: number, h: number): Uint32Array | null {
        const renderer = this._renderer
        const camera = this._viewCamera
        if (!renderer || !camera) return null

        // A pick matrix (`gluPickMatrix`) mapping just this rectangle of the view onto the whole target.
        const W = this._viewWidth
        const H = this._viewHeight
        const l = (left / W) * 2 - 1
        const r = ((left + w) / W) * 2 - 1
        const t = 1 - (top / H) * 2
        const b = 1 - ((top + h) / H) * 2
        const sx = 2 / (r - l)
        const sy = 2 / (t - b)
        const tx = -(r + l) / (r - l)
        const ty = -(t + b) / (t - b)
        const pick = new Matrix4().set(
            sx, 0, 0, tx,
            0, sy, 0, ty,
            0, 0, 1, 0,
            0, 0, 0, 1,
        )
        camera.updateMatrixWorld()
        this._camera.matrixWorld.copy(camera.matrixWorld)
        this._camera.matrixWorldInverse.copy(camera.matrixWorldInverse)
        this._camera.projectionMatrix.multiplyMatrices(pick, camera.projectionMatrix)
        this._camera.projectionMatrixInverse.copy(this._camera.projectionMatrix).invert()

        for (const o of [this._faces, this._faceDepth, this._edges, this._verts]) {
            o.matrix.copy(this.matrixWorld)
            o.matrixWorld.copy(this.matrixWorld)
        }

        // Which passes draw: the domain's own elements, plus id-0 faces for occlusion unless X-ray.
        this._faces.visible = domain === 'face'
        this._faceDepth.visible = domain !== 'face' && !this.xray
        this._edges.visible = domain === 'edge'
        this._verts.visible = domain === 'vert'

        if (!this._target || this._target.width !== w || this._target.height !== h) {
            this._target?.dispose()
            this._target = new WebGLRenderTarget(w, h, {depthBuffer: true})
            this._pixels = new Uint8Array(w * h * 4)
            this._ids = new Uint32Array(w * h)
        }

        const prevTarget = renderer.getRenderTarget()
        const prevAutoClear = renderer.autoClear
        const prevClear = renderer.getClearColor(this._clearColor)
        const prevAlpha = renderer.getClearAlpha()
        try {
            renderer.setRenderTarget(this._target)
            renderer.setClearColor(0x000000, 0)
            renderer.autoClear = false
            renderer.clear(true, true, false)
            renderer.render(this._scene, this._camera)
            renderer.readRenderTargetPixels(this._target, 0, 0, w, h, this._pixels)
        } finally {
            renderer.setRenderTarget(prevTarget)
            renderer.autoClear = prevAutoClear
            renderer.setClearColor(prevClear, prevAlpha)
        }

        // Kept in GL order, row 0 at the bottom, as Blender reads its buffer: the spiral's visiting order
        // then breaks ties between equally distant ids the same way Blender's does.
        const px = this._pixels
        const ids = this._ids
        for (let i = 0; i < w * h; i++) {
            const o = i * 4
            ids[i] = px[o + 3] === 0 ? 0 : px[o] | (px[o + 1] << 8) | (px[o + 2] << 16)
        }
        return ids
    }

    dispose(): void {
        this._target?.dispose()
        this._target = null
        for (const o of [this._faces, this._edges, this._verts]) {
            o.geometry.dispose()
            ;(o.material as ShaderMaterial).dispose()
        }
        ;(this._faceDepth.material as ShaderMaterial).dispose()
    }
}
