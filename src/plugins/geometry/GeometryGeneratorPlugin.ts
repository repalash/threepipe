import {Class, toTitleCase} from 'ts-browser-helpers'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {BufferGeometry2} from '../../core/geometry/BufferGeometry2'
import {IGeometry} from '../../core/IGeometry'
import {IMaterial} from '../../core/IMaterial'
import {IMesh, IObject3D, IObject3DEventMap} from '../../core/IObject'
import {ISceneEventMap} from '../../core/IScene'
import {Mesh2} from '../../core/object/Mesh2'
import {PhysicalMaterial} from '../../core/material/PhysicalMaterial'
import type {Object3DGeneratorPlugin} from '../extras/Object3DGeneratorPlugin'
import {TorusGeometryGenerator} from './primitives/TorusGeometryGenerator'
import {CircleGeometryGenerator} from './primitives/CircleGeometryGenerator'
import {BoxGeometryGenerator} from './primitives/BoxGeometryGenerator'
import {SphereGeometryGenerator} from './primitives/SphereGeometryGenerator'
import {PlaneGeometryGenerator} from './primitives/PlaneGeometryGenerator'
import {CylinderGeometryGenerator} from './primitives/CylinderGeometryGenerator'
import {TubeGeometryGenerator} from './primitives/TubeGeometryGenerator'
import {ShapeGeometryGenerator} from './primitives/ShapeGeometryGenerator'
import {TubeShapeGeometryGenerator} from './primitives/TubeShapeGeometryGenerator'
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
    tube: TubeGeometryGenerator
    shape: ShapeGeometryGenerator
    tubeShape: TubeShapeGeometryGenerator
    line: LineGeometryGenerator
}

/**
 * GeometryGeneratorPlugin
 *
 * Geometry generator plugin to create updatable parametric objects/geometries.
 * Built-in generators: plane, sphere, box, circle, torus, cylinder, tube, shape, tubeShape, line.
 *
 * Additional generators (text) can be registered at runtime via the `generators` property
 * or by using `GeometryGeneratorExtrasPlugin` from `@threepipe/plugin-geometry-generator`.
 *
 * @category Plugins
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
        tube: new TubeGeometryGenerator('tube'),
        shape: new ShapeGeometryGenerator('shape'),
        tubeShape: new TubeShapeGeometryGenerator('tubeShape'),
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
    >(type: T, {mesh, geometry, material, ...params}: Partial<TG['defaultParams']> & {
        mesh?: IMesh<IObject3DEventMap, TGeometry, TMaterial>,
        geometry?: TGeometry,
        material?: TMaterial,
    } = {}): IMesh<IObject3DEventMap, TGeometry, TMaterial> {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown generator type: ' + type)
        let obj = mesh
        const geometry1 = obj?.geometry || geometry || (generator.defaultGeometryClass ? new (generator.defaultGeometryClass())() : new this.defaultGeometryClass())
        const material1 = obj?.material || material || (generator.defaultMaterialClass ? new (generator.defaultMaterialClass())() : new this.defaultMaterialClass())
        obj = obj || (generator.defaultMeshClass ? new (generator.defaultMeshClass())(geometry1, material1) : new this.defaultMeshClass(geometry1, material1)) as any
        if (!obj) return obj as any
        if (obj.geometry !== geometry1) obj.geometry = geometry1 as any
        if (obj.material !== material1) obj.material = material1 as any
        generator.generate(obj.geometry, params)
        obj.name = type
        if (!geometry1.name)
            geometry1.name = 'Generated ' + toTitleCase(type)
        if (!material1.name)
            material1.name = 'Material for ' + geometry1.name
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
        viewer.scene.removeEventListener('geometryUpdate', this._geometryUpdate)
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
