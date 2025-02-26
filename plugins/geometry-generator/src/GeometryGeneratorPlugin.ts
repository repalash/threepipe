import {
    AViewerPluginSync,
    BufferGeometry,
    BufferGeometry2,
    IGeometry,
    IMaterial,
    Mesh2,
    type Object3DGeneratorPlugin,
    PhysicalMaterial,
    ThreeViewer,
} from 'threepipe'
import {TorusGeometryGenerator} from './primitives/TorusGeometryGenerator'
import {CircleGeometryGenerator} from './primitives/CircleGeometryGenerator'
import {BoxGeometryGenerator} from './primitives/BoxGeometryGenerator'
import {SphereGeometryGenerator} from './primitives/SphereGeometryGenerator'
import {PlaneGeometryGenerator} from './primitives/PlaneGeometryGenerator'
import {CylinderGeometryGenerator} from './primitives/CylinderGeometryGenerator'
import {GeometryGenerator, updateUi} from './AGeometryGenerator'
import {Class} from 'ts-browser-helpers'

/**
 * GeometryGeneratorPlugin
 *
 * Geometry generator plugin to create updatable parametric objects/geometries.
 * Includes support for several primitive types from three.js
 */
export class GeometryGeneratorPlugin extends AViewerPluginSync {
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

    defaultMaterialClass: Class<IMaterial> = PhysicalMaterial
    defaultGeometryClass: Class<BufferGeometry> = BufferGeometry2

    generateObject(type: string, params?: any) {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        const obj = new Mesh2(params?.geometry ?? new this.defaultGeometryClass(), params?.material ?? new this.defaultMaterialClass())
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
        this.refreshObject3DGenerator()
    }

    onRemove(viewer: ThreeViewer) {
        this._removeObject3DGenerators()
        super.onRemove(viewer)
    }

    protected _removeObject3DGenerators(refresh = true) {
        const object3DGenerator = this._viewer?.getPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin')
        if (!object3DGenerator) return
        object3DGenerator.generators = Object.fromEntries(Object.entries(object3DGenerator.generators)
            .filter(([k, _]) => !k.startsWith('geometry-'))) as any
        refresh && object3DGenerator.uiConfig?.uiRefresh?.(true)
        return object3DGenerator
    }

    refreshObject3DGenerator() {
        const object3DGenerator = this._removeObject3DGenerators(false)
        if (!object3DGenerator) return
        Object.keys(this.generators).forEach(key=>{
            object3DGenerator.generators['geometry-' + key] = (params: any)=>{
                const obj = this.generateObject(key, params)
                obj.name = key
                return obj
            }
        })
        object3DGenerator.uiConfig?.uiRefresh?.(true)
    }

    protected _sceneUpdate = (e: any)=>{
        if (e.hierarchyChanged) {
            const obj = e.object || this._viewer?.scene.modelRoot
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
                uuid: 'generate_' + v,
                label: 'Generate ' + v,
                value: async() => {
                    const obj = this.generateObject(v)
                    obj.name = v
                    this._viewer?.scene.addObject(obj)
                },
            }))],
    }

}
