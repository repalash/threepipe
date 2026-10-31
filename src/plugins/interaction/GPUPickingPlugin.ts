import {
    Color,
    DoubleSide,
    FloatType,
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
}

/**
 * GPU Picking Plugin
 *
 * Finds the front-most mesh under a point of the canvas by rendering object ids instead of testing triangles. The meshes
 * of the model root draw into a 1×1 float target, with the camera's view narrowed to that pixel (one draw of the scene
 * in a tiny viewport). Then one pixel is read back, with the object id and the depth. There is no tree to build or to
 * keep in memory, and the cost does not grow with the triangle count.
 *
 * Use it for hover and clicks on what is visible: call {@link pick} with the pointer position. It finds only the
 * front-most mesh (not the ones behind it), along camera rays only, and the read-back waits for the GPU. For other rays,
 * all the hits, or many queries in a frame, use the Raycaster (with a BVH on big meshes).
 *
 * - Skinned, morphed and instanced meshes are drawn in their current pose.
 * - Transparent meshes are hit like opaque ones, and so are the parts that alpha test cuts away.
 * - Fat lines (Line2), points, lines, objects outside the model root and meshes on layers that the main camera does not
 *   see are not drawn.
 *
 * @category Plugins
 */
@uiFolderContainer('GPU Picking')
export class GPUPickingPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'GPUPickingPlugin'

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
    // the id in red and the view depth in green, for each mesh
    private _material = new ShaderMaterial({
        uniforms: {objectId: {value: 0}},
        vertexShader: `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying float vViewZ;
void main() {
#include <skinbase_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
    vViewZ = -mvPosition.z;
}`,
        fragmentShader: `
uniform float objectId;
varying float vViewZ;
void main() { gl_FragColor = vec4(objectId, vViewZ, 0., 1.); }`,
        side: DoubleSide,
    })

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this._material.onBeforeRender = (_r, _s, _c, _g, object) => {
            this._material.uniforms.objectId.value = this._ids.get(object) ?? 0
            this._material.uniformsNeedUpdate = true
        }
    }

    onRemove(viewer: ThreeViewer) {
        this._target.dispose()
        this._material.dispose()
        super.onRemove(viewer)
    }

    /**
     * The front-most mesh under a point of the canvas, or null.
     * @param x - CSS pixels from the left edge of the canvas
     * @param y - CSS pixels from the top edge of the canvas
     * @param filter - which meshes take part. Default: the visible meshes in the model root, without fat lines.
     */
    pick(x: number, y: number, filter?: (o: Object3D) => boolean): GPUPickResult | null {
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
            if (!m.isMesh || m.isLine2 || m.isLineSegments2 || !o.layers.test(cam.layers) || filter && !filter(o)) return
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
        return {object, point: ray.at(distance, new Vector3()), distance}
    }
}
