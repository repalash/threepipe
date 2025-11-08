import {LineGeometry2} from '../geometry/LineGeometry2'
import {LineMaterial2} from '../material/LineMaterial2'
import {IObject3D, IObject3DEventMap, IObject3DUserData} from '../IObject'
import {Line2} from 'three/examples/jsm/lines/Line2.js'
import {iObjectCommons} from './iObjectCommons'
import {IMaterial} from '../IMaterial'
import {UiObjectConfig} from 'uiconfig.js'

export class MeshLine<
    TGeometry extends LineGeometry2 = LineGeometry2,
    TMaterial extends LineMaterial2 = LineMaterial2,
    TE extends IObject3DEventMap = IObject3DEventMap
> extends Line2<TGeometry, TMaterial, TE> implements IObject3D<TE, TGeometry, TMaterial> {
    assetType = 'model' as const
    setDirty = iObjectCommons.setDirty
    refreshUi = iObjectCommons.refreshUi
    public readonly isMeshLine = true

    declare material: TMaterial
    declare readonly materials: IMaterial[]
    declare geometry: TGeometry
    declare uiConfig: UiObjectConfig

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
    dispose: (removeFromParent?: boolean) => void

    // endregion

}

