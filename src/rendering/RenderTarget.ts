import {
    ColorSpace,
    DepthFormat,
    DepthStencilFormat,
    EventDispatcher,
    FloatType,
    MagnificationTextureFilter,
    MinificationTextureFilter,
    Texture,
    TextureDataType,
    UnsignedInt248Type,
    UnsignedIntType,
    UnsignedShortType,
    Wrapping,
} from 'three'
import {Vector4} from 'three/src/math/Vector4'
import {DepthTexture} from 'three/src/textures/DepthTexture'
import type {IRenderManager} from '../core'
import {ValOrArr} from 'ts-browser-helpers'

export interface IRenderTarget extends EventDispatcher {
    isWebGLRenderTarget: boolean
    width: number
    height: number
    depth: number
    assetType?: 'renderTarget'
    name?: string

    texture: ValOrArr<Texture&{_target?: IRenderTarget}>
    uuid?: string
    sizeMultiplier?: number
    isTemporary?: boolean
    targetKey?: string // for caching.
    clone(trackTarget?: boolean): this
    setSize(width: number, height: number, depth?: number): void;
    copy(source: IRenderTarget): this;
    dispose(): void;

    scissor: Vector4;
    /**
     * @default false
     */
    scissorTest: boolean;
    viewport: Vector4;

    /**
     * @default true
     */
    depthBuffer: boolean;

    /**
     * @default true
     */
    stencilBuffer: boolean;

    /**
     * @default null
     */
    depthTexture: DepthTexture;
    /**
     * Defines the count of MSAA samples. Can only be used with WebGL 2. Default is **0**.
     * @default 0
     */
    samples: number;

    isWebGLCubeRenderTarget?: boolean
    isWebGLMultipleRenderTargets?: boolean

    readonly renderManager?: IRenderManager
}

export interface CreateRenderTargetOptions {
    sizeMultiplier?: number,
    size?: {width: number, height: number},
    generateMipmaps?: boolean,
    samples?: number,
    minFilter?: MinificationTextureFilter
    magFilter?: MagnificationTextureFilter
    colorSpace?: ColorSpace
    type?: TextureDataType
    format?: number
    depthBuffer?: boolean
    depthTexture?: boolean
    depthTextureType?: typeof UnsignedShortType | typeof UnsignedInt248Type | typeof UnsignedIntType | typeof FloatType
    depthTextureFormat?: typeof DepthFormat | typeof DepthStencilFormat
    textureCount?: number
    wrapS?: Wrapping
    wrapT?: Wrapping
}

export function createRenderTargetKey(op: CreateRenderTargetOptions = {}): string {
    // colorSpace is in key because of ext_sRGB
    return [op.sizeMultiplier, op.samples, op.colorSpace, op.type, op.format, op.depthBuffer, op.depthTexture, op.textureCount, op.size?.width, op.size?.height].join(';')
}
