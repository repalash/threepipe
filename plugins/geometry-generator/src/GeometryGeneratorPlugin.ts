import {
    AViewerPluginSync,
    BufferGeometry2,
    Class,
    IGeometry,
    IMaterial, IMesh, IObject3D, IObject3DEventMap, ISceneEventMap,
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
import {AGeometryGenerator, removeUi, updateUi} from './AGeometryGenerator'

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

    generateObject<
        T extends keyof IGeometryGeneratorMap & string = string,
        TGeometry extends IGeometry = IGeometry,
        TMaterial extends IMaterial = IMaterial,
        TG extends AGeometryGenerator = IGeometryGeneratorMap[T]
    >(type: T, params?: Partial<TG['defaultParams']> & {
        mesh?: IMesh<IObject3DEventMap, TGeometry, TMaterial>,
        geometry?: TGeometry,
        material?: TMaterial,
    }): IMesh<IObject3DEventMap, TGeometry, TMaterial> {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        let obj = params?.mesh
        const geometry = obj?.geometry || params?.geometry || (generator.defaultGeometryClass ? new (generator.defaultGeometryClass())() : new this.defaultGeometryClass())
        const material = obj?.material || params?.material || (generator.defaultMaterialClass ? new (generator.defaultMaterialClass())() : new this.defaultMaterialClass())
        obj = obj || (generator.defaultMeshClass ? new (generator.defaultMeshClass())(geometry, material) : new this.defaultMeshClass(geometry, material)) as any
        if (!obj) return obj as any
        if (obj.geometry !== geometry) obj.geometry = geometry as any
        if (obj.material !== material) obj.material = material as any
        generator.generate(obj.geometry, params)
        obj.name = type
        if (!geometry.name)
            geometry.name = 'Generated ' + toTitleCase(type)
        return obj
    }
    generateGeometry(type: string, params: any, geometry?: IGeometry) {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        const g = generator.generate(geometry, params)
        g.name = 'Generated ' + type
        return g
    }
    updateGeometry(geometry: IGeometry, params?: any) {
        if (!geometry.userData.generationParams?.type) throw new Error('Geometry is not generated')
        const generator = this.generators[geometry.userData.generationParams.type]
        if (!generator) throw new Error('Unknown generator type: ' + geometry.userData.generationParams.type)
        generator.generate(geometry, params)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('geometryUpdate', this._geometryUpdate)

        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)

        viewer.forPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin', (plugin)=>{
            plugin.addObject3DGenerators('geometry-', Object.fromEntries(Object.keys(this.generators).map(key=>
                [key, (params: any) => {
                    const obj = this.generateObject(key, params)
                    obj.name = key
                    return obj
                }]
            )))
        }, (plugin)=>{
            plugin.removeObject3DGenerators('geometry-')
        }, this)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))

        super.onRemove(viewer)
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const obj = e.object
        const type = obj?.geometry?.userData?.generationParams?.type
        if (!type) return
        updateUi(obj.geometry!, ()=>{
            const geom = obj.geometry
            if (!geom) return []
            const gen = this.generators[type]
            return gen?.createUiConfig ? gen.createUiConfig(geom) ?? [] : []
        })
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const geom = e.object?.geometry
        const type = geom?.userData?.generationParams?.type
        if (!type) return
        removeUi(geom)
    }

    // to regenerate call geometry.setDirty({regenerate: true})
    protected _geometryUpdate = (e: ISceneEventMap['geometryUpdate'])=>{
        if (e.regenerate && e.geometry?.userData?.generationParams)
            this.updateGeometry(e.geometry)
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

// declare module 'threepipe'{
//     // @ats-expect-error not sure why
//     interface IGeometrySetDirtyOptions{
//         /**
//          * Regenerate a geometry. The geometry must have generationParams set in userData.
//          */
//         regenerate?: boolean
//     }
//
// }
