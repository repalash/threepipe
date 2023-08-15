import {IDisposable} from 'ts-browser-helpers'
import {IUniform} from 'three'
import {Pass} from 'three/examples/jsm/postprocessing/Pass.js'
import {IShaderPropertiesUpdater, MaterialExtension} from '../materials'
import {ICamera, IRenderManager, IScene} from '../core'

export type IPassID = 'render' | 'screen' | string

export interface IPass<Tid extends IPassID = IPassID> extends Pass, IDisposable {
    uniforms?: {[name: string]: IUniform}

    updateShaderProperties?: (updater?: (IShaderPropertiesUpdater|undefined) | (IShaderPropertiesUpdater|undefined)[])=>void
    materialExtension?: MaterialExtension

    dirty?: boolean // isDirty (optional)
    setDirty?(): void
    onDirty?: (()=>void)[];

    passId?: Tid;
}

export interface IPipelinePass<Tid extends IPassID = IPassID> extends IPass<Tid> {
    readonly passId: Tid
    after?: IPassID[]
    before?: IPassID[]
    required?: IPassID[]

    beforeRender?(scene: IScene, camera: ICamera, renderManager: IRenderManager): void;

    onRegister?(renderer: IRenderManager): void;
    onUnregister?(renderer: IRenderManager): void;

    onPostFrame?(renderManager: IRenderManager): void;

}
