import {BufferGeometry, Event, NormalBufferAttributes, NormalOrGLBufferAttributes} from 'three'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {AnyOptions} from 'ts-browser-helpers'
import {IObject3D} from './IObject'
import {IImportResultUserData} from '../assetmanager'

export interface IGeometryUserData extends IImportResultUserData{
    disposeOnIdle?: boolean // default: true
    // [key: string]: any // commented for noe
}
export interface IGeometry<Attributes extends NormalOrGLBufferAttributes = NormalBufferAttributes> extends BufferGeometry<Attributes, IGeometryEvent, IGeometryEventTypes>, IUiConfigContainer {
    assetType: 'geometry'
    setDirty(options?: IGeometrySetDirtyOptions): void;
    refreshUi(): void;
    uiConfig?: UiObjectConfig
    appliedMeshes: Set<IObject3D>

    // Note: for userData: add _ in front of for private use, which is preserved while cloning but not serialisation, and __ for private use, which is not preserved while cloning and serialisation
    userData: IGeometryUserData


    // eslint-disable-next-line @typescript-eslint/naming-convention
    _uiConfig?: UiObjectConfig

}
export type IGeometryEventTypes = 'dispose' | 'geometryUpdate' // | string
export type IGeometryEvent<T extends string = IGeometryEventTypes> = Event & {
    type: T
    bubbleToObject?: boolean // bubble event to parent root
    geometry: IGeometry
    // change?: string
}
export type IGeometrySetDirtyOptions = AnyOptions & {bubbleToObject?: boolean}


