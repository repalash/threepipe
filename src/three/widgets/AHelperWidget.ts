import {Color, ColorRepresentation, Light, Object3D, PerspectiveCamera} from 'three'
import {generateUiFolder, IUiConfigContainer, uiToggle} from 'uiconfig.js'
import {Group2, iObjectCommons, IObject3D, IWidget, LineMaterial2} from '../../core'
import {onChange2} from 'ts-browser-helpers'
import {getWidgetKind, WidgetIconMode, WidgetKind, widgetKinds} from './widgetKinds'
import {WidgetIcon} from './WidgetIcon'

/**
 * Abstract base class for helper widgets that visualize scene objects.
 * Provides event-driven lifecycle (attach/detach/update) and UI integration.
 * See https://threepipe.org/notes/widgets-and-helpers for the full widget system documentation.
 */
export abstract class AHelperWidget extends Group2 implements IWidget {
    isWidget = true as const
    assetType = 'widget' as const

    object: (Object3D & IUiConfigContainer) | undefined

    @uiToggle()
    @onChange2(AHelperWidget.prototype.update)
        visible = true

    /**
     * The kind of the attached object (a light or a camera kind), for the colour of the lines and the {@link icon}.
     * `undefined` for other objects; those widgets have no icon.
     */
    kind: WidgetKind | undefined

    /**
     * The colour of the lines. When not set, the colour of the {@link kind} ({@link widgetKinds}) is used.
     */
    color: ColorRepresentation | undefined

    /**
     * Show the {@link icon} of the object (only for objects with a {@link kind}).
     * Set for all widgets with `Object3DWidgetsPlugin.showIcons`.
     */
    @onChange2(AHelperWidget.prototype.update)
        showIcon = true

    /**
     * The diameter of the {@link icon} in CSS pixels. Set for all widgets with `Object3DWidgetsPlugin.iconSize`.
     */
    @onChange2(AHelperWidget.prototype.update)
        iconSize = 22

    /**
     * How the icon is drawn. `sprite`: the widget has an {@link icon} sprite in the scene. `dom`: the widget has no
     * sprite, and a DOM overlay draws the icon (`WidgetIconOverlay`, made by `Object3DWidgetsPlugin`); a widget used
     * without the plugin then shows no icon. Set for all widgets with `Object3DWidgetsPlugin.iconMode`.
     */
    @onChange2(AHelperWidget.prototype.update)
        iconMode: WidgetIconMode = 'sprite'

    /**
     * Whether the icon is shown: the widget is attached to an object with a {@link kind} and {@link showIcon} is on.
     * The visibility of the widget and its parents applies on top of it.
     */
    get hasIcon() {
        return !!this.object && !!this.kind && this.showIcon
    }

    /**
     * The icon of the object: a sprite that keeps its size in pixels, drawn on top. Made when the icon is shown
     * ({@link hasIcon}) and {@link iconMode} is `sprite`.
     */
    icon: WidgetIcon | undefined

    protected constructor(object: Object3D & IUiConfigContainer, attach = true) {
        super()
        this.object = object
        this.object.updateMatrixWorld()
        if ((this.object as PerspectiveCamera).updateProjectionMatrix)
            (this.object as PerspectiveCamera).updateProjectionMatrix()

        this.matrix = object.matrixWorld
        this.matrixAutoUpdate = false

        // this.userData.bboxVisible = false // todo autoNearFar?

        this.detach = this.detach.bind(this)
        this._objectUpdate = this._objectUpdate.bind(this)
        this._objectBeforeRender = this._objectBeforeRender.bind(this)
        attach && this.attach(object)
        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
        this.renderOrder = 100

    }

    update(setDirty = true) {
        this._updateIcon()
        setDirty && iObjectCommons.setDirty.call(this)
    }

    /** The colour of the lines: {@link color}, else the colour of the {@link kind} */
    protected get _lineColor(): ColorRepresentation {
        return this.color ?? (this.kind ? widgetKinds[this.kind].color : 0xffffff)
    }

    /**
     * A material for the lines of a helper: a constant pixel width, not tone mapped, not in the GBuffer or the depth
     * passes (see the material convention in the widgets docs).
     */
    protected _createLineMaterial(vertexColors = false) {
        const material = new LineMaterial2({
            color: 0xffffff,
            linewidth: 3, // in world units with size attenuation, pixels otherwise
            vertexColors,
            worldUnits: false,

            dashed: false,
            alphaToCoverage: true,

            toneMapped: false,
            transparent: true,
            depthTest: true,
            depthWrite: false,

            allowOverride: false,
        })
        material.userData.renderToGBuffer = false
        material.userData.renderToDepth = false
        return material
    }

    protected _updateIcon() {
        const kind = this.object && this.iconMode === 'sprite' ? this.kind : undefined
        if (this.icon && this.icon.kind !== kind) {
            this.icon.dispose()
            this.icon.removeFromParent()
            this.icon = undefined
        }
        if (!kind || !this.showIcon) {
            if (this.icon) this.icon.visible = false
            return
        }
        if (!this.icon) {
            this.icon = new WidgetIcon(kind)
            this.add(this.icon)
        }
        this.icon.visible = true
        this.icon.size = this.iconSize
        const color = (this.object as Light).color
        if (color?.isColor) this.icon.setDotColor(color as Color)
    }

    private _objectUpdated = false
    protected _objectUpdate() {
        this._objectUpdated = true
    }
    // todo in threejs onbeforerender is not called on objects, lights etc, only meshes and scene, see ALightHelperWidget and skeleton helper
    protected _objectBeforeRender() {
        if (!this.visible) return
        if (!this._objectUpdated) return
        this._objectUpdated = false
        if (this.object) this.update()
    }

    attach(object: Object3D): this {
        if (this.object) this.detach()
        this.object = object
        this.kind = object ? getWidgetKind(object) : undefined
        if (this.object) {
            this.update()
            const obj = this.object as IObject3D
            obj.addEventListener('beforeRender', this._objectBeforeRender)
            obj.addEventListener('objectUpdate', this._objectUpdate)
            obj.addEventListener('geometryUpdate', this._objectUpdate)
            this.uiConfig && this.object.uiConfig?.children?.push(this.uiConfig)
            this.visible = true
        }
        return this
    }

    detach(): this {
        if (!this.object) return this
        const obj = this.object as IObject3D
        obj.removeEventListener('beforeRender', this._objectBeforeRender)
        obj.removeEventListener('objectUpdate', this._objectUpdate)
        obj.removeEventListener('geometryUpdate', this._objectUpdate)
        if (this.uiConfig) {
            const i = this.object.uiConfig?.children?.indexOf(this.uiConfig)
            if (i !== undefined && i >= 0)
                this.object.uiConfig?.children?.splice(i, 1)
        }
        this.object = undefined
        this.visible = false
        return this
    }

    uiConfig = generateUiFolder('Widget', this, {tags: 'widget'})

    dispose() {
        this.detach()
        this.icon?.dispose()
    }
}

