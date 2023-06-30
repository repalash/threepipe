import {IDisposable, PartialRecord} from 'ts-browser-helpers'
import {Clock, Event, ShaderMaterial, Texture, Vector2, Vector4, WebGLRenderer, WebGLRenderTarget} from 'three'
import {CreateRenderTargetOptions, IRenderTarget} from '../rendering/RenderTarget'
import {IShaderPropertiesUpdater} from '../materials/MaterialExtension'
import {IPassID, IPipelinePass} from '../postprocessing/Pass'
import {EffectComposer2} from '../postprocessing/EffectComposer2'
import {RenderTargetManager} from '../rendering/RenderTargetManager'
import {IScene} from './IScene'
import {BlobExt} from '../assetmanager'

export type TThreeRendererMode = 'shadowMapRender' | 'backgroundRender' | 'sceneRender' | 'opaqueRender' | 'transparentRender' | 'transmissionRender' | 'mainRenderPass' | 'screenSpaceRendering'
export type TThreeRendererModeUserData = PartialRecord<TThreeRendererMode, boolean>

export interface IAnimationLoopEvent extends Event{
    renderer: IWebGLRenderer
    deltaTime: number
    time: number
    xrFrame?: XRFrame
}
export interface IRenderManagerUpdateEvent extends Event{
    change: 'registerPass' | 'unregisterPass' | 'useLegacyLights' | 'passRefresh' | 'size' | 'rebuild' | string
    data: any
    pass: IPipelinePass
}
export type IRenderManagerEvent = Partial<IAnimationLoopEvent>&Partial<IRenderManagerUpdateEvent>&Event & {

    [key: string]: any
}
export type IRenderManagerEventTypes = 'animationLoop'|'update'|'resize'|'contextLost'|'contextRestored'
export interface IRenderManager<E extends IRenderManagerEvent = IRenderManagerEvent, ET extends string = IRenderManagerEventTypes> extends RenderTargetManager<E, ET>, IDisposable, IShaderPropertiesUpdater{
    readonly renderer: IWebGLRenderer
    readonly needsRender: boolean
    rebuildPipeline(setDirty?: boolean): void
    setSize(width: number, height: number): void

    render(scene: IScene): void
    reset(): void
    resetShadows(): void
    refreshPasses(): void

    registerPass(pass: IPipelinePass, replaceId?: boolean): void
    unregisterPass(pass: IPipelinePass): void
    readonly frameCount: number
    readonly totalFrameCount: number
    pipeline: IPassID[]
    composer: EffectComposer2
    readonly passes: IPipelinePass[]
    readonly isWebGL2: boolean
    readonly composerTarget: IRenderTarget
    readonly renderSize: Vector2
    renderScale: number
    readonly context: WebGLRenderingContext
    useLegacyLights: boolean
    webglRenderer: WebGLRenderer
    clock: Clock

    blit(destination: IRenderTarget|undefined|null, options?: {source?: Texture, viewport?: Vector4, material?: ShaderMaterial, clear?: boolean}): void
    clearColor({r, g, b, a, target, depth = true, stencil = true, viewport}:
                   {r?: number, g?: number, b?: number, a?: number, target?: IRenderTarget, depth?: boolean, stencil?: boolean, viewport?: Vector4}): void

    renderTargetToDataUrl(target: WebGLRenderTarget, mimeType?: string, quality?: number): string

    renderTargetToBuffer(target: WebGLRenderTarget): Uint8Array|Uint16Array|Float32Array

    exportRenderTarget(target: WebGLRenderTarget, mimeType?: 'auto'|string): BlobExt
}

export interface IRenderManagerOptions {
    canvas: HTMLCanvasElement,
    alpha?: boolean, // default = true
    targetOptions?: CreateRenderTargetOptions
    rgbm?: boolean,
    msaa?: boolean,
    depthBuffer?: boolean,
}

export interface IWebGLRenderer<TManager extends IRenderManager=IRenderManager> extends WebGLRenderer {
    renderManager: TManager
    userData: TThreeRendererModeUserData & {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __isIWebGLRenderer: true
        [key: string]: any
    }
    renderWithModes(ud: TThreeRendererModeUserData, render: ()=>void): void

    // legacy

    /**
     * @deprecated use {@link renderManager} instead
     */
    baseRenderer?: IRenderManager
}

export function upgradeWebGLRenderer<TManager extends IRenderManager=IRenderManager>(this: IWebGLRenderer<TManager>, manager: TManager): IWebGLRenderer<TManager> {
    if (this.userData?.__isIWebGLRenderer) return this
    // eslint-disable-next-line @typescript-eslint/naming-convention
    if (!this.userData) this.userData = {__isIWebGLRenderer: true}
    this.userData.__isIWebGLRenderer = true
    if (!this.renderWithModes) this.renderWithModes = renderWithModes
    this.renderManager = manager

    // legacy
    if (!this.baseRenderer) {
        Object.defineProperty(this, 'baseRenderer', {
            get: ()=>{
                console.warn('IWebGLRenderer.baseRenderer is deprecated, use IWebGLRenderer.renderManager instead')
                return this.renderManager
            },
        })
    }
    return this
}


function renderWithModes(this: IWebGLRenderer, ud: TThreeRendererModeUserData, render: ()=>void) {
    const rud = this.userData
    const {backgroundRender, transparentRender, shadowMapRender, mainRenderPass, opaqueRender, transmissionRender, sceneRender, screenSpaceRendering} = rud

    if (ud.backgroundRender !== undefined) rud.backgroundRender = ud.backgroundRender
    if (ud.transparentRender !== undefined) rud.transparentRender = ud.transparentRender
    if (ud.shadowMapRender !== undefined) rud.shadowMapRender = ud.shadowMapRender
    if (ud.mainRenderPass !== undefined) rud.mainRenderPass = ud.mainRenderPass
    if (ud.opaqueRender !== undefined) rud.opaqueRender = ud.opaqueRender
    if (ud.sceneRender !== undefined) rud.sceneRender = ud.sceneRender
    if (ud.transmissionRender !== undefined) rud.transmissionRender = ud.transmissionRender
    if (ud.screenSpaceRendering !== undefined) rud.screenSpaceRendering = ud.screenSpaceRendering

    render()

    rud.backgroundRender = backgroundRender
    rud.transparentRender = transparentRender
    rud.shadowMapRender = shadowMapRender
    rud.mainRenderPass = mainRenderPass
    rud.opaqueRender = opaqueRender
    rud.sceneRender = sceneRender
    rud.transmissionRender = transmissionRender
    rud.screenSpaceRendering = screenSpaceRendering

}

/**
 * @deprecated renamed to {@link renderWithModes}, use {@link IWebGLRenderer.renderWithModes}
 */
export const setThreeRendererMode = renderWithModes
