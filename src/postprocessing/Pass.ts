import {IDisposable, ValOrFunc} from 'ts-browser-helpers'
import {IUniform} from 'three'
import {Pass} from 'three/examples/jsm/postprocessing/Pass.js'
import {MaterialExtension} from '../materials'
import {ICamera, IRenderManager, IScene} from '../core'

export type IPassID = 'render' | 'screen' | string

export interface IPass<Tid extends IPassID = IPassID> extends Pass, IDisposable {
    uniforms?: {[name: string]: IUniform}

    // todo?
    // updateShaderProperties?: (updater?: (IShaderPropertiesUpdater|undefined) | (IShaderPropertiesUpdater|undefined)[])=>void

    materialExtension?: MaterialExtension

    /**
     * Checked by {@link RenderManager} to determine whether to render this frame. A frame is rendered if any pass is dirty.
     * This can be set by the plugin/pass to indicate when to continue rendering. See {@link ProgressivePlugin}.
     * This is different from {@link setDirty} which is implementation specific to the pass/plugin. It generally calls onDirty and set the viewer dirty.
     */
    dirty?: ValOrFunc<boolean> // isDirty (optional)

    /**
     * Set the pass as dirty. This is implementation specific to the pass/plugin. It generally calls all {@link onDirty} and set the viewer dirty.
     */
    setDirty?(): void
    onDirty?: (()=>void)[];

    /**
     * Unique id for the pass. Used to determine the order of passes in the pipeline.
     */
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
