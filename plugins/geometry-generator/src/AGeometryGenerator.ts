import {
    BufferAttribute,
    BufferGeometry,
    BufferGeometry2,
    Class,
    Float32BufferAttribute,
    generateUiConfig,
    getOrCall,
    IGeometry,
    UiObjectConfig,
} from 'threepipe'

declare module 'threepipe'{
    interface IGeometryUserData{
        generationParams?: {
            type: string
            // [key: string]: any
        }
    }
}
export interface GeometryGenerator<T=any>{
    generate(g?: IGeometry, parameters?: T): IGeometry
    createUiConfig?(geometry: IGeometry): UiObjectConfig[]
}

function updateAttribute<T extends BufferAttribute=Float32BufferAttribute>(geometry: BufferGeometry, attribute: string, itemSize: number, array: any[], cls?: Class<T>) {
    const attr = geometry.getAttribute(attribute) as T
    const count = array.length / itemSize
    if (attr && attr.count === count) {
        attr.set(array)
        attr.needsUpdate = true
    } else {
        geometry.setAttribute(attribute, new (cls ?? Float32BufferAttribute)(array, itemSize))
    }
    return attr
}

function updateIndices(geometry: BufferGeometry, indices: any[]) {
    const index = geometry.index
    if (index && index.count === indices.length) {
        index.set(indices)
        index.needsUpdate = true // todo: wireframe attribute is not updating
    } else geometry.setIndex(indices)
}

export function updateUi(geometry: BufferGeometry, childrenUi: () => UiObjectConfig[]) {
    if (!(geometry as any).uiConfig) return
    let oldUi = (geometry as any).uiConfig?.children?.find((c: UiObjectConfig) => c.tags?.includes('generatedGeometry'))
    if (!oldUi) {
        oldUi = {
            type: 'folder',
            label: 'Generation Params',
            tags: ['generatedGeometry'],
            children: [],
        }
        ;(geometry as any).uiConfig.children?.push(oldUi)
    }
    if (geometry.userData.__generationParamsUiType !== geometry.userData.generationParams.type) {
        oldUi.children = childrenUi()
        geometry.userData.__generationParamsUiType = geometry.userData.generationParams.type
        oldUi.uiRefresh?.('postFrame', true)
    }
}

export abstract class AGeometryGenerator<Tp=any> implements GeometryGenerator<Tp> {
    constructor(public type: string) {
    }

    abstract defaultParams: Tp

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        if (!geometry.userData.generationParams) return []
        const ui = generateUiConfig(geometry.userData.generationParams)
            // @ts-expect-error we assume only functions will be generated since its an object
            ?.map(v=>v())
            .filter(v=>getOrCall(v.property)?.[1] !== 'type')
        ui.forEach(u=> {
            u.onChange = () => this.generate(geometry)
        })
        return ui
    }
    protected abstract _generateData(params: Tp): {indices: number[]; vertices: number[]; normals: number[]; uvs: number[], groups?: {start: number, count: number, materialIndex: number}[]}

    generate(g?: IGeometry, parameters: Partial<Tp> = {}): IGeometry|BufferGeometry2 {
        const geometry: IGeometry = g ?? new BufferGeometry2()
        if (!geometry.userData.generationParams) geometry.userData.generationParams = {type: this.type}
        geometry.userData.generationParams.type = this.type
        if ((parameters as any).type) {
            console.error('Cannot change type of generated geometry here, use the plugin instead')
            return geometry
        }
        const params = {
            ...this.defaultParams,
            ...geometry.userData.generationParams,
            ...parameters,
        } as Tp

        const {indices, vertices, normals, uvs, groups} = this._generateData(params)

        // console.log(indices, vertices, normals, uvs, groups)
        updateIndices(geometry, indices)
        updateAttribute(geometry, 'position', 3, vertices)
        updateAttribute(geometry, 'normal', 3, normals)
        updateAttribute(geometry, 'uv', 2, uvs)

        if (groups) {
            geometry.clearGroups()
            for (const group of groups) {
                geometry.addGroup(group.start, group.count, group.materialIndex)
            }
        }

        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()

        Object.assign(geometry.userData.generationParams, params)

        const childrenUi = ()=>this.createUiConfig(geometry)
        updateUi(geometry, childrenUi)

        geometry.setDirty()
        return geometry
    }

}
