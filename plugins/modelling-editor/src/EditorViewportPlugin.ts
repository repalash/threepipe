/**
 * Viewport furniture for the editor: grid and axes, orthographic / perspective switching, axis views,
 * frame-all / frame-selected, and viewport shading (material / solid / wireframe).
 *
 * Adapted from `experiments/threepipe-blueprint-editor/src/utils/EditModePlugin.ts` (the camera,
 * grid and override-material parts; the Kite project/play-mode coupling is left behind). The grid
 * setup - a widget excluded from the gbuffer/depth passes - is taken from there verbatim.
 *
 * Framework-free: nothing here knows about React. The shell reads state through the events.
 */

import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    Box3B,
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    getFittingDistance,
    ICamera,
    IObject3D,
    LineBasicMaterial,
    LineSegments,
    Object3D,
    OrbitControls3,
    OrthographicCamera2,
    PhysicalMaterial,
    ThreeViewer,
    Vector3,
} from 'threepipe'

/**
 * A ground grid built from one short segment per cell rather than one long line per row.
 *
 * `GridHelper`'s 40-unit lines run from one side of the scene to the other, so when the camera is
 * inside the grid most of them have an endpoint behind the camera. With the SwiftShader/ANGLE
 * renderer the tests run on, such segments are dropped whole instead of being clipped at the near
 * plane, and the grid shows only as a band in the distance. Per-cell segments keep every visible
 * cell drawn on any renderer. (`examples/modelling-editor`, bisected 2026-10-03.)
 */
