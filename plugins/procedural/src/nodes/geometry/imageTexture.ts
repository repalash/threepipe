/**
 * Image Texture (`GeometryNodeImageTexture`) - `nodes/geometry/nodes/node_geo_image_texture.cc`
 * (declaration :23-39, init :47-53, `ImageFieldsFunction` :55-389, exec :391-433).
 *
 * The image is the host's {@link SceneImage}: Blender's float buffer (`ImBuf::float_buffer`, RGBA, rows from the
 * bottom). Byte images are converted by `IMB_float_from_byte` (:89-96, colour managed) before sampling, which is not
 * ported: hosts hand float buffers.
 */

import {f32} from '../../blender/f32'
import {MultiFunction} from '../../fields'
import {registerNodeType} from '../../runtime/registry'
import type {SceneImage} from '../../runtime/context'
import {applyFunction} from '../util'

type Extension = 'REPEAT' | 'EXTEND' | 'CLIP' | 'MIRROR'

const SIXTH = f32(1 / 6)
const NEG_SIXTH = f32(-1 / 6)
const TWO_THIRDS = f32(2 / 3)

/** `wrap_periodic` (:109). */
function wrapPeriodic(x: number, width: number): number {
    x %= width
    if (x < 0) x += width
    return x
}

/** `wrap_clamp` (:118): `std::clamp(x, 0, width - 1)`. */
const wrapClamp = (x: number, width: number) => (x < 0 ? 0 : width - 1 < x ? width - 1 : x)

/** `wrap_mirror` (:123). */
function wrapMirror(x: number, width: number): number {
    const m = Math.abs(x + (x < 0 ? 1 : 0)) % (2 * width)
    if (m >= width) return 2 * width - m - 1
    return m
}

/** `frac` (:140): `int(x) - (x < 0 ? 1 : 0)` and `x - float(i)`. */
function frac(x: number): [number, number] {
    const i = Math.trunc(x) - (x < 0 ? 1 : 0)
    return [f32(x - i), i]
}

/** Accumulates `w * image_pixel_lookup(...)` terms of :220-235 / :280-283 in Blender's operation order. */
class Sampler {
    constructor(readonly image: SceneImage) {}

    /** `image_pixel_lookup` (:132): zero outside the image. */
    pixel(px: number, py: number, out: number[], o: number): void {
        const {width, height, pixels} = this.image
        if (px < 0 || py < 0 || px >= width || py >= height) {
            out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
            return
        }
        const k = (px + py * width) * 4
        out[o] = pixels[k]; out[o + 1] = pixels[k + 1]; out[o + 2] = pixels[k + 2]; out[o + 3] = pixels[k + 3]
    }

    /** `image_linear_texture_lookup` (:238). */
    linear(px: number, py: number, extension: Extension, out: number[]): void {
        const {width, height} = this.image
        const [nfx, pix0] = frac(f32(f32(px * width) - 0.5))
        const [nfy, piy0] = frac(f32(f32(py * height) - 0.5))
        let pix = pix0, piy = piy0
        let nix: number, niy: number
        switch (extension) {
        case 'CLIP':
            nix = pix + 1
            niy = piy + 1
            break
        case 'EXTEND':
            nix = wrapClamp(pix + 1, width)
            niy = wrapClamp(piy + 1, height)
            pix = wrapClamp(pix, width)
            piy = wrapClamp(piy, height)
            break
        case 'MIRROR':
            nix = wrapMirror(pix + 1, width)
            niy = wrapMirror(piy + 1, height)
            pix = wrapMirror(pix, width)
            piy = wrapMirror(piy, height)
            break
        default:
            pix = wrapPeriodic(pix, width)
            piy = wrapPeriodic(piy, height)
            nix = wrapPeriodic(pix + 1, width)
            niy = wrapPeriodic(piy + 1, height)
            break
        }
        const ptx = f32(1 - nfx)
        const pty = f32(1 - nfy)
        const p = this.tmp
        this.pixel(pix, piy, p, 0)
        this.pixel(nix, piy, p, 4)
        this.pixel(pix, niy, p, 8)
        this.pixel(nix, niy, p, 12)
        // `a * ptx * pty + b * nfx * pty + c * ptx * nfy + d * nfx * nfy`, per component, left to right.
        for (let c = 0; c < 4; c++) {
            const a = f32(f32(p[c] * ptx) * pty)
            const b = f32(f32(p[4 + c] * nfx) * pty)
            const d = f32(f32(p[8 + c] * ptx) * nfy)
            const e = f32(f32(p[12 + c] * nfx) * nfy)
            out[c] = f32(f32(f32(a + b) + d) + e)
        }
    }

