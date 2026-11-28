import type {DataTexture, Data3DTexture} from 'threepipe'

/**
 * How the lighting fields ({@link LightVolume}, {@link AmbientOcclusionVolume}) find the opacity of the volume:
 * as the material does, from the transfer function, or, for `iso`, as an opaque solid above the iso value.
 */
export interface VolumeOpacityParams {
    /**
     * The texture of the field.
     */
    source: Data3DTexture
    /**
     * The baked transfer function.
     */
    transferTexture: DataTexture
    /**
     * Texture value to transfer function coordinate: `t * valueMap[0] + valueMap[1]`.
     */
    valueMap: [number, number]
    /**
     * `transfer`: the opacity of the transfer function. `iso`: opaque above {@link iso}, as a surface seen from outside.
     */
    mode: 'transfer' | 'iso'
    /**
     * Iso value on the transfer function coordinate.
     */
    iso: number
    /**
     * Opacity multiplier, as {@link VolumeMaterial.density}.
     */
    density: number
    /**
     * Length of one texel of the source texture along x, y, z, in opacity unit distances
     * ({@link VolumeMaterial.opacityUnitDistance}): the transfer function opacity is for one unit.
     */
    unitScale: [number, number, number]
}

export function opacityParamsKey(p: VolumeOpacityParams) {
    return [p.source.uuid, p.source.version, p.transferTexture.uuid, p.transferTexture.version, p.valueMap[0], p.valueMap[1], p.mode,
        p.mode === 'iso' ? p.iso : '', p.density, p.unitScale.join('x')].join(',')
}

/**
 * GLSL for the kernels: `volOpacity(uvw)`, the opacity at a texture coordinate (per opacity unit distance), and
 * `volTransmittance(alpha, units)`, what passes through a segment `units` opacity unit distances long with it.
 */
export const opacityKernelGLSL = `
uniform sampler3D uSource;
uniform sampler2D uTransfer;
uniform vec2 uValueMap;
uniform int uOpacityMode;   // 0 transfer function, 1 solid above the iso value
uniform float uIso;
uniform float uDensity;
float volOpacity(vec3 uvw) {
    float v = texture(uSource, uvw).r * uValueMap.x + uValueMap.y;
    if (uOpacityMode == 1) return smoothstep(uIso - 0.005, uIso + 0.005, v);
    // at the texel positions the material uses (TransferFunction.bake)
    float w = float(textureSize(uTransfer, 0).x);
    return texture(uTransfer, vec2((clamp(v, 0.0, 1.0) * (w - 1.0) + 0.5) / w, 0.5)).a;
}
float volTransmittance(float alpha, float units) {
    return pow(max(1.0 - alpha, 0.0), uDensity * units);
}
`

export function opacityUniforms() {
    return {
        uSource: {value: null},
        uTransfer: {value: null},
        uValueMap: {value: [1, 0]},
        uOpacityMode: {value: 0},
        uIso: {value: 0.5},
        uDensity: {value: 1},
    }
}

export function setOpacityUniforms(uniforms: Record<string, {value: any}>, p: VolumeOpacityParams) {
    uniforms.uSource.value = p.source
    uniforms.uTransfer.value = p.transferTexture
    uniforms.uValueMap.value = p.valueMap
    uniforms.uOpacityMode.value = p.mode === 'iso' ? 1 : 0
    uniforms.uIso.value = p.iso
    uniforms.uDensity.value = p.density
}
