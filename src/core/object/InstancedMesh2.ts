import {InstancedMesh} from 'three'
import {IObject3D, IObject3DEventMap, IObject3DUserData} from '../IObject'
import {iObjectCommons} from './iObjectCommons'
import {IMaterial} from '../IMaterial'
import {IGeometry} from '../IGeometry'

export class InstancedMesh2<
    TGeometry extends IGeometry = IGeometry,
    TMaterial extends IMaterial | IMaterial[] = IMaterial | IMaterial[],
    TE extends IObject3DEventMap = IObject3DEventMap
> extends InstancedMesh<TGeometry, TMaterial, TE> implements IObject3D<TE, TGeometry, TMaterial> {
    assetType = 'model' as const
    setDirty = iObjectCommons.setDirty
    refreshUi = iObjectCommons.refreshUi

    declare material: TMaterial
    declare readonly materials: IMaterial[]
    declare geometry: TGeometry

    /**
     * @deprecated use `this` instead
     */
    get modelObject(): this {
        return this
    }

    constructor(geometry?: TGeometry, material?: TMaterial, count = 1) {
        super(geometry, material, count)
        iObjectCommons.upgradeObject3D.call(this)
    }

    declare userData: IObject3DUserData

    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    declare traverse: (callback: (object: IObject3D) => void) => void
    declare traverseVisible: (callback: (object: IObject3D) => void) => void
    declare traverseAncestors: (callback: (object: IObject3D) => void) => void
    declare getObjectById: (id: number) => IObject3D | undefined
    declare getObjectByName: (name: string) => IObject3D | undefined
    declare getObjectByProperty: (name: string, value: string) => IObject3D | undefined
    declare parent: IObject3D | null
    declare children: IObject3D[]
    dispose: (removeFromParent?: boolean) => this

    // endregion

}