    /** `image_closest_texture_lookup` (:286). */
    closest(px: number, py: number, extension: Extension, out: number[]): void {
        const {width, height} = this.image
        const [tx, ix] = frac(f32(px * width))
        const [ty, iy] = frac(f32(py * height))
        switch (extension) {
        case 'REPEAT':
            return this.pixel(wrapPeriodic(ix, width), wrapPeriodic(iy, height), out, 0)
        case 'CLIP':
            if (tx < 0 || ty < 0 || tx > 1 || ty > 1) {
                out[0] = out[1] = out[2] = out[3] = 0
                return
            }
            if (ix < 0 || iy < 0 || ix > width || iy > height) {
                out[0] = out[1] = out[2] = out[3] = 0
                return
            }
            // ATTR_FALLTHROUGH
            return this.pixel(wrapClamp(ix, width), wrapClamp(iy, height), out, 0)
        case 'EXTEND':
            return this.pixel(wrapClamp(ix, width), wrapClamp(iy, height), out, 0)
        case 'MIRROR':
            return this.pixel(wrapMirror(ix, width), wrapMirror(iy, height), out, 0)
        default:
            out[0] = out[1] = out[2] = out[3] = 0
        }
    }

    /** `image_cubic_texture_lookup` (:147). */
    cubic(px: number, py: number, extension: Extension, out: number[]): void {
        const {width, height} = this.image
        const [tx, pix0] = frac(f32(f32(px * width) - 0.5))
        const [ty, piy0] = frac(f32(f32(py * height) - 0.5))
        let pix = pix0, piy = piy0
        let ppix: number, ppiy: number, nix: number, niy: number, nnix: number, nniy: number
        switch (extension) {
        case 'REPEAT':
            pix = wrapPeriodic(pix, width)
            piy = wrapPeriodic(piy, height)
            ppix = wrapPeriodic(pix - 1, width)
            ppiy = wrapPeriodic(piy - 1, height)
            nix = wrapPeriodic(pix + 1, width)
            niy = wrapPeriodic(piy + 1, height)
            nnix = wrapPeriodic(pix + 2, width)
            nniy = wrapPeriodic(piy + 2, height)
            break
        case 'CLIP':
            ppix = pix - 1
            ppiy = piy - 1
            nix = pix + 1
            niy = piy + 1
            nnix = pix + 2
            nniy = piy + 2
            break
        case 'EXTEND':
            ppix = wrapClamp(pix - 1, width)
            ppiy = wrapClamp(piy - 1, height)
            nix = wrapClamp(pix + 1, width)
            niy = wrapClamp(piy + 1, height)
            nnix = wrapClamp(pix + 2, width)
            nniy = wrapClamp(piy + 2, height)
            pix = wrapClamp(pix, width)
            piy = wrapClamp(piy, height)
            break
        case 'MIRROR':
            ppix = wrapMirror(pix - 1, width)
            ppiy = wrapMirror(piy - 1, height)
            nix = wrapMirror(pix + 1, width)
            niy = wrapMirror(piy + 1, height)
            nnix = wrapMirror(pix + 2, width)
            nniy = wrapMirror(piy + 2, height)
            pix = wrapMirror(pix, width)
            piy = wrapMirror(piy, height)
            break
        default:
            out[0] = out[1] = out[2] = out[3] = 0
            return
        }
        const xc = [ppix, pix, nix, nnix]
        const yc = [ppiy, piy, niy, nniy]
        const u = weights(tx), v = weights(ty)
        const p = this.tmp
        for (let c = 0; c < 4; c++) out[c] = 0
        for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 4; i++) this.pixel(xc[i], yc[j], p, i * 4)
            for (let c = 0; c < 4; c++) {
                // `u[0] * L0 + u[1] * L1 + u[2] * L2 + u[3] * L3`, then `v[j] * (...)`, rows summed left to right.
                let row = f32(u[0] * p[c])
                for (let i = 1; i < 4; i++) row = f32(row + f32(u[i] * p[i * 4 + c]))
                const term = f32(v[j] * row)
                out[c] = j === 0 ? term : f32(out[c] + term)
            }
        }
    }

    private readonly tmp: number[] = new Array(16).fill(0)
}

