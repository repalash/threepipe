import {Group, Sphere, Vector2} from 'three'
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js'
import {AnyOptions} from 'ts-browser-helpers'
import {Box3B} from '../math/Box3B'
import {IObject3D, IWidget} from '../../core'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

export class SelectionWidget extends Group implements IWidget {
    isWidget = true as const

    private _object: IObject3D | null = null
    boundingScaleMultiplier = 1.
    setDirty?: (options?: AnyOptions) => void

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
        this._object.addEventListener('objectUpdate', this._updater)
        this._updater()
        return this
    }

    detach(): this {
        if (!this._object) return this
        this._object?.removeEventListener('objectUpdate', this._updater)
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

export class BoxSelectionWidget extends SelectionWidget {
    constructor() {
        super()
        const matLine = new LineMaterial({
            color: '#ff2222' as any, transparent: true, opacity: 0.9,
            linewidth: 5, // in pixels
            resolution: new Vector2(1024, 1024), // to be set by renderer, eventually
            dashed: false,
            toneMapped: false,
        })

        const ls = new LineSegmentsGeometry()
        ls.setPositions([1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1].map(v=>v - 0.5))

        const wireframe = new LineSegments2(ls, matLine)
        wireframe.computeLineDistances()
        wireframe.scale.set(1, 1, 1)
        wireframe.visible = true
        this.add(wireframe)
    }

    protected _updater() {
        super._updater()
        const selected = this.object
        if (selected) {
            const bbox = new Box3B().expandByObject(selected, false)
            // const scale = bbox.getBoundingSphere(new Sphere()).radius
            bbox.getSize(this.scale).multiplyScalar(this.boundingScaleMultiplier).clampScalar(0.1, 100)
            this.setVisible(true)
        }
    }
}
