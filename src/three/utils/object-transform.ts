import {Object3D} from 'three'
import {iObjectCommons} from '../../core'

/**
 * @deprecated use {@link IObject3D.autoCenter} instead, or {@link iObjectCommons.autoCenter}
 * @param obj
 */
export function autoCenterObject3D(obj: Object3D) {
    return iObjectCommons.autoCenter.call(obj)
}

/**
 * @deprecated use {@link IObject3D.autoScale} instead, or {@link iObjectCommons.autoScale}
 * @param obj
 * @param autoScaleRadius
 * @param isCentered
 * @param setDirty
 */
export function autoScaleObject3D(obj: Object3D, autoScaleRadius?: number, isCentered?: boolean, setDirty?: boolean) {
    return iObjectCommons.autoScale.call(obj, autoScaleRadius, isCentered, setDirty)
}
