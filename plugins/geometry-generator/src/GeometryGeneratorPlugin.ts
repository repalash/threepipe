import {AViewerPluginSync, BufferGeometry2, IGeometry, Mesh, PhysicalMaterial, ThreeViewer} from 'threepipe'
import {TorusGeometryGenerator} from './primitives/TorusGeometryGenerator'
import {CircleGeometryGenerator} from './primitives/CircleGeometryGenerator'
import {BoxGeometryGenerator} from './primitives/BoxGeometryGenerator'
import {SphereGeometryGenerator} from './primitives/SphereGeometryGenerator'
import {PlaneGeometryGenerator} from './primitives/PlaneGeometryGenerator'
import {CylinderGeometryGenerator} from './primitives/CylinderGeometryGenerator'
import {GeometryGenerator, updateUi} from './AGeometryGenerator'

/**
 * GeometryGeneratorPlugin
 *
 * Geometry generator plugin to create updatable parametric objects/geometries.
 * Includes support for several primitive types from three.js
 */
export class GeometryGeneratorPlugin extends AViewerPluginSync<''> {
    public static readonly PluginType = 'GeometryGeneratorPlugin'
    enabled = true
    toJSON: any = undefined

    generators: Record<string, GeometryGenerator> = {
        plane: new PlaneGeometryGenerator('plane'),
        sphere: new SphereGeometryGenerator('sphere'),
        box: new BoxGeometryGenerator('box'),
        circle: new CircleGeometryGenerator('circle'),
        torus: new TorusGeometryGenerator('torus'),
        cylinder: new CylinderGeometryGenerator('cylinder'),
    }

    generateObject(type: string, params?: any) {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        const obj = new Mesh(new BufferGeometry2(), new PhysicalMaterial())
        generator.generate(obj.geometry, params)
        obj.name = type
        obj.geometry.name = 'Generated ' + type
        return obj
    }
    generateGeometry(type: string, params: any, geometry?: IGeometry) {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        const g = generator.generate(geometry, params)
        g.name = 'Generated ' + type
        return g
    }
    updateGeometry(geometry: IGeometry, params: any) {
        if (!geometry.userData.generationParams?.type) throw new Error('Geometry is not generated')
        const generator = this.generators[geometry.userData.generationParams.type]
        if (!generator) throw new Error('Unknown generator type: ' + geometry.userData.generationParams.type)
        generator.generate(geometry, params)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        v.scene.addEventListener('sceneUpdate', this._sceneUpdate)
    }

    protected _sceneUpdate = (e: any)=>{
        if (e.hierarchyChanged) {
            const obj = e.object || this._viewer?.scene.modelRoot
            console.log(obj)
            if (obj) {
                obj.traverse((o: any)=>{
                    const type = o.geometry?.userData?.generationParams?.type
                    if (!type) return
                    updateUi(o.geometry, ()=>{
                        const gen = this.generators[type]
                        return gen?.createUiConfig ? gen.createUiConfig(o.geometry) ?? [] : []
                    })
                })
            }
        }
    }

    uiConfig = {
        type: 'folder',
        label: 'Generate Geometry',
        children:
            [()=>Object.keys(this.generators).map((v) => ({
                type: 'button',
                label: 'Generate ' + v,
                value: async() => {
                    const obj = this.generateObject(v)
                    obj.name = v
                    this._viewer?.scene.addObject(obj)
                },
            }))],
    }

}
