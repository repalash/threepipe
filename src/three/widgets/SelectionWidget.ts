import {Group, Sphere} from 'three'
import {AnyOptions} from 'ts-browser-helpers'
import {Box3B} from '../math/Box3B'
import {IMaterial, IObject3D, IWidget} from '../../core'

export class SelectionWidget extends Group implements IWidget {
    isWidget = true as const

    private _object: IObject3D | null = null
    boundingScaleMultiplier = 1.
    setDirty?: (options?: AnyOptions) => void

    lineMaterial?: IMaterial

    protected _updater() {
        const selected: IObject3D | null | undefined = this._object
        if (selected) {
            const bbox = new Box3B().expandByObject(selected, false)
            bbox.getCenter(this.position)
            const scale = bbox.getBoundingSphere(new Sphere()).radius
            this.scale.setScalar(scale * this.boundingScaleMultiplier)
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

    }

    setVisible(v: boolean) {
        if (v !== this.visible) {
            this.visible = v
            this.setDirty?.({sceneUpdate: false})
        }
    }

    attach(object: IObject3D): this {
        this.detach()
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

    dispose() {
        this.detach()
    }

}

