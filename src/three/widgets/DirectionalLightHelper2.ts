import {ColorRepresentation, DirectionalLight, Object3D, Vector3} from 'three'
import {Line2} from 'three/examples/jsm/lines/Line2.js'
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js'
import {onChange} from 'ts-browser-helpers'
import {ALightHelperWidget} from './ALightHelperWidget'
import {IUiConfigContainer, uiSlider} from 'uiconfig.js'
import {LineMaterial2} from '../../core'

export class DirectionalLightHelper2 extends ALightHelperWidget {
    color: ColorRepresentation|undefined
    lightPlane: Line2
    targetLine: Line2
    declare light: (DirectionalLight&IUiConfigContainer)|undefined

    @onChange(DirectionalLightHelper2.prototype.update)
        material: LineMaterial2
    @onChange(DirectionalLightHelper2.prototype.update)
    @uiSlider(undefined, [0.1, 20], 0.01)
        lineWidth = 5
    @onChange(DirectionalLightHelper2.prototype.update)
    @uiSlider(undefined, [0.01, 10], 0.01)
        size = 0.5

    constructor(light: DirectionalLight, size?: number, color?: ColorRepresentation) {
        super(light)

        this.color = color

        if (size !== undefined) this.size = size

        let geometry = new LineGeometry()

        this.material = new LineMaterial2({
            color: 0xff0000,
            linewidth: 5, // in world units with size attenuation, pixels otherwise
            vertexColors: false,
            worldUnits: false,

            dashed: false,
            alphaToCoverage: true,

            toneMapped: false,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
        this.material.userData.renderToGBuffer = false
        this.material.userData.renderToDepth = false

        this.lightPlane = new Line2(geometry, this.material)
        this.add(this.lightPlane)

        geometry = new LineGeometry()
        geometry.setPositions([0, 0, 0, 0, 0, 1])

        this.targetLine = new Line2(geometry, this.material)
        this.add(this.targetLine)

        this.update()

        this.traverse(o=>{
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

    dispose() {

        this.lightPlane.geometry.dispose()
        this.lightPlane.material.dispose()
        this.targetLine.geometry.dispose()
        this.targetLine.material.dispose()

        super.dispose()
    }

    private _v1 = new Vector3()
    private _v2 = new Vector3()
    private _v3 = new Vector3()

    update() {

        if (!this.light || !this.lightPlane) return
        this._v1.setFromMatrixPosition(this.light.matrixWorld)
        this._v2.setFromMatrixPosition(this.light.target.matrixWorld)
        this._v3.subVectors(this._v2, this._v1)

        this.lightPlane.geometry.setPositions([
            -this.size, this.size, 0,
            this.size, this.size, 0,
            this.size, -this.size, 0,
            -this.size, -this.size, 0,
            -this.size, this.size, 0,
        ])
        this.lightPlane.lookAt(this._v2)
        this.lightPlane.material = this.material
        this.targetLine.material = this.material
        this.material.color.set(this.color ?? this.light.color)
        this.material.linewidth = this.lineWidth

        this.targetLine.lookAt(this._v2)
        this.targetLine.scale.z = this.light.intensity / 3.

        super.update()
    }

    static Check(light: Object3D) {
        return (light as DirectionalLight).isDirectionalLight
    }
    static Create(light: Object3D) {
        return new DirectionalLightHelper2(light as DirectionalLight)
    }

}

