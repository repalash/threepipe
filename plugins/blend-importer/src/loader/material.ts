import {MeshPhysicalMaterial} from 'threepipe'

// todo see blender gltf exporter and convert to js. structure is the same
export function createMaterial(mat: any) {
    const material = new MeshPhysicalMaterial()
    material.color.setRGB(mat.r, mat.g, mat.b)
    material.roughness = mat.roughness !== undefined ? mat.roughness : 0.4
    material.metalness = mat.metallic !== undefined ? mat.metallic : 0.0
    material.opacity = mat.alpha !== undefined ? mat.alpha : 0.0
    material.transparent = material.opacity < 1.0
    return material
}
