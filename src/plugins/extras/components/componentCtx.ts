import {IViewerPlugin, ThreeViewer} from '../../../viewer'
import type {EntityComponentPlugin} from '../EntityComponentPlugin'
import {Class} from 'ts-browser-helpers'

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
