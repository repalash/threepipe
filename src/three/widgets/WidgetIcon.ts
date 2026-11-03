import {Camera, Color, Intersection, Raycaster, Sprite, SpriteMaterial, Texture, Vector2, Vector3, WebGLRenderer} from 'three'
import {getWidgetDotTexture, getWidgetIconTexture, widgetIconLayout, WidgetKind, widgetKinds} from './widgetKinds'

/** A sprite material that is drawn on top, at a constant size, and is not in the GBuffer or the depth passes */
function iconMaterial(map?: Texture) {
    const material = new SpriteMaterial({
        map: map ?? null,
        sizeAttenuation: false, // the same size at any distance
        depthTest: false, // drawn on top
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        premultipliedAlpha: true, // the textures are premultiplied
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
 * It is made by {@link AHelperWidget} for the objects that have a kind. A click on it selects the object of its widget
 * (through the PickingPlugin, like the lines of the widget).
 */
export class WidgetIcon extends Sprite {
    declare material: SpriteMaterial
    readonly kind: WidgetKind
    /** The dot in the object's own colour (lights only) */
    readonly dot: Sprite
    /** The diameter of the round icon in CSS pixels */
    size: number = widgetIconLayout.diameter

    constructor(kind: WidgetKind) {
        super(iconMaterial(getWidgetIconTexture(kind)))
        this.kind = kind
        this.name = 'Widget Icon'
        this.renderOrder = 1 // after the lines of the widget

        const {box, dot, dotOffset} = widgetIconLayout
        this.dot = new Sprite(iconMaterial(getWidgetDotTexture()))
        this.dot.name = 'Widget Icon Dot'
        this.dot.renderOrder = 1 // same z and order as the icon, the icon is first (lower id), and sets the dot scale
        this.dot.scale.setScalar(dot / box)
        // centre of the dot at dotOffset right and down of the icon centre
        this.dot.center.set(0.5 - dotOffset / dot, 0.5 + dotOffset / dot)
        this.dot.raycast = () => undefined // a click on the dot is a click on the icon under it
        this.dot.visible = widgetKinds[kind].dot
        this.add(this.dot)

        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.receiveShadow = false
        })
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
    }

    raycast(raycaster: Raycaster, intersects: Intersection[]) {
        const start = intersects.length
        super.raycast(raycaster, intersects)
        // drawn on top of the scene, so a hit on the icon is in front of every other hit
        for (let i = start; i < intersects.length; i++) intersects[i].distance = 0
    }

    dispose() {
        this.material.dispose()
        this.dot.material.dispose()
    }
}
