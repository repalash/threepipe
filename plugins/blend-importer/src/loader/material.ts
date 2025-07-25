// todo see blender gltf exporter and convert to js. structure is the same
//   https://github.com/KhronosGroup/glTF-Blender-IO/blob/ed5100ab6c40472b7c3254fddfe0dd0d76d60644/addons/io_scene_gltf2/blender/exp/material/materials.py#L60
import {Ctx} from './ctx'

export function createMaterial(mat: any, ctx: Ctx) {
    const material = new ctx.MeshPhysicalMaterial()
    material.color.setRGB(mat.r, mat.g, mat.b)
    material.roughness = mat.roughness !== undefined ? mat.roughness : 0.4
    material.metalness = mat.metallic !== undefined ? mat.metallic : 0.0
    // material.opacity = mat.alpha !== undefined ? mat.alpha : 0.0
    material.opacity = 1
    material.transparent = material.opacity < 1.0
    return material
}
