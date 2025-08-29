import {
    BufferAttribute,
    BufferGeometry,
    BufferGeometry2,
    Class,
    Float32BufferAttribute,
    generateUiConfig,
    getOrCall,
    IGeometry, IMaterial, IObject3D, LineGeometry2, Mesh2, PhysicalMaterial,
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

function updateAttribute<T extends BufferAttribute=Float32BufferAttribute>(geometry: BufferGeometry, attribute: string, itemSize: number, array: T | number[], cls?: Class<T>) {
    const attr = geometry.getAttribute(attribute) as T
    const count = Array.isArray(array) ? array.length / itemSize : array.count
    if (attr && attr.count === count) {
        attr.set(Array.isArray(array) ? array : (array as T).array)
        attr.needsUpdate = true
    } else {
        geometry.setAttribute(attribute, Array.isArray(array) ? new (cls ?? Float32BufferAttribute)(array, itemSize) : array as T)
    }
    return attr
}

function updateIndices(geometry: BufferGeometry, indices: number[] | BufferAttribute) {
    const index = geometry.index
    if (index && index.count === (Array.isArray(indices) ? indices.length : indices.count)) {
        index.set(Array.isArray(indices) ? indices : (indices as BufferAttribute).array)
        index.needsUpdate = true // todo: wireframe attribute is not updating
    } else geometry.setIndex(indices)
}

export function updateUi(geometry: BufferGeometry, childrenUi: () => UiObjectConfig[]) {
    const uiConfig = (geometry as any).uiConfig as UiObjectConfig
    if (!uiConfig) return
    let oldUi = uiConfig.children?.find((c) => typeof c === 'object' && c.tags?.includes('generatedGeometry')) as UiObjectConfig | undefined
    if (!oldUi) {
        oldUi = {
            type: 'folder',
            label: 'Generation Params',
            expanded: true,
            tags: ['generatedGeometry'],
            children: [],
        }
        const dividerIndex = uiConfig.children?.findIndex((c) => typeof c === 'object' && (c.type === 'divider' || c.type === 'separator')) ?? -1
        if (dividerIndex >= 0) {
            uiConfig.children?.splice(dividerIndex, 0, oldUi)
        } else uiConfig.children?.push(oldUi)
    }
    if (geometry.userData.__generationParamsUiType !== geometry.userData.generationParams.type) {
        oldUi.children = childrenUi()
        geometry.userData.__generationParamsUiType = geometry.userData.generationParams.type
        oldUi.uiRefresh?.(true, 'postFrame')
    }
}

export function removeUi(geometry: BufferGeometry) {
    const uiConfig = (geometry as any).uiConfig as UiObjectConfig
    if (!uiConfig) return
    const index = uiConfig.children?.findIndex((c) => typeof c === 'object' && c.tags?.includes('generatedGeometry')) ?? -1
    if (index >= 0) {
        uiConfig.children?.splice(index, 1)
        uiConfig.uiRefresh?.(true, 'postFrame')
    }
}

export abstract class AGeometryGenerator<Tp extends object=any, Tt extends string = string> implements GeometryGenerator<Tp> {
    constructor(public type: Tt) {
    }

    abstract defaultParams: Tp

    defaultMeshClass: ()=>Class<IObject3D> = ()=>Mesh2
    defaultMaterialClass?: ()=>Class<IMaterial> = ()=>PhysicalMaterial
    defaultGeometryClass?: ()=>Class<IGeometry> = ()=>BufferGeometry2

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        if (!geometry.userData.generationParams) return []
        const ui = (generateUiConfig(geometry.userData.generationParams)
            ?.flatMap(v=>getOrCall(v))
            .filter(v=>getOrCall(v.property)?.[1] !== 'type') || []) as UiObjectConfig[]
        ui.forEach(u=> {
            u.onChange = () => this.generate(geometry)
        })
        return ui
    }
    protected abstract _generateData(params: Tp): {
        indices?: number[] | BufferAttribute
        vertices: number[] | BufferAttribute
        normals?: number[] | BufferAttribute
        uvs?: number[] | BufferAttribute
        groups?: {start: number, count: number, materialIndex?: number}[]
        positions?: number[] // for lines
    }

    generate(g?: IGeometry, parameters: Partial<Tp> = {}): IGeometry|BufferGeometry2 {
        const geometry: IGeometry = g ?? new BufferGeometry2()
        if ((parameters as any).type && (parameters as any).type !== this.type) {
            console.error('Cannot change type of generated geometry here, use the plugin instead')
            return geometry
        }
        if (!geometry.userData.generationParams) geometry.userData.generationParams = {type: this.type}
        geometry.userData.generationParams.type = this.type
        const params = {
            ...this.defaultParams,
            ...geometry.userData.generationParams,
            ...parameters,
            type: this.type,
        } as Tp

        const {indices, vertices, normals, uvs, groups, positions} = this._generateData(params)

        if (positions !== undefined && (geometry as LineGeometry2).setPositions) {
            (geometry as LineGeometry2).setPositions(positions)
        } else {
            // console.log(indices, vertices, normals, uvs, groups)
            indices && updateIndices(geometry, indices)
            vertices && updateAttribute(geometry, 'position', 3, vertices)
            normals && updateAttribute(geometry, 'normal', 3, normals)
            uvs && updateAttribute(geometry, 'uv', 2, uvs)
        }

        if (groups) {
            geometry.clearGroups()
            for (const group of groups) {
                geometry.addGroup(group.start, group.count, group.materialIndex)
            }
        }

        geometry.computeBoundingBox && geometry.computeBoundingBox()
        geometry.computeBoundingSphere && geometry.computeBoundingSphere()

        Object.assign(geometry.userData.generationParams, params)

        const childrenUi = ()=>this.createUiConfig(geometry)
        updateUi(geometry, childrenUi)

        geometry.setDirty()
        return geometry
    }

    setDefaultParams(params: Partial<Tp>) {
        Object.assign(this.defaultParams, params)
        return this
    }
}
