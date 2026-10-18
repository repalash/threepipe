/**
 * Parity cases for Image Texture (`node_geo_image_texture.cc`): every interpolation x extension on points inside
 * and outside [0, 1], every alpha mode and a data colour space, a single-value vector, and no image.
 */

import {geometryNodes, n, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {CaseImage, ParityCase} from './types'

const W = 5, H = 3

/** A small non-square RGBA image with non-dyadic values and varying alpha. */
function testImage(name: string, extra: Partial<CaseImage> = {}): CaseImage {
    const pixels: number[] = []
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            pixels.push(((x * 7 + y * 3) % 11) / 10, ((x * 5 + y * 13) % 9) / 8, (x + y) / 7, 0.25 + ((x * 3 + y) % 4) * 0.25)
        }
    }
    return {name, width: W, height: H, pixels, ...extra}
}

const IMAGE = {_ref: 'IMAGE', name: 'img'} as const

/** Points covering [-0.65, 1.65] x [-0.55, 1.55]: inside the image, on its border and beyond on every side. */
function samplePoints(): Socket<'GEOMETRY'> {
    const grid = n.MeshGrid({sizeX: 2.3, sizeY: 2.1, verticesX: 24, verticesY: 19}).mesh
    return n.MeshToPoints({mesh: n.SetPosition({geometry: grid, offset: [0.5, 0.5, 0]}).geometry}).points
}

function store(geometry: Socket<'GEOMETRY'>, color: Socket<'RGBA'>, alpha: Socket<'FLOAT'>): Socket<'GEOMETRY'> {
    const c = n.StoreNamedAttribute({geometry, dataType: 'FLOAT_COLOR', name: 'color', value: color}).geometry
    return n.StoreNamedAttribute({geometry: c, dataType: 'FLOAT', name: 'alpha', value: alpha}).geometry
}

function imageCase(id: string, description: string, images: CaseImage[], build: () => Socket<'GEOMETRY'>): ParityCase {
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', build())
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty', images}
}

export function imageTextureCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const interpolation of ['Linear', 'Closest', 'Cubic'] as const) {
        for (const extension of ['REPEAT', 'EXTEND', 'CLIP', 'MIRROR'] as const) {
            cases.push(imageCase(`image-${interpolation.toLowerCase()}-${extension.toLowerCase()}`,
                `${interpolation} / ${extension} on points in and around the image (straight alpha)`, [testImage('img')], () => {
                    const points = samplePoints()
                    const t = n.ImageTexture({image: IMAGE, interpolation, extension})
                    return store(points, t.color, t.alpha)
                }))
        }
    }
    for (const alphaMode of ['PREMUL', 'CHANNEL_PACKED', 'NONE'] as const) {
        cases.push(imageCase(`image-alpha-${alphaMode.toLowerCase()}`, `Alpha mode ${alphaMode} (Linear / REPEAT)`, [testImage('img', {alphaMode})], () => {
            const t = n.ImageTexture({image: IMAGE})
            return store(samplePoints(), t.color, t.alpha)
        }))
    }
    cases.push(imageCase('image-non-color', 'Straight alpha in a data colour space: channel packed (Linear / REPEAT)', [testImage('img', {isData: true})], () => {
        const t = n.ImageTexture({image: IMAGE})
        return store(samplePoints(), t.color, t.alpha)
    }))
    cases.push(imageCase('image-single-vector', 'A single-value vector (Cubic / MIRROR): single outputs', [testImage('img')], () => {
        const t = n.ImageTexture({image: IMAGE, interpolation: 'Cubic', extension: 'MIRROR', vector: [-0.37, 1.81, 0]})
        return store(n.MeshLine({count: 3}).mesh, t.color, t.alpha)
    }))
    cases.push(imageCase('image-none', 'No image: default outputs', [], () => {
        const t = n.ImageTexture({})
        return store(n.MeshLine({count: 2}).mesh, t.color, t.alpha)
    }))
    return cases
}
