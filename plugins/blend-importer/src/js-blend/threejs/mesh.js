/* eslint-disable camelcase, no-unused-vars, no-empty, no-constant-condition */

import {BufferAttribute, BufferGeometry} from 'threepipe';

export function createBufferGeometry (blender_mesh, origin) {
    // get materials
    let pick_material = 0,
        mesh = blender_mesh,
        faces = mesh.mpoly,
        loops = mesh.mloop,
        UV = mesh.mloopuv,
        verts = mesh.mvert;

    const geometry = new BufferGeometry();

    if (!faces) return geometry;

    let index_count = 0;

    // precalculate the size of the array needed for faces
    let face_indice_count = 0;
    let face_indice_counta = 0;

    for (let i = 0; i < faces.length; i++) {
        const face = faces[i] || faces;
        const len = face.totloop;
        let indexi = 1;

        face_indice_counta += (len * 2 / 3) | 0;

        while (indexi < len) {
            face_indice_count += 3;
            indexi += 2;
        }
    }

    // extract face info and dump into array buffer;
    const face_buffer = new Uint32Array(face_indice_count);
    const uv_buffer = new Float32Array(face_indice_count * 2);
    const normal_buffer = new Float32Array(face_indice_count * 3);
    const verts_array_buff = new Float32Array(face_indice_count * 3);

    for (let i = 0; i < faces.length; i++) {
        const face = faces[i] || faces;
        const len = face.totloop;
        const start = face.loopstart;
        let indexi = 1;
        const offset = 0;

        while (indexi < len) {
            const face_normals = [];
            const face_index_array = [];
            const face_uvs = [];

            let index = 0;

            for (let l = 0; l < 3; l++) {
                // Per Vertice

                if ((indexi - 1) + l < len) {
                    index = start + (indexi - 1) + l;
                } else {
                    index = start;
                }

                const v = loops[index].v;
                const vert = verts[v];
                face_buffer[index_count] = index_count;
                // get normals, which are 16byte ints, and norm them back into floats.

                verts_array_buff[index_count * 3 + 0] = vert.co[0] + origin[0];
                verts_array_buff[index_count * 3 + 1] = vert.co[2] + origin[2];
                verts_array_buff[index_count * 3 + 2] = -vert.co[1] + -origin[1];

                normal_buffer[index_count * 3 + 0] = vert.no[0];
                normal_buffer[index_count * 3 + 1] = vert.no[2];
                normal_buffer[index_count * 3 + 2] = (-vert.no[1]);


                if (UV) {
                    const uv = UV[index].uv;
                    uv_buffer[index_count * 2 + 0] = uv[0];
                    uv_buffer[index_count * 2 + 1] = uv[1];
                }

                index_count++;
            }

            indexi += 2;
        }
    }

    geometry.setAttribute('position', new BufferAttribute(verts_array_buff, 3));
    geometry.setIndex(new BufferAttribute(face_buffer, 1));
    geometry.setAttribute('normal', new BufferAttribute(normal_buffer, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv_buffer, 2));
    // geometry.blend_mat = materials[pick_material];

    return geometry;
}

// function createThreeJSGeometry (blender_mesh, origin) {
//     // get materials
//     const mats = blender_mesh.mat,
//         materials = [];
//     for (var i = 0; i < mats.length; i++) {
//         const material = createThreeJSMaterial(mats[i]);
//         materials.push(material);
//     }
//
//     let pick_material = 0,
//         mesh = blender_mesh,
//         faces = mesh.mpoly,
//         loops = mesh.mloop,
//         UV = mesh.mloopuv,
//         verts = mesh.mvert,
//         vert_array = [],
//         face_array = [],
//         uv_array = [],
//         normal_array = [];
//
//     const geometry = new Geometry();
//
//     if (!faces) return geometry;
//
//
//     let index_count = 0;
//
//     let verts_array_buff = new Float32Array(verts.length * 3);
//
//     for (var i = 0; i < verts.length; i++) {
//         let vert = verts[i];
//         vert_array.push(new Vector3(vert.co[0] + origin[0], vert.co[2] + origin[2], -vert.co[1] - origin[1]));
//     }
//
//     for (var i = 0; i < faces.length; i++) {
//         const face = faces[i] || faces;
//         const len = face.totloop;
//         const start = face.loopstart;
//         let indexi = 1;
//
//         pick_material = face.mat_nr;
//
//         while (indexi < len) {
//             const face_normals = [];
//             const face_index_array = [];
//             const face_uvs = [];
//
//             let index = 0;
//
//             for (let l = 0; l < 3; l++) {
//                 // Per Vertice
//
//                 if ((indexi - 1) + l < len) {
//                     index = start + (indexi - 1) + l;
//                 } else {
//                     index = start;
//                 }
//
//                 const v = loops[index].v;
//                 var vert = verts[v];
//
//                 face_index_array.push(v);
//
//                 index_count++;
//
//                 // get normals, which are 16byte ints, and norm them back into floats.
//
//                 const n1 = vert.no[0],
//                     n2 = vert.no[2],
//                     n3 = -vert.no[1];
//
//                 const nl = 1;
//
//                 Math.sqrt((n1 * n1) + (n2 * n2) + (n3 * n3));
//
//                 face_normals.push(new Vector3(n1 / nl, n2 / nl, n3 / nl));
//
//                 if (UV) {
//                     const uv = UV[index].uv;
//                     face_uvs.push(new Vector2(uv[0], uv[1]));
//                 }
//             }
//             uv_array.push(face_uvs);
//             face_array.push(new Face3(
//                 face_index_array[0], face_index_array[1], face_index_array[2],
//                 face_normals,
//             ));
//
//             indexi += 2;
//         }
//     }
//     geometry.blend_mat = materials[pick_material];
//     geometry.vertices = vert_array;
//     geometry.faces = face_array;
//     if (uv_array.length > 0) {
//         geometry.faceVertexUvs = [uv_array];
//     }
//
//     geometry.uvsNeedUpdate = true;
//
//     // Well, using blender file normals does not work. Will need to investigate why normals from the blender file do not provide correct results.
//     // For now, have Three calculate normals.
//
//     geometry.computeVertexNormals();
//
//
//     return geometry;
// }
