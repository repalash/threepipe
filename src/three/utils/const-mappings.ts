import {
    AdditiveBlending,
    AnyMapping,
    BasicDepthPacking,
    Blending,
    ByteType,
    ColorSpace,
    CubeReflectionMapping,
    CubeUVReflectionMapping,
    CustomBlending,
    DepthPackingStrategies,
    DisplayP3ColorSpace,
    EquirectangularReflectionMapping,
    FloatType,
    HalfFloatType,
    IntType,
    LinearSRGBColorSpace,
    MultiplyBlending,
    NoBlending,
    NormalBlending,
    RGBADepthPacking,
    RGBM16ColorSpace,
    ShortType,
    SRGBColorSpace,
    SubtractiveBlending,
    TextureDataType,
    UnsignedByteType,
    UnsignedInt248Type,
    UnsignedIntType,
    UnsignedShort4444Type,
    UnsignedShort5551Type,
    UnsignedShortType,
    UVMapping,
} from 'three'
import {UiObjectConfig} from 'uiconfig.js'

const blending: Record<string, Blending> = {
    None: NoBlending,
    Normal: NormalBlending,
    Additive: AdditiveBlending,
    Subtractive: SubtractiveBlending,
    Multiply: MultiplyBlending,
    Custom: CustomBlending,
}

const mapping: Record<string, AnyMapping> = {
    UV: UVMapping,
    Cube: CubeReflectionMapping,
    // CubeRefraction: CubeRefractionMapping,
    CubeUV: CubeUVReflectionMapping,
    Equirectangular: EquirectangularReflectionMapping,
    // EquirectangularRefraction: EquirectangularRefractionMapping,
}

const colorSpace: Record<string, ColorSpace> = {
    None: '',
    SRGB: SRGBColorSpace,
    LinearSRGB: LinearSRGBColorSpace,
    RGBM16: RGBM16ColorSpace,
    DisplayP3: DisplayP3ColorSpace,
}

const textureDataType: Record<string, TextureDataType> = {
    UnsignedByte: UnsignedByteType,
    Byte: ByteType,
    Short: ShortType,
    UnsignedShort: UnsignedShortType,
    Int: IntType,
    UnsignedInt: UnsignedIntType,
    Float: FloatType,
    HalfFloat: HalfFloatType,
    UnsignedShort4444: UnsignedShort4444Type,
    UnsignedShort5551: UnsignedShort5551Type,
    UnsignedInt248: UnsignedInt248Type,
}

const depthPackingStrategies: Record<string, DepthPackingStrategies> = {
    Basic: BasicDepthPacking,
    RGBADepthPacking: RGBADepthPacking,
}

function makeMapping<T extends string|number|symbol>(a: Record<string, T>) {
    return {
        map: a,
        inv: Object.fromEntries(Object.entries(a).map(([k, v]) => [v, k])) as Record<T, string>,
        uiConfig: Object.entries(a).map(([k, v]) => ({label: k, value: v})) as UiObjectConfig[],
    } as const
}
export const threeConstMappings = {
    Blending: makeMapping(blending),
    AnyMapping: makeMapping(mapping),
    ColorSpace: makeMapping(colorSpace),
    TextureDataType: makeMapping(textureDataType),
    DepthPackingStrategies: makeMapping(depthPackingStrategies),
} as const
