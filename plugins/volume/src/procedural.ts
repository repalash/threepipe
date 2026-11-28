import {FloatType, RGBAFormat, UnsignedByteType, WebGLRenderer, WebGLRenderTarget} from 'threepipe'
import {VolumeKernel} from './derived/VolumeKernel'
import {VolumeData} from './VolumeData'

/**
 * GLSL noise functions for procedural volumes, all over a position in any units:
 * - `float volHash(vec3 p)`: a random number in 0..1 for each integer cell (hash without sine, Dave Hoskins, MIT).
 * - `float volValueNoise(vec3 p)`: smooth value noise in 0..1.
 * - `float volFbm(vec3 p, int octaves)`: fractal sum of value noise, about 0..1.
 * - `float volWorley(vec3 p)`: distance to the nearest random point of the cells around, about 0..1 (cellular noise).
 * - `vec3 volWarp(vec3 p, float amount)`: a position moved by noise, for swirling shapes (domain warping).
 */
export const volumeNoiseGLSL = /* glsl */`
float volHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
vec3 volHash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}
float volValueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(volHash(i), volHash(i + vec3(1, 0, 0)), u.x),
                   mix(volHash(i + vec3(0, 1, 0)), volHash(i + vec3(1, 1, 0)), u.x), u.y),
               mix(mix(volHash(i + vec3(0, 0, 1)), volHash(i + vec3(1, 0, 1)), u.x),
                   mix(volHash(i + vec3(0, 1, 1)), volHash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float volFbm(vec3 p, int octaves) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 10; i++) {
        if (i >= octaves) break;
        sum += amp * volValueNoise(p);
        norm += amp;
        p = p * 2.03 + vec3(17.1, 31.7, 7.3);
        amp *= 0.5;
    }
    return sum / norm;
}
float volWorley(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d = 1.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(x, y, z);
        vec3 r = o + volHash3(i + o) - f;
        d = min(d, dot(r, r));
    }
    return sqrt(d);
}
vec3 volWarp(vec3 p, float amount) {
    return p + amount * (vec3(volFbm(p + 1.7, 3), volFbm(p + 9.2, 3), volFbm(p + 4.1, 3)) - 0.5);
}
`

export interface ProceduralVolumeOptions {
    /**
     * Voxel counts along x, y, z.
     */
    size: [number, number, number]
    /**
     * GLSL that defines `float density(vec3 p)`, with `p` from 0 to 1 over the volume (voxel centres). The value is
     * stored in 0..1. {@link volumeNoiseGLSL} is available, and the uniforms of {@link uniforms}.
     */
    glsl: string
    uniforms?: Record<string, {value: any}>
    /**
     * `uint8` (default): 1 byte per voxel. `float`: 32-bit values, when the GPU can render floats
     * (`EXT_color_buffer_float`), else bytes.
     */
    precision?: 'uint8' | 'float'
    name?: string
    spacing?: [number, number, number]
    units?: string
}

/**
 * Makes a volume on the GPU: runs `density(p)` for every voxel, one z layer per draw, and reads the layers back into a
 * {@link VolumeData} (so it can be saved, sliced and processed like loaded data). A 256³ volume takes a fraction of a
 * second, against seconds for the same noise in JavaScript.
 *
 * ```ts
 * const cloud = generateVolume(viewer.renderManager.webglRenderer, {
 *     size: [192, 96, 192],
 *     glsl: `float density(vec3 p) { return smoothstep(0.45, 0.7, volFbm(p * 6.0, 5)) * smoothstep(0.0, 0.2, p.y); }`,
 * })
 * viewer.scene.addObject(new VolumeObject(cloud))
 * ```
 *
 * @category Procedural
 */
export function generateVolume(renderer: WebGLRenderer, options: ProceduralVolumeOptions): VolumeData {
    const [nx, ny, nz] = options.size.map(s => Math.max(1, Math.floor(s)))
    const float = options.precision === 'float' && renderer.extensions.has('EXT_color_buffer_float')
    const target = new WebGLRenderTarget(nx, ny, {format: RGBAFormat, type: float ? FloatType : UnsignedByteType, depthBuffer: false, generateMipmaps: false})
    const kernel = new VolumeKernel({
        name: 'VolumeProcedural',
        fragment: `
uniform float uZ;
uniform vec3 uSize;
${volumeNoiseGLSL}
${options.glsl}
vec4 kernel(ivec3 v) {
    vec3 p = (vec3(float(v.x), float(v.y), uZ) + 0.5) / uSize;
    return vec4(clamp(density(p), 0.0, 1.0));
}
`,
        uniforms: {uZ: {value: 0}, uSize: {value: [nx, ny, nz]}, ...options.uniforms},
    })
    const layer = nx * ny
    const data = float ? new Float32Array(layer * nz) : new Uint8Array(layer * nz)
    const pixels = float ? new Float32Array(layer * 4) : new Uint8Array(layer * 4)
    try {
        for (let z = 0; z < nz; z++) {
            kernel.uniforms.uZ.value = z
            kernel.run(renderer, target, 0, 1)
            renderer.readRenderTargetPixels(target, 0, 0, nx, ny, pixels)
            const o = z * layer
            for (let i = 0; i < layer; i++) data[o + i] = pixels[i * 4]
        }
    } finally {
        kernel.dispose()
        target.dispose()
    }
    return new VolumeData({
        data,
        size: [nx, ny, nz],
        spacing: options.spacing ?? [1, 1, 1],
        units: options.units ?? 'mm',
        name: options.name ?? 'density',
        valueRange: float ? [0, 1] : [0, 255],
    })
}
