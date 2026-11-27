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
     * Opacity multiplier, as {@link VolumeMaterial.density}: the opacity of the transfer function is per voxel at 1.
     */
    density: number
}

export function opacityParamsKey(p: VolumeOpacityParams) {
    return [p.source.uuid, p.source.version, p.transferTexture.uuid, p.transferTexture.version, p.valueMap[0], p.valueMap[1], p.mode,
        p.mode === 'iso' ? p.iso : '', p.density].join(',')
}

/**
 * GLSL for the kernels: `volOpacity(uvw)`, the opacity of one voxel at a texture coordinate, and
 * `volTransmittance(alpha, voxels)`, what passes through a segment `voxels` long with that opacity.
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
    return texture(uTransfer, vec2(clamp(v, 0.0, 1.0), 0.5)).a;
}
float volTransmittance(float alpha, float voxels) {
    return pow(max(1.0 - alpha, 0.0), uDensity * voxels);
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
