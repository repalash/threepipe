import {Sphere} from 'three'
import {Box3B} from '../math/Box3B'
import {Group2, IMaterial, IObject3D, IWidget, RootScene} from '../../core'

export class SelectionWidget extends Group2 implements IWidget {
    isWidget = true as const
    assetType = 'widget' as const

    private _object: IObject3D | null = null
    boundingScaleMultiplier = 1.

    lineMaterial?: IMaterial

    protected _updater() {
        const selected: IObject3D | null | undefined = this._object
        if (selected) {
            const bbox = new Box3B().expandByObject(selected, false)
            bbox.getCenter(this.position)
            let scale = bbox.getBoundingSphere(new Sphere()).radius
            if (scale <= 0) { // It could be a light or camera with no geometry
                selected.getWorldPosition(this.position)
                scale = 0.1
            }
            this.scale.setScalar(scale * this.boundingScaleMultiplier).clampScalar(0.01, 1e8)
            this.setVisible(true)
        } else {
            this.setVisible(false)
        }

    }

    constructor() {
        super()

        this.position.set(0, 0, 0)

        this.visible = false
        this.renderOrder = 100 // Don't draw too early, thus obscuring other transparent objects

        this.userData.bboxVisible = false

        this._updater = this._updater.bind(this)
        this.detach = this.detach.bind(this)

        this.addEventListener('dispose', this.detach)
    }

    setVisible(v: boolean) {
        if (v !== this.visible) {
            this.visible = v
            this.setDirty?.({sceneUpdate: false})
        }
    }

    attach(object: IObject3D): this {
        this.detach()
        let inScene = false
        object.traverseAncestors(c=>(c as RootScene).isRootScene && (inScene = true))
        if (!inScene) {
            // console.warn('SelectionWidget: attached object must be in the scene')
            return this
        }
        if (!object) return this
        this._object = object
        // todo object update doesnt work on child when parent is updated, better is to subscribe to objectUpdate of the scene and see if the attached object is in the child of the updated object, also throttle update to once per frame
        this._object.addEventListener('objectUpdate', this._updater)
        this._object.addEventListener('geometryUpdate', this._updater)
        this._updater()
        return this
    }

    detach(): this {
        if (!this._object) return this
        this._object?.removeEventListener('objectUpdate', this._updater)
        this._object?.removeEventListener('geometryUpdate', this._updater)
        this._object = null
        this._updater()
        return this
    }

    get object(): IObject3D | null {
        return this._object
    }
}

