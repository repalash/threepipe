import {MeshPhysicalMaterial} from 'threepipe'
// import {bakeGetters} from './bakeGetters'
// import {gather_material_pbr_metallic_roughness} from '../gltf/pbr_metallic_roughness'
// import {NodeTree, Node, NodeSocket} from '../gltf/blender_types'
// import {bToArray} from './listBaseToArray'

// todo see blender gltf exporter and convert to js. structure is the same
//   https://github.com/KhronosGroup/glTF-Blender-IO/blob/ed5100ab6c40472b7c3254fddfe0dd0d76d60644/addons/io_scene_gltf2/blender/exp/material/materials.py#L60
export function createMaterial(mat: any) {
    // console.log(bakeGetters(mat))

    // let tree = {}
    // // https://github.com/blender/blender/blob/20383e4d82051a70e47e06e6ccca62fa077f11c5/source/blender/makesrna/intern/rna_nodetree.cc#L1722
    // // https://github.com/blender/blender/blob/f7f18cd0c74871671e32229c291c9176e9d68f7f/source/blender/makesdna/DNA_node_types.h#L421
    // tree = assignCopy(mat.nodetree, {
    //     // ...mat.nodetree,
    //     name: mat.nodetree.aname,
    //     nodes: bToArray(mat.nodetree.nodes).map((n: any)=>{
    //         // const typeInt = n.type
    //         // delete n.type
    //         return assignCopy(n, {
    //             // typeof: n.idname,
    //             inputs: bToArray(n.inputs).map((i: any)=>{
    //                 console.log(i)
    //                 if (i.link) {
    //                     // inputs have links outputs dont? todo check array links
    //                     if (i.fromsock && !i.fromsock?.link) i.fromsock.link11 = i.link
    //                     i.link11 = i.link
    //                 }
    //                 return makeSocket(i, n)
    //             }),
    //             outputs: bToArray(n.outputs).map((o: any)=>makeSocket(o, n)),
    //             type: n.idname, // todo type is int here, py code is expecting string like "GROUP"
    //             // name: n.name,
    //             get node_tree() {
    //                 return tree
    //             },
    //         // mute: !!n.mute,
    //         } as Partial<Node>)
    //     }),
    // } as NodeTree)
    // const mat2 = {
    //     // ...mat,
    //     name: mat.name,
    //     use_nodes: !!mat.use_nodes,
    //     node_tree: tree,
    // }
    // console.log(gather_material_pbr_metallic_roughness(mat2, null, {}))

    const material = new MeshPhysicalMaterial()
    material.color.setRGB(mat.r, mat.g, mat.b)
    material.roughness = mat.roughness !== undefined ? mat.roughness : 0.4
    material.metalness = mat.metallic !== undefined ? mat.metallic : 0.0
    // material.opacity = mat.alpha !== undefined ? mat.alpha : 0.0
    material.opacity = 1
    material.transparent = material.opacity < 1.0
    return material
}


// function getAllProps(obj) {
//     const result = new Set()
//
//     while (obj && obj !== Object.prototype) {
//         const names = Object.getOwnPropertyNames(obj)
//         for (const name of names) {
//             // const desc = Object.getOwnPropertyDescriptor(obj, name)
//             // if (desc && typeof desc.get === 'function') {
//             result.add(name)
//             // }
//         }
//         obj = Object.getPrototypeOf(obj)
//     }
//
//     return [...result]
// }
//
// function assignCopy(a, b) {
//     const c = {}
//     const props = getAllProps(a)
//     for (const prop of props) {
//         c[prop] = a[prop]
//     }
//     return Object.assign(c, b)
// }
//
// function makeSocket(i, n) {
//     const l = assignCopy(i, {
//         node: n,
//     } as NodeSocket)
//     Object.defineProperty(l, 'links', {
//         get() {
//             return i.link ? [i.link] : [] // todo array
//         },
//         configurable:true,
//     })
//     return l
// }
