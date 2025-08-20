import {
    BufferGeometry,
    BufferGeometryEventMap,
    NormalBufferAttributes,
    NormalOrGLBufferAttributes,
    Vector3,
} from 'three'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {AnyOptions} from 'ts-browser-helpers'
import {IObject3D} from './IObject'
import {IImportResultUserData} from '../assetmanager'

export interface IGeometryUserData extends IImportResultUserData{
    /**
     * Automatically dispose geometry when not used by any object in the scene
     * @default true
     */
    disposeOnIdle?: boolean
    [key: string]: any
}
export interface IGeometry<Attributes extends NormalOrGLBufferAttributes = NormalBufferAttributes, TE extends IGeometryEventMap = IGeometryEventMap> extends BufferGeometry<Attributes, TE>, IUiConfigContainer {
    assetType: 'geometry'
    setDirty(options?: IGeometrySetDirtyOptions): void;
    refreshUi(): void;
    uiConfig?: UiObjectConfig
    isBufferGeometry: true

    /**
     * Centers the geometry.
     * @param offset - returns the offset applied to the geometry
     * @param keepWorldPosition - Updates the attached meshes, so that the world position of the geometry remains the same.
     * @param setDirty
     */
    center(offset?: Vector3, keepWorldPosition?: boolean, setDirty?: boolean): BufferGeometry

    /**
     * Same as center but returns a function to undo the centering
     * @param offset
     * @param keepWorldPosition
     */
    center2(offset?: Vector3, keepWorldPosition?: boolean): ()=>void

    // Note: for userData: add _ in front of for private use, which is preserved while cloning but not serialisation, and __ for private use, which is not preserved while cloning and serialisation
    userData: IGeometryUserData

    /**
     * Objects in the scene that are using this geometry.
     * This is set in the {@link Object3DManager} when the objects are added/removed from the scene. Do not modify this set directly.
     */
    appliedMeshes: Set<IObject3D>

    /**
     * Disposes the geometry from the GPU.
     * Set force to false if not sure the geometry is used by any object in the scene.
     * // todo add check for visible in scene also? or is that overkill
     * @param force - when true, same as three.js dispose. when false, only disposes if disposeOnIdle not false and not used by any object in the scene. default: true
     */
    dispose(force?: boolean): void

    // eslint-disable-next-line @typescript-eslint/naming-convention
    _uiConfig?: UiObjectConfig

}
// export type IGeometryEventTypes = 'dispose' | 'geometryUpdate' // | string
// export type IGeometryEvent<T extends string = IGeometryEventTypes> = Event & {
//     type: T
//     bubbleToObject?: boolean // bubble event to parent root
//     geometry?: IGeometry
//     // change?: string
// }
export type IGeometrySetDirtyOptions = AnyOptions & {bubbleToObject?: boolean}

export type IGeometryEventMap = BufferGeometryEventMap

declare module 'three'{
    export interface BufferGeometryEventMap{
        geometryUpdate: {
            geometry: IGeometry
            bubbleToObject?: boolean
        } & IGeometrySetDirtyOptions
    }
}
