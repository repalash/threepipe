import {ColorRepresentation, Object3D, PointLight, SphereGeometry} from 'three'
import {WireframeGeometry2} from 'three/examples/jsm/lines/WireframeGeometry2.js'
import {Wireframe} from 'three/examples/jsm/lines/Wireframe.js'
import {onChange} from 'ts-browser-helpers'
import {ALightHelperWidget} from './ALightHelperWidget'
import {IUiConfigContainer, uiSlider} from 'uiconfig.js'
import {LineMaterial2} from '../../core'

export class PointLightHelper2 extends ALightHelperWidget {
    color: ColorRepresentation | undefined
    lightSphere: Wireframe
    declare light: (PointLight & IUiConfigContainer) | undefined
    @onChange(PointLightHelper2.prototype.update)
        material: LineMaterial2
    @onChange(PointLightHelper2.prototype.update)
    @uiSlider(undefined, [0.1, 20], 0.01)
        lineWidth = 5
    @onChange(PointLightHelper2.prototype.update)
    @uiSlider(undefined, [0.01, 10], 0.01)
        size = 0.5

    constructor(light: PointLight, size?: number, color?: ColorRepresentation) {
        super(light)

        this.color = color

        if (size !== undefined) this.size = size

        const geometry = new WireframeGeometry2(new SphereGeometry(0.5, 4, 2))

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

        this.lightSphere = new Wireframe(geometry, this.material)
        this.lightSphere.computeLineDistances()
        this.add(this.lightSphere)

        this.update()

        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

    dispose() {

        this.lightSphere.geometry.dispose()
        ;(this.lightSphere.material as any).dispose()

        super.dispose()
    }

    update() {

        if (!this.light || !this.lightSphere) return

        this.material.color.set(this.color ?? this.light.color)
        this.material.linewidth = this.lineWidth
        this.lightSphere.scale.setScalar(this.size)

        super.update()
    }

    static Check(light: Object3D) {
        return (light as PointLight).isPointLight
    }

    static Create(light: Object3D) {
        return new PointLightHelper2(light as PointLight)
    }


}
