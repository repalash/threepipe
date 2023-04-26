import {
    ColorSpace,
    EventDispatcher,
    MagnificationTextureFilter,
    MinificationTextureFilter,
    Texture,
    TextureDataType,
} from 'three'

export interface IRenderTarget extends EventDispatcher {
    texture: Texture | Texture[]
    sizeMultiplier?: number
    isTemporary?: boolean
    targetKey?: string // for caching.
    clone(trackTarget?: boolean): this
    setSize(width: number, height: number, depth?: number): void;
    dispose(): void;
    samples: number
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
    return [op.sizeMultiplier, op.samples, op.colorSpace, op.type, op.format, op.depthBuffer, op.depthTexture, op.size?.width, op.size?.height].join(';')
}
