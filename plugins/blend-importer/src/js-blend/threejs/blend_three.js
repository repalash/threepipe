/* eslint-disable camelcase, no-unused-vars, no-empty, no-constant-condition */
import {createThreeJSBufferGeometry} from './mesh.js';
import {createThreeJSMaterial} from './material.js';
import {Mesh} from 'threepipe';
import {createThreeJSLamp} from './light.js';

const blender_object_types = {
    mesh: 1,
    lamp: 10,
};

function createObject (blender_file, object) {

    if (object.data) {
        // get the mesh
        const buffered_geometry = createThreeJSBufferGeometry(object.data, [0, 0, 0]);

        // console.log(object)
        const blend_material = object.data.mat[0];

        const material = blend_material ? createThreeJSMaterial(blend_material) : null;

        const mesh = new Mesh(buffered_geometry, material);

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        mesh.rotateZ(object.rot[2]);
        mesh.rotateY(object.rot[1]);
        mesh.rotateX(object.rot[0]);
        mesh.scale.fromArray(object.size, 0);
        mesh.position.fromArray([object.loc[0], (object.loc[2]), (-object.loc[1])], 0);

        return mesh;
    }

    return null;
}

function loadObject (object_name, blender_file, cache) {
    const objects = blender_file.Object;

    for (let i = 0; i < objects.length; i++) {
        let object = objects[i];

        if (object.aname === object_name) {
            switch (object.type) {
            case blender_object_types.mesh:
                return createObject(object, blender_file);
            case blender_object_types.lamp:
                return createThreeJSLamp(object, blender_file);
            default:
                console.warn('Unsupported object type', object.type);
            }
        }
    }

    return null;
}

function loadScene (three_scene, blender_file, cache) {

    for (let i = 0; i < blender_file.objects.Object.length; i++) {

        let object = blender_file.objects.Object[i];

        // Load Lights
        if (object.type === blender_object_types.lamp) {
            let light = createThreeJSLamp(object, blender_file);
            three_scene.add(light);
        }

        // Load Meshes
        if (object.type === blender_object_types.mesh) {
            let mesh = createObject(blender_file, object);
            if(mesh) {
                three_scene.add(mesh);
            }
        }
    }
}

export default function (blender_file) {

    const cache = {};

    return {
        loadScene: (three_scene) => loadScene(three_scene, blender_file, cache),
        loadObject: (object_name) => loadObject(object_name, blender_file, cache),
    };
}