function makeGridGeometry(size: number, divisions: number, color: Color, axisColors: {x: Color, z: Color}): BufferGeometry {
    const half = size / 2
    const step = size / divisions
    const positions: number[] = []
    const colors: number[] = []
    const push = (a: [number, number, number], b: [number, number, number], c: Color) => {
        positions.push(...a, ...b)
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    for (let i = 0; i <= divisions; i++) {
        const k = -half + i * step
        const onAxis = Math.abs(k) < 1e-6
        for (let j = 0; j < divisions; j++) {
            const a = -half + j * step
            const b = a + step
            // line along X at z = k, and along Z at x = k
            push([a, 0, k], [b, 0, k], onAxis ? axisColors.x : color)
            push([k, 0, a], [k, 0, b], onAxis ? axisColors.z : color)
        }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return geometry
}

export type ViewportShading = 'material' | 'solid' | 'wireframe'
export type AxisView = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'

export interface EditorViewportPluginEventMap extends AViewerPluginEventMap {
    /** Grid, shading, projection or camera changed. */
    viewportChanged: {}
}

export class EditorViewportPlugin extends AViewerPluginSync<EditorViewportPluginEventMap> {
    public static readonly PluginType = 'EditorViewportPlugin'

    enabled = true
    dependencies = []
    toJSON: any = undefined

    /** The grid with its X (red) and Z (blue) axis lines. One object so it can be toggled as a unit. */
    readonly grid = new Object3D()
    private _lines: LineSegments

    /** Orthographic camera used for ortho and axis views. Perspective uses the scene's default camera. */
    readonly cameraOrtho = new OrthographicCamera2('orbit')

    private _shading: ViewportShading = 'material'
    private _solidMaterial = new PhysicalMaterial({color: 0xbfc2c9, roughness: 0.55, metalness: 0.0})
    private _wireMaterial = new PhysicalMaterial({color: 0xe0e0e8, wireframe: true, roughness: 1})

    constructor() {
        super()
        // Colours are chosen for a dark viewport after tone mapping is bypassed (`toneMapped = false`):
        // widgets are not part of the image, as threepipe's own helpers do (BoxSelectionWidget, PointLightHelper2).
        // X in red, Z in blue, the Blender convention for a Y-up ground plane.
        const geometry = makeGridGeometry(40, 40, new Color(0x4a4a56), {x: new Color(0.75, 0.25, 0.3), z: new Color(0.3, 0.45, 0.85)})
        const material = new LineBasicMaterial({vertexColors: true, toneMapped: false, transparent: true, opacity: 0.9})
        material.userData.renderToGBuffer = false
        material.userData.renderToDepth = false
        ;(material as any).allowOverride = false
        this._lines = new LineSegments(geometry, material)
        this._lines.frustumCulled = false

        this.grid.name = 'Editor Grid'
        this.grid.add(this._lines)
        ;(this.grid as any).isWidget = true
        this.grid.userData.autoUpgradeChildren = false
        this.grid.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
            o.userData.renderToDepth = false
            o.userData.renderToGBuffer = false
            o.userData.bboxVisible = false
        })

        this.cameraOrtho.name = 'Editor Orthographic Camera'
        this.cameraOrtho.position.set(0, 0, 10)
        this.cameraOrtho.target.set(0, 0, 0)
        this.cameraOrtho.frustumSize = 10
        this.cameraOrtho.userData.disableWidgets = true
        this.cameraOrtho.autoNearFar = false
        this.cameraOrtho.autoAspect = true
        this.cameraOrtho.autoLookAtTarget = true
        this.cameraOrtho.near = -1000
        this.cameraOrtho.far = 1000
        for (const m of [this._solidMaterial, this._wireMaterial]) {
            m.userData.renderToGBuffer = false
            m.userData.renderToDepth = false
        }
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        viewer.scene.addObject(this.grid, {addToRoot: true})
        viewer.scene.add(this.cameraOrtho)
        const camera = viewer.scene.defaultCamera
        const controls = camera.controls as OrbitControls3 | undefined
        if (controls) Object.assign(controls, {enableDamping: false, minDistance: 0.1, maxDistance: 1000, zoomSpeed: 0.8})
        // The grid is a widget and not part of the scene bounds, so an auto near/far fitted to the model
        // clips it to a thin band. Fixed planes, as the blueprint editor's cameras had.
        this._savedNearFar = {autoNearFar: camera.autoNearFar, near: camera.near, far: camera.far}
        camera.autoNearFar = false
        camera.near = 0.05
        camera.far = 2000
        camera.setDirty()
        this.cameraOrtho.controls && Object.assign(this.cameraOrtho.controls as OrbitControls3, {enableDamping: false, zoomSpeed: 0.8})
    }

    private _savedNearFar: {autoNearFar: boolean, near: number, far: number} | null = null

    onRemove(viewer: ThreeViewer): void {
        if (viewer.scene.mainCamera === this.cameraOrtho) viewer.scene.defaultCamera.activateMain()
        if (this._savedNearFar) {
            Object.assign(viewer.scene.defaultCamera, this._savedNearFar)
            viewer.scene.defaultCamera.setDirty()
            this._savedNearFar = null
        }
        this.grid.removeFromParent()
        this.cameraOrtho.removeFromParent()
        this.setShading('material')
        super.onRemove(viewer)
    }

    dispose(): void {
        this._lines.geometry.dispose()
        ;(this._lines.material as any).dispose()
        this._solidMaterial.dispose()
        this._wireMaterial.dispose()
        this.cameraOrtho.dispose()
        super.dispose()
    }

    private _changed(): void {
        this._viewer?.setDirty()
        this.dispatchEvent({type: 'viewportChanged'})
    }

    // region grid

    get gridVisible(): boolean {
        return this.grid.visible
    }

    setGridVisible(visible: boolean): void {
        if (this.grid.visible === visible) return
        this.grid.visible = visible
        this._changed()
    }

    // endregion

    // region shading

    get shading(): ViewportShading {
        return this._shading
    }

    /**
     * `solid` and `wireframe` use `scene.overrideMaterial`, which three applies only to materials with
     * `allowOverride === true` - every threepipe material, and none of the plain three.js materials the
     * edit-mode overlays and the grid use, so those keep drawing normally.
     */
    setShading(mode: ViewportShading): void {
        const viewer = this._viewer
        if (!viewer) return
        this._shading = mode
        viewer.scene.overrideMaterial = mode === 'solid' ? this._solidMaterial
            : mode === 'wireframe' ? this._wireMaterial : null
        this._changed()
    }

    // endregion

    // region camera

    get isOrthographic(): boolean {
        return this._viewer?.scene.mainCamera === this.cameraOrtho
    }

    private _perspective(): ICamera {
        return this._viewer!.scene.defaultCamera
    }

    setOrthographic(ortho: boolean): void {
        const viewer = this._viewer
        if (!viewer) return
        if (ortho === this.isOrthographic) return
        const from = viewer.scene.mainCamera
        const to = ortho ? this.cameraOrtho : this._perspective()
        to.position.copy(from.position)
        to.target.copy(from.target)
        if (ortho) {
            // Match the apparent size: a perspective view at distance d with fov f shows 2·d·tan(f/2).
            const fov = ((from as any).fov ?? 50) * Math.PI / 180
            this.cameraOrtho.frustumSize = 2 * from.position.distanceTo(from.target) * Math.tan(fov / 2)
        }
        to.activateMain()
        to.setDirty({change: 'transform'})
        this._changed()
    }

    toggleOrthographic(): void {
        this.setOrthographic(!this.isOrthographic)
    }

    /** Look along an axis, in orthographic projection as Blender's numpad views do. */
    setAxisView(view: AxisView): void {
        const viewer = this._viewer
        if (!viewer) return
        this.setOrthographic(true)
        const camera = this.cameraOrtho
        const dist = Math.max(1, camera.position.distanceTo(camera.target))
        const dir = {
            front: [0, 0, 1], back: [0, 0, -1],
            right: [1, 0, 0], left: [-1, 0, 0],
            top: [0, 1, 0], bottom: [0, -1, 0],
        }[view]
        camera.position.set(dir[0], dir[1], dir[2]).multiplyScalar(dist).add(camera.target)
        camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : view === 'bottom' ? 1 : 0)
        camera.lookAt(camera.target)
        camera.setDirty({change: 'transform'})
        this._changed()
    }

    /** Frame the given objects, or the whole model root when nothing is passed. */
    async frame(objects?: IObject3D[] | null, duration = 350): Promise<void> {
        const viewer = this._viewer
        if (!viewer) return
        const targets = objects && objects.length ? objects : [viewer.scene.modelRoot]
        const bbox = new Box3B()
        for (const o of targets) bbox.expandByObject(o, false, true)
        if (bbox.isEmpty()) return
        const camera = viewer.scene.mainCamera
        const center = bbox.getCenter(new Vector3())
        if (this.isOrthographic) {
            const size = bbox.getSize(new Vector3()).length()
            const dir = camera.position.clone().sub(camera.target).normalize()
            camera.target.copy(center)
            camera.position.copy(dir.multiplyScalar(Math.max(size, 1) * 2).add(center))
            this.cameraOrtho.frustumSize = Math.max(size, 0.1) * 1.2
            camera.setDirty({change: 'transform'})
            this._changed()
            return
        }
        const distance = getFittingDistance(camera as any, bbox) * 1.6
        const dir = camera.position.clone().sub(camera.target).normalize()
        await this._animateCamera(camera, dir.multiplyScalar(distance).add(center), center, duration)
    }

    private async _animateCamera(camera: ICamera, position: Vector3, target: Vector3, duration: number): Promise<void> {
        const viewer = this._viewer!
        const p0 = camera.position.clone()
        const t0 = camera.target.clone()
        const start = performance.now()
        await new Promise<void>(resolve => {
            const step = () => {
                const t = Math.min(1, (performance.now() - start) / Math.max(1, duration))
                const e = 1 - Math.pow(1 - t, 3)
                camera.position.lerpVectors(p0, position, e)
                camera.target.lerpVectors(t0, target, e)
                camera.setDirty({change: 'transform'})
                viewer.setDirty()
                if (t < 1) requestAnimationFrame(step)
                else resolve()
            }
            step()
        })
        this._changed()
    }

    /** Scene background colour used by the editor. */
    setBackground(color: string | null): void {
        const viewer = this._viewer
        if (!viewer) return
        if (color) viewer.scene.setBackgroundColor(new Color(color))
        else viewer.scene.background = null
        this._changed()
    }

    // endregion
}
