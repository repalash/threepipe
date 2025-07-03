import {ColorRepresentation, Object3D, SpotLight, Vector3} from 'three'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {onChange} from 'ts-browser-helpers'
import {ALightHelperWidget} from './ALightHelperWidget'
import {IUiConfigContainer, uiSlider} from 'uiconfig.js'
import {LineMaterial2} from '../../core'

export class SpotLightHelper2 extends ALightHelperWidget {
    color: ColorRepresentation | undefined
    cone: LineSegments2
    declare light: (SpotLight & IUiConfigContainer) | undefined
    @onChange(SpotLightHelper2.prototype.update)
        material: LineMaterial2
    @onChange(SpotLightHelper2.prototype.update)
    @uiSlider(undefined, [0.1, 20], 0.01)
        lineWidth = 5

    constructor(light: SpotLight, size?: number, color?: ColorRepresentation) {
        super(light)

        this.color = color

        if (size === undefined) size = 0.5

        const geometry = new LineSegmentsGeometry()
        const positions = [
            0, 0, 0, 	0, 0, 1,
            0, 0, 0, 	1, 0, 1,
            0, 0, 0,	-1, 0, 1,
            0, 0, 0, 	0, 1, 1,
            0, 0, 0, 	0, -1, 1,
        ]

        for (let i = 0, j = 1, l = 32; i < l; i++, j++) {

            const p1 = i / l * Math.PI * 2
            const p2 = j / l * Math.PI * 2

            positions.push(
                Math.cos(p1), Math.sin(p1), 1,
                Math.cos(p2), Math.sin(p2), 1
            )

        }
        geometry.setPositions(positions)

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

        this.cone = new LineSegments2(geometry, this.material)
        this.add(this.cone)

        this.update()

        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

    dispose() {

        this.cone.geometry.dispose()
        this.cone.material.dispose()

        super.dispose()
    }

    private _v1 = new Vector3()

    update() {

        if (!this.light || !this.cone) return

        this.light.updateWorldMatrix(true, false)
        this.light.target.updateWorldMatrix(true, false)

        const coneLength = this.light.distance ? this.light.distance : 1000
        const coneWidth = coneLength * Math.tan(this.light.angle)

        this.cone.scale.set(coneWidth, coneWidth, coneLength)

        this._v1.setFromMatrixPosition(this.light.target.matrixWorld)

        this.cone.lookAt(this._v1)

        this.material.color.set(this.color ?? this.light.color)
        this.material.linewidth = this.lineWidth

        super.update()
    }

    static Check(light: Object3D) {
        return (light as SpotLight).isSpotLight
    }

    static Create(light: Object3D) {
        return new SpotLightHelper2(light as SpotLight)
    }

}