/** The cubic B-spline weights `u[0..3]` / `v[0..3]` (:210-218). */
function weights(t: number): number[] {
    return [
        f32(f32(f32(f32(f32(f32(NEG_SIXTH * t) + 0.5) * t) - 0.5) * t) + SIXTH),
        f32(f32(f32(f32(f32(0.5 * t) - 1) * t) * t) + TWO_THIRDS),
        f32(f32(f32(f32(f32(f32(-0.5 * t) + 0.5) * t) + 0.5) * t) + SIXTH),
        f32(f32(f32(SIXTH * t) * t) * t),
    ]
}

/** `ImageFieldsFunction` (:55): Vector -> Color (premultiplied as `ColorGeometry4f` expects), Alpha. */
function imageFieldsFunction(image: SceneImage, interpolation: string, extension: Extension): MultiFunction {
    const sampler = new Sampler(image)
    const lookup = interpolation === 'Closest' ? sampler.closest.bind(sampler)
        : interpolation === 'Cubic' ? sampler.cubic.bind(sampler) : sampler.linear.bind(sampler)
    // :359-362: data colour spaces are channel packed.
    const alphaMode = image.isData ? 'CHANNEL_PACKED' : image.alphaMode ?? 'STRAIGHT'
    const c4 = [0, 0, 0, 0]
    return {
        name: 'ImageFunction', inputs: ['float3'], outputs: ['float4', 'float'],
        call(size, ins, outs) {
            const [vector] = ins
            const [color, alpha] = outs
            for (let i = 0; i < size; i++) {
                lookup(vector.get(i, 0), vector.get(i, 1), extension, c4)
                if (alphaMode === 'STRAIGHT') {
                    // `straight_to_premul_v4` (math_color_inline.cc:305).
                    c4[0] = f32(c4[0] * c4[3]); c4[1] = f32(c4[1] * c4[3]); c4[2] = f32(c4[2] * c4[3])
                } else if (alphaMode === 'NONE') {
                    c4[3] = 1
                }
                color[i * 4] = c4[0]; color[i * 4 + 1] = c4[1]; color[i * 4 + 2] = c4[2]; color[i * 4 + 3] = c4[3]
                alpha[i] = c4[3]
            }
        },
    }
}

registerNodeType({
    idname: 'GeometryNodeImageTexture',
    label: 'Image Texture',
    // `node_init` (:47): `SHD_INTERP_LINEAR`, `SHD_IMAGE_EXTENSION_REPEAT`; RNA items rna_nodetree.cc:5605 / :4604.
    properties: {interpolation: 'Linear', extension: 'REPEAT'},
    enums: {interpolation: ['Linear', 'Closest', 'Cubic'], extension: ['REPEAT', 'EXTEND', 'CLIP', 'MIRROR']},
    declare(b) {
        b.input('IMAGE', 'Image')
        b.input('VECTOR', 'Vector').implicit('POSITION')
        b.input('INT', 'Frame').min(0)
        b.output('RGBA', 'Color')
        b.output('FLOAT', 'Alpha')
    },
    execute(p) {
        const ref = p.idRef('Image')
        // :394: no image, default outputs.
        if (!ref) return
        const image = p.options.scene?.image?.(ref.name)
        // `BKE_image_acquire_ibuf` failing (:85) also gives the default outputs.
        if (!image) {
            p.warn(`Image "${ref.name}" is not available in this scene`)
            return
        }
        p.dependsOn(`image:${ref.name}`, image.version ?? 0)
        const fn = imageFieldsFunction(image, p.node.prop<string>('interpolation'), p.node.prop<Extension>('extension'))
        const [color, alpha] = applyFunction(fn, [p.field('Vector')])
        p.set('Color', color)
        p.set('Alpha', alpha)
    },
})
