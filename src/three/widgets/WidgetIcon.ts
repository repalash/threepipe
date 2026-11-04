import {
    Camera,
    Color,
    CustomBlending,
    Intersection,
    Mesh,
    MeshBasicMaterial,
    OneFactor,
    OneMinusSrcAlphaFactor,
    PlaneGeometry,
    Quaternion,
    Raycaster,
    Texture,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three'
import {GBufferMaterial} from '../../plugins/pipeline/GBufferMaterial'
import {createWidgetIconTexture, getWidgetIconTextureSize, widgetIconLayout, WidgetKind, widgetKinds} from './widgetKinds'

/**
 * An unlit material that is drawn on top and is not in the depth passes. It writes only the GBuffer flags of its pixels
 * (`renderToFlags`), with its own GBuffer material ({@link iconGBufferMaterial}), so `toneMapped: false` keeps its colours
 */
function iconMaterial(map?: Texture) {
    const material = new MeshBasicMaterial({
        map: map ?? null,
        depthTest: false, // drawn on top
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        // the textures are premultiplied (at upload), so blend them as they are. Not `premultipliedAlpha: true`: that also
        // multiplies the colour by the alpha in the shader, a second time, which darkens the semi-transparent texels
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
        allowOverride: false,
    })
    material.userData.renderToGBuffer = false
    material.userData.renderToDepth = false
    material.userData.renderToFlags = true // only the flags (no tone mapping with toneMapped: false), not depth and normal
    return material
}

/**
 * The GBuffer material of an icon quad (its `customGBufferMaterial`): the material keeps `allowOverride: false`, so
 * the debug views of `ViewOverridesPlugin` do not draw the icon as a square, and the GBuffer pass draws it with this one,
 * which writes the flags where the icon texture is not cut
 */
function iconGBufferMaterial() {
    return new GBufferMaterial(true)
}

const tmpSize = new Vector2()
const tmpScale = new Vector3()
const tmpPosition = new Vector3()
const tmpQuaternion = new Quaternion()
const tmpCameraQuaternion = new Quaternion()
const tmpCameraScale = new Vector3()

/**
 * The icon of a light or a camera widget: a quad at the object's position that always faces the camera, is drawn on
 * top of the scene and keeps its size in pixels ({@link size}), set before each render for the camera of the render
 * ({@link updateScale}). An unlit mesh, not a `Sprite`: the GBuffer material can draw it, so it writes its GBuffer flags
 * and is not tone mapped. The colour and the icon of its {@link WidgetKind} come
 * from {@link widgetKinds}; lights also have a small dot in their own colour ({@link dot}).
 *
 * Its texture is drawn at the size of the icon on screen, about one texel per device pixel ({@link updateTexture}), so
 * it is sharp at any icon size and render scale. It is drawn again only when the size or the render scale changes.
 *
 * It is made by {@link AHelperWidget} for the objects that have a kind, when the icon mode of the widget is `sprite`.
 * A click on it selects the object of its widget (through the PickingPlugin, like the lines of the widget).
 */
export class WidgetIcon extends Mesh<PlaneGeometry, MeshBasicMaterial> {
    readonly kind: WidgetKind
    /** The dot in the object's own colour (lights only): a quad over the icon, its texture tinted with the colour */
    readonly dot: Mesh<PlaneGeometry, MeshBasicMaterial>
    /** The material that the GBuffer pass draws the quad with, for its flags (see `GBufferPlugin`) */
    customGBufferMaterial = iconGBufferMaterial()
    /** The diameter of the round icon in CSS pixels */
    size: number = widgetIconLayout.diameter
    /** The width and height of the current texture in texels, 0 when there is none (no 2D canvas) */
    textureSize = 0

    constructor(kind: WidgetKind) {
        super(new PlaneGeometry(1, 1), iconMaterial())
        this.kind = kind
        this.name = 'Widget Icon'
        this.renderOrder = 1 // after the lines of the widget
        // the quad keeps its size in pixels, the world bounds of the frustum test do not: an icon whose centre is just out
        // of the view would vanish while its disc is still on screen
        this.frustumCulled = false

        this.dot = new Mesh(this.geometry, iconMaterial())
        ;(this.dot as Mesh & {customGBufferMaterial?: GBufferMaterial}).customGBufferMaterial = iconGBufferMaterial()
        this.dot.name = 'Widget Icon Dot'
        // its transform follows the icon in each render, also when it is drawn first
        this.dot.onBeforeRender = (renderer, scene, camera) => this.onBeforeRender(renderer, scene, camera)
        // same quad, z and order as the icon; the icon is first (lower id). Its texture has the dot where it is on the icon
        this.dot.renderOrder = 1
        this.dot.raycast = () => undefined // a click on the dot is a click on the icon under it
        this.dot.frustumCulled = false
        this.dot.visible = widgetKinds[kind].dot
        this.add(this.dot)

        this.updateTexture(1)

        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.receiveShadow = false
        })
    }

    /**
     * Draws the textures of the icon and the dot at the size of the icon on a canvas with `pixelRatio` (the render scale
     * of the viewer): {@link getWidgetIconTextureSize} texels square. Does nothing when that size is the same as now.
     * Called before each render with the pixel ratio of the renderer.
     */
    updateTexture(pixelRatio: number) {
        const texels = getWidgetIconTextureSize(this.size, pixelRatio)
        if (texels === this.textureSize) return
        const icon = createWidgetIconTexture(this.kind, texels, 'icon')
        if (!icon) return // no 2D canvas, keep what is there
        const dot = this.dot.visible ? createWidgetIconTexture(this.kind, texels, 'dot') : undefined
        this._setMap(this.material, icon)
        this._setMap(this.dot.material, dot)
        this.textureSize = texels
    }

    private _setMap(material: MeshBasicMaterial, map: Texture | undefined) {
        const old = material.map
        material.map = map ?? null
        if (!old !== !map) material.needsUpdate = true // the map define changes
        old?.dispose()
    }

    /**
     * Turns the quad to face the camera and sets its scale so that the round icon is {@link size} pixels wide on a canvas
     * `heightPx` CSS pixels high, at its distance from the camera. The size in pixels depends on the projection (field
     * of view or zoom, `projectionMatrix[5]`), the canvas height and, for a perspective camera, the distance along the
     * view axis. It also divides out the world rotation and scale of the parent (the widget has the transform of its
     * object). Called before each render, with the camera of the render.
     */
    updateScale(camera: Camera, heightPx: number) {
        const e = camera.projectionMatrix.elements
        const proj = e[5]
        if (!proj || !heightPx) return
        const {box, diameter} = widgetIconLayout
        // the quad is 1 unit; on screen it is scale * proj * heightPx / 2 pixels, divided by the view depth for a
        // perspective projection (its last element is 0), as the three.js sprite shader with sizeAttenuation false
        let s = 2 * this.size * box / diameter / (proj * heightPx)
        if (this.parent) this.parent.matrixWorld.decompose(tmpPosition, tmpQuaternion, tmpScale)
        else {
            tmpPosition.set(0, 0, 0)
            tmpQuaternion.identity()
            tmpScale.set(1, 1, 1)
        }
        if (e[15] === 0) s *= Math.max(-tmpPosition.applyMatrix4(camera.matrixWorldInverse).z, 0)
        // the world rotation of the camera, in the space of the parent
        camera.matrixWorld.decompose(tmpPosition, tmpCameraQuaternion, tmpCameraScale)
        this.quaternion.copy(tmpQuaternion.invert().multiply(tmpCameraQuaternion))
        this.scale.set(s / (tmpScale.x || 1), s / (tmpScale.y || 1), 1)
        this.updateMatrixWorld(true)
    }

    /** Sets the colour of the {@link dot} */
    setDotColor(color: Color) {
        this.dot.material.color.copy(color)
    }

    onBeforeRender(renderer: WebGLRenderer, _scene: any, camera: Camera) {
        this.updateScale(camera, renderer.getSize(tmpSize).y)
        this.updateTexture(renderer.getPixelRatio())
    }

    /**
     * One hit at most (a ray on the diagonal of the quad hits both triangles). Drawn on top of the scene, so a hit on the
     * icon is in front of every other hit: its distance `d` becomes `d / (d + 1) * 1e-6`, under any real hit, and still
     * nearer first among the icons that overlap on screen.
     */
    raycast(raycaster: Raycaster, intersects: Intersection[]) {
        const start = intersects.length
        super.raycast(raycaster, intersects)
        if (intersects.length > start + 1) {
            const nearest = intersects.slice(start).reduce((a, b) => b.distance < a.distance ? b : a)
            intersects.length = start
            intersects.push(nearest)
        }
        for (let i = start; i < intersects.length; i++) {
            const d = intersects[i].distance
            intersects[i].distance = d / (d + 1) * 1e-6
        }
    }

    dispose() {
        this.material.map?.dispose()
        this.dot.material.map?.dispose()
        this.material.dispose()
        this.dot.material.dispose()
        this.customGBufferMaterial.dispose()
        ;(this.dot as Mesh & {customGBufferMaterial?: GBufferMaterial}).customGBufferMaterial?.dispose()
        this.geometry.dispose()
    }
}
