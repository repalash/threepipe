import {
    Camera,
    Color,
    CustomBlending,
    Intersection,
    OneFactor,
    OneMinusSrcAlphaFactor,
    Raycaster,
    Sprite,
    SpriteMaterial,
    Texture,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three'
import {createWidgetIconTexture, getWidgetIconTextureSize, widgetIconLayout, WidgetKind, widgetKinds} from './widgetKinds'

/** A sprite material that is drawn on top, at a constant size, and is not in the GBuffer or the depth passes */
function iconMaterial(map?: Texture) {
    const material = new SpriteMaterial({
        map: map ?? null,
        sizeAttenuation: false, // the same size at any distance
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
    return material
}

const tmpSize = new Vector2()
const tmpScale = new Vector3()

/**
 * The icon of a light or a camera widget: a sprite at the object's position that always faces the camera, is drawn on
 * top of the scene and keeps its size in pixels ({@link size}). The colour and the icon of its {@link WidgetKind} come
 * from {@link widgetKinds}; lights also have a small dot in their own colour ({@link dot}).
 *
 * Its texture is drawn at the size of the icon on screen, about one texel per device pixel ({@link updateTexture}), so
 * it is sharp at any icon size and render scale. It is drawn again only when the size or the render scale changes.
 *
 * It is made by {@link AHelperWidget} for the objects that have a kind, when the icon mode of the widget is `sprite`.
 * A click on it selects the object of its widget (through the PickingPlugin, like the lines of the widget).
 */
export class WidgetIcon extends Sprite {
    declare material: SpriteMaterial
    readonly kind: WidgetKind
    /** The dot in the object's own colour (lights only): a sprite over the icon, its texture tinted with the colour */
    readonly dot: Sprite
    /** The diameter of the round icon in CSS pixels */
    size: number = widgetIconLayout.diameter
    /** The width and height of the current texture in texels, 0 when there is none (no 2D canvas) */
    textureSize = 0

    constructor(kind: WidgetKind) {
        super(iconMaterial())
        this.kind = kind
        this.name = 'Widget Icon'
        this.renderOrder = 1 // after the lines of the widget
        // the quad keeps its size in pixels, the world bounds of the frustum test do not: an icon whose centre is just out
        // of the view would vanish while its disc is still on screen
        this.frustumCulled = false

        this.dot = new Sprite(iconMaterial())
        this.dot.name = 'Widget Icon Dot'
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

    private _setMap(material: SpriteMaterial, map: Texture | undefined) {
        const old = material.map
        material.map = map ?? null
        if (!old !== !map) material.needsUpdate = true // the map define changes
        old?.dispose()
    }

    /**
     * Sets the scale so that the round icon is {@link size} pixels wide on a canvas `heightPx` CSS pixels high.
     * With `sizeAttenuation: false` the sprite has the same size at any distance; this converts pixels to its units,
     * which depend on the projection (field of view or zoom, `projectionMatrix[5]`) and the canvas height. It also
     * divides out the world scale of the parent (the widget has the transform of its object). Called before each render.
     */
    updateScale(camera: Camera, heightPx: number) {
        const proj = camera.projectionMatrix.elements[5]
        if (!proj || !heightPx) return
        const {box, diameter} = widgetIconLayout
        // the sprite quad is 1 unit; on screen it is scale * proj * heightPx / 2 pixels (three.js sprite shader)
        const s = 2 * this.size * box / diameter / (proj * heightPx)
        if (this.parent) tmpScale.setFromMatrixScale(this.parent.matrixWorld)
        else tmpScale.set(1, 1, 1)
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
     * Drawn on top of the scene, so a hit on the icon is in front of every other hit: its distance `d` becomes
     * `d / (d + 1) * 1e-6`, under any real hit, and still nearer first among the icons that overlap on screen.
     */
    raycast(raycaster: Raycaster, intersects: Intersection[]) {
        const start = intersects.length
        super.raycast(raycaster, intersects)
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
    }
}
