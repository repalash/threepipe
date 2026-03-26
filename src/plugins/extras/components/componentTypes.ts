import {IViewerPlugin, ThreeViewer} from '../../../viewer'
import type {EntityComponentPlugin} from '../EntityComponentPlugin'
import {Class} from 'ts-browser-helpers'
import {TypedType} from './typeSystem'
import {UiObjectConfig} from 'uiconfig.js'

export interface ComponentCtx {
    viewer: ThreeViewer
    ecp: EntityComponentPlugin
    // object: IObject3D
    // throws error if the plugin is not found instead of returning undefined
    plugin: <T extends IViewerPlugin>(type: Class<T> | string) => T
    // component: <T extends TObject3DComponent>(type: T | string) => InstanceType<T>
}

// export class CtxProxy {
//     isCtxProxy = true
//     // todo when env is set, loop through all properties and set env if they are EnvProxy too
//     ctx?: ComponentCtx
//     constructor(ctx?: ComponentCtx) {
//         this.ctx = ctx
//     }
// }

export interface StatePropConfig<T = any> {
    key: string
    label?: string
    type?: TypedType
    default?: T
    uiConfig?: Partial<UiObjectConfig>
    // description?: string
}

export interface ComponentDefn {ComponentType: string, StateProperties?: (string|StatePropConfig)[]}

export interface ComponentJSON{
    type: string
    state: Record<string, any>
}

/**
 * Sample usage -
 * ```typescript
 * export const physicsBodyType = ['static', 'dynamic', 'kinematic'] as const
 * export type PhysicsBodyType = typeof physicsBodyType[number]
 * export class PhysicsComponent extends Object3DComponent {
 *     static ComponentType = 'PhysicsComponent'
 *     static StateProperties: ComponentDefn['StateProperties'] = ['mass', {
 *         key: 'type',
 *         type: literalStrings(physicsBodyType),
 *     }]
 *     // ...
 * }
 * ```
 * @param type
 */
export function literalStrings<T extends string|number|boolean = string|number|boolean>(type: T[] | readonly T[]) {
    return {oneOf: type.map(t=>typeof t === 'number' || typeof t === 'boolean' ? `${t}` : `"${t}"`) as (`"${T}"`)[], type: 'Union'} as const
}
