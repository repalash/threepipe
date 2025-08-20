import {
    AViewerPluginSync,
    BufferGeometry2,
    Class,
    IGeometry,
    IMaterial, IObject3D,
    Mesh2,
    type Object3DGeneratorPlugin,
    PhysicalMaterial,
    ThreeViewer, toTitleCase,
} from 'threepipe'
import {TorusGeometryGenerator} from './primitives/TorusGeometryGenerator'
import {CircleGeometryGenerator} from './primitives/CircleGeometryGenerator'
import {BoxGeometryGenerator} from './primitives/BoxGeometryGenerator'
import {SphereGeometryGenerator} from './primitives/SphereGeometryGenerator'
import {PlaneGeometryGenerator} from './primitives/PlaneGeometryGenerator'
import {CylinderGeometryGenerator} from './primitives/CylinderGeometryGenerator'
import {TextGeometryGenerator} from './primitives/TextGeometryGenerator'
import {LineGeometryGenerator} from './primitives/LineGeometryGenerator'
import {AGeometryGenerator, updateUi} from './AGeometryGenerator'

// for type autocomplete
export interface IGeometryGeneratorMap extends Record<string, AGeometryGenerator>{
    plane: PlaneGeometryGenerator
    sphere: SphereGeometryGenerator
    box: BoxGeometryGenerator
    circle: CircleGeometryGenerator
    torus: TorusGeometryGenerator
    cylinder: CylinderGeometryGenerator
    text: TextGeometryGenerator
    line: LineGeometryGenerator
}

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

    generators: IGeometryGeneratorMap = {
        plane: new PlaneGeometryGenerator('plane'),
        sphere: new SphereGeometryGenerator('sphere'),
        box: new BoxGeometryGenerator('box'),
        circle: new CircleGeometryGenerator('circle'),
        torus: new TorusGeometryGenerator('torus'),
        cylinder: new CylinderGeometryGenerator('cylinder'),
        text: new TextGeometryGenerator('text'),
        line: new LineGeometryGenerator('line'),
    }

    defaultMeshClass: Class<IObject3D> = Mesh2
    defaultMaterialClass: Class<IMaterial> = PhysicalMaterial
    defaultGeometryClass: Class<IGeometry> = BufferGeometry2

    generateObject<T extends keyof IGeometryGeneratorMap & string = string, TG extends AGeometryGenerator = IGeometryGeneratorMap[T]>(type: T, params?: Partial<TG['defaultParams']> & {
        mesh?: IObject3D,
        geometry?: IGeometry,
        material?: IMaterial,
    }) {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        let obj = params?.mesh
        const geometry = obj?.geometry || params?.geometry || (generator.defaultGeometryClass ? new (generator.defaultGeometryClass())() : new this.defaultGeometryClass())
        const material = obj?.material || params?.material || (generator.defaultMaterialClass ? new (generator.defaultMaterialClass())() : new this.defaultMaterialClass())
        obj = obj || (generator.defaultMeshClass ? new (generator.defaultMeshClass())(geometry, material) : new this.defaultMeshClass(geometry, material))
        if (obj.geometry !== geometry) obj.geometry = geometry
        if (obj.material !== material) obj.material = material
        generator.generate(obj.geometry, params)
        obj.name = type
        obj.geometry.name = 'Generated ' + toTitleCase(type)
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
