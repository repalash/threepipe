import {
    ColorSpace,
    EventDispatcher,
    MagnificationTextureFilter,
    MinificationTextureFilter,
    Texture,
    TextureDataType,
} from 'three'
import {Vector4} from 'three/src/math/Vector4'
import {DepthTexture} from 'three/src/textures/DepthTexture'

export interface IRenderTarget extends EventDispatcher {
    isWebGLRenderTarget: boolean
    width: number
    height: number
    depth: number

    texture: Texture | Texture[]
    uuid?: string
    sizeMultiplier?: number
    isTemporary?: boolean
    targetKey?: string // for caching.
    clone(trackTarget?: boolean): this
    setSize(width: number, height: number, depth?: number): void;
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
    textureCount?: number
}

export function createRenderTargetKey(op: CreateRenderTargetOptions = {}): string {
    // colorSpace is in key because of ext_sRGB
    return [op.sizeMultiplier, op.samples, op.colorSpace, op.type, op.format, op.depthBuffer, op.depthTexture, op.textureCount, op.size?.width, op.size?.height].join(';')
}
