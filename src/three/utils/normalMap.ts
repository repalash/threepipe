import {Material, Texture, TextureSource, Vector2} from 'three'
import type {IObject3D} from '../../core'

/**
 * Bakes the sign of `material.normalScale` into a copy of its normal map, as three.js's `GLTFExporter` does (r185,
 * #33837), so other glTF viewers show the map as threepipe does. The material looks the same.
 *
 * Call it after setting a normal map from an image (`TweakpaneUiPlugin` does). Maps from glTF files, compressed (KTX2),
 * data and render target textures are not changed.
 * @param material - a material with `normalMap` and `normalScale`
 * @param tangents - whether the meshes of the material have tangents. Default: all of `material.appliedMeshes` do.
 * @returns whether the map and scale were changed
 */
export function bakeNormalScaleSign(material: Material & {normalMap?: Texture | null, normalScale?: Vector2, appliedMeshes?: Set<IObject3D>}, tangents?: boolean): boolean {
    const map = material.normalMap
    const scale = material.normalScale
    if (!map || !scale) return false
    if (tangents === undefined) {
        const meshes = [...material.appliedMeshes ?? []]
        tangents = meshes.length > 0 && meshes.every(m => m.geometry?.hasAttribute('tangent'))
    }
    // as GLTFExporter.processMaterialAsync
    const flipX = scale.x < 0
    const flipY = tangents ? scale.y < 0 : scale.y > 0
    if (!flipX && !flipY) return false

    const image = map.image as CanvasImageSource & {width: number, height: number, data?: unknown}
    if ((map as any).isCompressedTexture || (map as any).isRenderTargetTexture || !image || image.data !== undefined || !image.width) {
        console.warn('bakeNormalScaleSign: cannot read the pixels of the normal map', map)
        return false
    }

    // as GLTFExporter.buildNormalMapTextureAsync
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', {willReadFrequently: true})
    if (!context) return false
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
        if (flipX) data[i] = 255 - data[i]
        if (flipY) data[i + 1] = 255 - data[i + 1]
    }
    context.putImageData(imageData, 0, 0)

    const baked = map.clone()
    baked.source = new TextureSource(canvas)
    delete baked.userData.rootPath // the image is no longer the file at that url
    baked.needsUpdate = true

    material.normalMap = baked
    scale.set(Math.abs(scale.x), tangents ? Math.abs(scale.y) : -Math.abs(scale.y))
    material.needsUpdate = true
    return true
}
