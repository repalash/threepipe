import {Mesh} from 'three'
import {IObject3D, IObject3DUserData} from '../IObject'
import {iObjectCommons} from './iObjectCommons'
import {IMaterial} from '../IMaterial'
import {IGeometry} from '../IGeometry'
import {ILightEvent} from '../light/ILight'

export class Mesh2<
    TGeometry extends IGeometry = IGeometry,
    TMaterial extends IMaterial | IMaterial[] = IMaterial | IMaterial[]
> extends Mesh<TGeometry, TMaterial> implements IObject3D {
    assetType = 'model' as const
    setDirty = iObjectCommons.setDirty
    refreshUi = iObjectCommons.refreshUi

    material: TMaterial
    readonly materials: IMaterial[]
    geometry: TGeometry

    /**
     * @deprecated use `this` instead
     */
    get modelObject(): this {
        return this
    }

    constructor(geometry?: TGeometry, material?: TMaterial) {
        super(geometry, material)
        iObjectCommons.upgradeObject3D.call(this)
    }

    userData: IObject3DUserData

    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse: (callback: (object: IObject3D) => void) => void
    traverseVisible: (callback: (object: IObject3D) => void) => void
    traverseAncestors: (callback: (object: IObject3D) => void) => void
    getObjectById: <T extends IObject3D = IObject3D>(id: number) => T | undefined
    getObjectByName: <T extends IObject3D = IObject3D>(name: string) => T | undefined
    getObjectByProperty: <T extends IObject3D = IObject3D>(name: string, value: string) => T | undefined
    copy: (source: Mesh2|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ILightEvent) => void
    parent: null
    children: IObject3D[]
    dispose: (removeFromParent?: boolean) => void

    // endregion

}
