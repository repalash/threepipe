import {BoxGeometry, CylinderGeometry, HemisphereLight, Light, Mesh, Scene, SphereGeometry, Vector3} from 'three'
import {IDisposable} from 'ts-browser-helpers'
import {snapObject} from './snapObject'
import {IMaterial, ITexture, IWebGLRenderer} from '../../core'

export class MaterialPreviewGenerator implements IDisposable {
    private _scene: Scene
    private _channel: number
    private _lights: Light[] = []

    constructor() {

        const scene = new Scene()

        this._channel = 7
        const hemisphericLight = new HemisphereLight(0xffffff, 0x444444, 1)
        hemisphericLight.position.set(0, 10, 0)
        hemisphericLight.layers.set(this._channel)
        scene.add(hemisphericLight)
        this._lights.push(hemisphericLight)

        this._scene = scene

    }

    dispose() {
        [...this._lights].forEach(light => light.dispose())
        Object.values(this.shapes).forEach(shape => {
            if (shape.geometry) shape.geometry.dispose()
        })
    }

    shapes: Record<string, Mesh> = {
        sphere: new Mesh(new SphereGeometry(1)),
        cube: new Mesh(new BoxGeometry(1, 1, 1)),
        cylinder: new Mesh(new CylinderGeometry(0.5, 0.5, 1)),
    }

    // todo: show an overlay when this is happening
    generate(material: IMaterial, renderer: IWebGLRenderer, environment?: ITexture|null, shape = 'sphere'): string {
        const object = this.shapes[shape] || new Mesh(new SphereGeometry(1))
        object.material = material

        if (!object.geometry.attributes.tangent) object.geometry.computeTangents() // for anisotropy

        this._scene.add(object)
        this._scene.environment = environment ?? null

        const envIntensity = material.envMapIntensity
        // clamp since we have no tonemapping
        if (typeof envIntensity === 'number') {
            material.envMapIntensity = Math.max(envIntensity, 2)
        }

        const snap = snapObject(renderer, object, this._scene, this._channel, new Vector3(0, 0, 1.5))
        // const snap = snapObject(this.viewer, (material.userData.__appliedMeshes as Set<Mesh>).values().next().value, undefined, this._channel)

        if (typeof envIntensity === 'number')
            material.envMapIntensity = envIntensity

        this._scene.remove(object)

        object.material = undefined as any

        return snap
    }

}
