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
    /**
     * Unique id for the pass. Used to determine the order of passes in the pipeline.
     */
    readonly passId: Tid
    /**
     * Passes that should run before this pass
     */
    after?: IPassID[]
    /**
     * Passes that should run after this pass
     */
    before?: IPassID[]
    /**
     * Passes that are required to be present in the pipeline to run this pass.
     */
    required?: IPassID[]

    /**
     * This function gets called at the beginning of every frame where this pass would be enabled.
     * @param scene
     * @param camera
     * @param renderManager
     */
    beforeRender?(scene: IScene, camera: ICamera, renderManager: IRenderManager): void;

    /**
     * Callback when the pass is registered with the render manager
     * @param renderer
     */
    onRegister?(renderer: IRenderManager): void;

    /**
     * Callback when the pass is unregistered with the render manager
     * @param renderer
     */
    onUnregister?(renderer: IRenderManager): void;

    /**
     * This function gets called at the end of every frame where this pass would be enabled.
     * @param renderManager
     */
    onPostFrame?(renderManager: IRenderManager): void;

}
