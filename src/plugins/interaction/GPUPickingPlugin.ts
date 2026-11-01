import {
    BackSide,
    Color,
    FloatType,
    FrontSide,
    Material,
    Mesh,
    NearestFilter,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    RGBAFormat,
    ShaderMaterial,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'three'
import {uiFolderContainer, uiInput, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IObject3D} from '../../core'

export interface GPUPickResult {
    /** The front-most mesh under the point */
    object: IObject3D
    /** World position of the hit, at the centre of the pixel under the point */
    point: Vector3
    /** Distance along the camera ray, as `Raycaster.setFromCamera` makes it (from the camera, or its plane for an orthographic camera) */
    distance: number
    /**
     * World-space unit normal of the surface at the hit, on the side that the camera sees (flipped on the back face of a
     * double-sided or back-sided material). It is the interpolated vertex normal (with skinning, morph targets,
     * instancing and batching), or the flat face normal for a flat-shaded material or a geometry without normals. Normal
     * and bump maps are not applied.
     */
    normal: Vector3
}

/**
 * A GPU picker: finds the front-most mesh under a point of the canvas, with the hit point and normal, by reading what
 * the GPU drew under that point instead of testing triangles.
 *
 * Each implementation is a separate plugin with this one interface:
 * - {@link GPUPickingPlugin} draws the ids, depth and normals into a 1×1 target on each pick.
 * - A future `GBufferPickingPlugin` (deferred, depends on `GBufferPlugin`) reads the ids, depth and normals of the
 *   frame that the G-buffer already has, with no extra draw.
 *
 * A consumer (for example a future GPU hover in `PickingPlugin`) does not depend on one of them. It looks up any added
 * plugin that is a GPU picker:
 * ```ts
 * const picker = Object.values(viewer.plugins).find((p): p is IGPUPicker & IViewerPlugin => !!(p as Partial<IGPUPicker>).isGPUPicker)
 * const hit = picker?.pick(x, y)
 * ```
 */
export interface IGPUPicker {
    /** Always true: the runtime mark to find a GPU picker among the plugins */
    readonly isGPUPicker: true
    /**
     * The front-most mesh under a point of the canvas, with the hit point and normal, or null.
     * @param x - CSS pixels from the left edge of the canvas
     * @param y - CSS pixels from the top edge of the canvas
     * @param filter - which meshes take part
     */
    pick(x: number, y: number, filter?: (o: IObject3D) => boolean): GPUPickResult | null
}

/**
 * GPU Picking Plugin
 *
 * Finds the front-most mesh under a point of the canvas by rendering object ids instead of testing triangles. The meshes
 * of the model root draw into a 1×1 float target, with the camera's view narrowed to that pixel (one draw of the scene
 * in a tiny viewport). Then one pixel is read back, with the object id, the depth and the surface normal. There is no
 * tree to build or to keep in memory, and the cost does not grow with the triangle count.
 *
 * It implements {@link IGPUPicker}, the interface that consumers of GPU picking look up.
 *
 * Use it for hover and clicks on what is visible: call {@link pick} with the pointer position. It finds only the
 * front-most mesh (not the ones behind it), along camera rays only, and the read-back waits for the GPU. For other rays,
 * all the hits, or many queries in a frame, use the Raycaster (with a BVH on big meshes).
 *
 * - Skinned, morphed, instanced and batched meshes are drawn in their current pose (one object, no instance id).
 * - Each mesh (each geometry group of a multi-material mesh) draws with the side of its material, so a face that a
 *   render culls is not hit.
 * - Transparent meshes are hit like opaque ones, and so are the parts that alpha test cuts away.
 * - Fat lines (Line2), points, lines, objects outside the model root and meshes on layers that the main camera does not
 *   see are not drawn.
 *
 * @category Plugins
 */
@uiFolderContainer('GPU Picking')
export class GPUPickingPlugin extends AViewerPluginSync implements IGPUPicker {
    public static readonly PluginType = 'GPUPickingPlugin'

    readonly isGPUPicker = true

    @uiToggle('Enabled')
        enabled = true

    /** A layer that no other render uses, for the meshes being picked */
    static Layer = 29

    /** The time of the last {@link pick}, in ms */
    @uiInput('Last pick (ms)', {readOnly: true})
        lastPickMs = 0

    toJSON: any = undefined // nothing to save

    private _target = new WebGLRenderTarget(1, 1, {type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true})
    private _pixel = new Float32Array(4)
    private _ids = new Map<Object3D, number>()
    private _objects: Object3D[] = []
    private _perspective = new PerspectiveCamera()
    private _ortho = new OrthographicCamera()
    private _raycaster = new Raycaster()
    private _clearColor = new Color()
    /**
     * For each mesh: the id in red, the view depth in green, and the view-space normal in blue and alpha.
     *
     * The normal is octahedral-encoded: every unit vector maps to one point of [-1, 1]², so no sign is lost. Two channels
     * with x and y and z rebuilt toward the camera would not work: with a perspective camera a visible face can have a
     * view-space normal with z < 0 (near the edges of the view). In a float target the encoding loses about 1e-7 rad.
     */
    private _material = new ShaderMaterial({
        uniforms: {objectId: {value: 0}, flatNormal: {value: false}, flipSided: {value: false}},
        vertexShader: `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vViewPosition;
varying vec3 vViewNormal;
void main() {
#include <morphinstance_vertex>
#include <batching_vertex>
#include <beginnormal_vertex>
#include <morphnormal_vertex>
#include <skinbase_vertex>
#include <skinnormal_vertex>
#include <defaultnormal_vertex>
#ifdef FLIP_SIDED
    // undo it: the side changes per draw without a new program, the fragment shader flips by the flipSided uniform
    transformedNormal = - transformedNormal;
#endif
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
    vViewPosition = mvPosition.xyz;
    vViewNormal = transformedNormal;
}`,
        fragmentShader: `
uniform float objectId;
uniform bool flatNormal;
uniform bool flipSided;
varying vec3 vViewPosition;
varying vec3 vViewNormal;
vec2 octEncode(vec3 n) {
    n /= abs(n.x) + abs(n.y) + abs(n.z);
    return n.z >= 0. ? n.xy : (1. - abs(n.yx)) * vec2(n.x >= 0. ? 1. : -1., n.y >= 0. ? 1. : -1.);
}
void main() {
    vec3 n;
    if (flatNormal) {
        // the face normal, as three's flat shading makes it, turned against the view ray (isOrthographic: three's
        // uniform; the rays of an orthographic camera are parallel to -z, not toward the point)
        n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        if (dot(n, isOrthographic ? vec3(0., 0., -1.) : vViewPosition) > 0.) n = -n;
    } else {
        // the interpolated normal toward the camera, as three shades it: flipped on a back face of a double-sided
        // material, and for a back-sided one (three draws it with the front-face winding turned, so gl_FrontFacing is
        // true on its visible faces)
        n = normalize(vViewNormal) * (gl_FrontFacing ? 1. : -1.) * (flipSided ? -1. : 1.);
    }
    gl_FragColor = vec4(objectId, -vViewPosition.z, octEncode(n));
}`,
    })

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this._material.onBeforeRender = (_r, _s, _c, geometry, object, group) => {
            const uniforms = this._material.uniforms
            uniforms.objectId.value = this._ids.get(object) ?? 0
            // three passes the geometry group (with materialIndex) of a multi-material mesh, or null
            const m = (object as Mesh).material
            const index = (group as unknown as {materialIndex?: number} | null)?.materialIndex ?? 0
            const material = (Array.isArray(m) ? m[index] : m) as Material & {flatShading?: boolean} | undefined
            uniforms.flatNormal.value = !geometry.attributes.normal || !!material?.flatShading
            // the faces that a render draws: three culls by this side at the draw (state.setMaterial). It does not build a
            // new program for it (the side does not change the material version), so the shaders do not use FLIP_SIDED.
            this._material.side = material?.side ?? FrontSide
            uniforms.flipSided.value = this._material.side === BackSide
            this._material.uniformsNeedUpdate = true
        }
    }

    onRemove(viewer: ThreeViewer) {
        this._target.dispose()
        this._material.dispose()
        super.onRemove(viewer)
    }

    /**
     * The front-most mesh under a point of the canvas, with the hit point and the world normal, or null.
     * @param x - CSS pixels from the left edge of the canvas
     * @param y - CSS pixels from the top edge of the canvas
     * @param filter - which meshes take part. Default: the visible meshes in the model root, without fat lines.
     */
    pick(x: number, y: number, filter?: (o: IObject3D) => boolean): GPUPickResult | null {
        const viewer = this._viewer
        if (!viewer || this.isDisabled()) return null
        const t0 = performance.now()
        const canvas = viewer.canvas
        const w = canvas.clientWidth, h = canvas.clientHeight
        const scene = viewer.scene
        const cam = scene.mainCamera as unknown as PerspectiveCamera & OrthographicCamera
        const layer = GPUPickingPlugin.Layer

        // the meshes, each with an id (1, 2, ...), on the picking layer
        this._ids.clear()
        this._objects.length = 0
        const added: Object3D[] = []
        scene.modelRoot.traverseVisible(o => {
            const m = o as Object3D as Mesh & {isLine2?: boolean, isLineSegments2?: boolean}
            if (!m.isMesh || m.isLine2 || m.isLineSegments2 || !o.layers.test(cam.layers) || filter && !filter(o as IObject3D)) return
            this._objects.push(o)
            this._ids.set(o, this._objects.length)
            if (!o.layers.isEnabled(layer)) {
                o.layers.enable(layer)
                added.push(o)
            }
        })

        // a camera that sees only the pixel under the point
        const px = Math.floor(x), py = Math.floor(y)
        const pc = cam.isPerspectiveCamera ? this._perspective : this._ortho
        if (cam.isPerspectiveCamera) {
            const p = pc as PerspectiveCamera
            p.fov = cam.fov
            p.aspect = cam.aspect
            p.zoom = cam.zoom
            p.filmGauge = cam.filmGauge
            p.filmOffset = cam.filmOffset
        } else {
            const o = pc as OrthographicCamera
            o.left = cam.left
            o.right = cam.right
            o.top = cam.top
            o.bottom = cam.bottom
            o.zoom = cam.zoom
        }
        pc.near = cam.near
        pc.far = cam.far
        pc.matrixAutoUpdate = false
        pc.matrixWorld.copy(cam.matrixWorld)
        pc.matrixWorldInverse.copy(cam.matrixWorldInverse)
        pc.setViewOffset(w, h, px, py, 1, 1)
        if (cam.isPerspectiveCamera) {
            // setViewOffset sets the aspect to w / h: keep the aspect of the camera (a fixed aspect shows stretched)
            (pc as PerspectiveCamera).aspect = cam.aspect
            pc.updateProjectionMatrix()
        }
        pc.layers.set(layer)

        const renderer = viewer.renderManager.renderer
        const target = renderer.getRenderTarget()
        const override = scene.overrideMaterial
        renderer.getClearColor(this._clearColor)
        const clearAlpha = renderer.getClearAlpha()
        renderer.setRenderTarget(this._target)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, true)
        scene.overrideMaterial = this._material
        renderer.renderWithModes({
            shadowMapRender: false,
            backgroundRender: false,
            opaqueRender: true,
            transparentRender: true,
            mainRenderPass: false,
        }, () => {
            // undefined: transmissive meshes (glass) draw like the others. With an override material three skips the
            // transmission pre-pass (false would leave them out). renderWithModes puts the old value back.
            renderer.userData.transmissionRender = undefined
            renderer.render(scene, pc)
        })
        scene.overrideMaterial = override
        renderer.readRenderTargetPixels(this._target, 0, 0, 1, 1, this._pixel)
        renderer.setRenderTarget(target)
        renderer.setClearColor(this._clearColor, clearAlpha)
        for (const o of added) o.layers.disable(layer)

        const object = this._objects[Math.round(this._pixel[0]) - 1] as IObject3D | undefined
        this._ids.clear()
        this._objects.length = 0
        this.lastPickMs = Math.round((performance.now() - t0) * 100) / 100
        this.uiConfig?.uiRefresh?.(false, 'postFrame')
        if (!object) return null

        // the hit point: along the camera ray through the centre of the pixel, at the depth that was drawn there. The ray
        // of an orthographic camera starts in the plane of the camera, so its distance is the view depth.
        const viewZ = this._pixel[1]
        this._raycaster.setFromCamera(new Vector2((px + 0.5) / w * 2 - 1, -((py + 0.5) / h) * 2 + 1), cam)
        const ray = this._raycaster.ray
        const forward = new Vector3(0, 0, -1).transformDirection(cam.matrixWorld)
        const distance = cam.isPerspectiveCamera ? viewZ / ray.direction.dot(forward) : viewZ

        // the normal: octahedral decoding, then from the view space of the camera to world space
        const ex = this._pixel[2], ey = this._pixel[3]
        const normal = new Vector3(ex, ey, 1 - Math.abs(ex) - Math.abs(ey))
        const fold = Math.max(-normal.z, 0)
        normal.x += normal.x >= 0 ? -fold : fold
        normal.y += normal.y >= 0 ? -fold : fold
        normal.transformDirection(cam.matrixWorld) // normalizes

        return {object, point: ray.at(distance, new Vector3()), distance, normal}
    }
}
