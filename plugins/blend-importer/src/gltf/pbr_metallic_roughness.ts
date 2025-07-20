// noinspection JSUnusedLocalSymbols

// SPDX-FileCopyrightText: 2018-2021 The glTF-Blender-IO authors
//
// SPDX-License-Identifier: Apache-2.0

import type { Material, NodeSocket } from './blender_types';
// import { gltf2_io } from './gltf2_io';
// import { export_user_extensions } from './user_extensions';
// import { cached } from './cache';
// import { gather_texture_info } from './texture_info';

import {
    get_socket_from_gltf_material_node,
    has_image_node_from_socket,
    get_const_from_default_value_socket,
    get_socket,
    get_factor_from_socket,
    gather_alpha_info,
    gather_color_info,
    NodeSocket as NodeSocketClass
} from './search_node_tree';

interface VCInfo {
    color: string | null;
    alpha: string | null;
    color_type: string | null;
    alpha_type: string | null;
    alpha_mode: string;
}

interface PathInfo {
    length: number;
    path: string;
    additional_path?: string | null;
    vector_type?: string;
}

interface UVMapInfos {
    [key: string]: any;
}

interface UDIMInfos {
    [key: string]: any;
}

interface ExportSettings {
    gltf_image_format: string;
    current_paths: { [key: string]: PathInfo };
    current_texture_transform: { [key: string]: any };
    [key: string]: any;
}

// @cached
export function gather_material_pbr_metallic_roughness(
    blender_material: Material,
    orm_texture: any,
    export_settings: ExportSettings
): [gltf2_io.MaterialPBRMetallicRoughness | null, UVMapInfos, VCInfo, UDIMInfos] {
    if (!__filter_pbr_material(blender_material, export_settings)) {
        return [
            null,
            {},
            {
                color: null,
                alpha: null,
                color_type: null,
                alpha_type: null,
                alpha_mode: "OPAQUE"
            },
            {}
        ];
    }

    // const uvmap_infos: UVMapInfos = {};
    // const udim_infos: UDIMInfos = {};
    //
    // const [base_color_texture, uvmap_info_bc, udim_info_bc, _1] = __gather_base_color_texture(
    //     blender_material,
    //     export_settings
    // );
    // Object.assign(uvmap_infos, uvmap_info_bc);
    // Object.assign(udim_infos, udim_info_bc);
    //
    // const [metallic_roughness_texture, uvmap_info_mr, udim_info_mr, _2] = __gather_metallic_roughness_texture(
    //     blender_material,
    //     orm_texture,
    //     export_settings
    // );
    // Object.assign(uvmap_infos, uvmap_info_mr);
    // Object.assign(udim_infos, udim_info_mr);

    const [base_color_factor, vc_info] = __gather_base_color_factor(blender_material, export_settings);

    // const material = new gltf2_io.MaterialPBRMetallicRoughness(
    //     base_color_factor,
    //     base_color_texture,
    //     __gather_extensions(blender_material, export_settings),
    //     __gather_extras(blender_material, export_settings),
    //     __gather_metallic_factor(blender_material, export_settings),
    //     metallic_roughness_texture,
    //     __gather_roughness_factor(blender_material, export_settings)
    // );

    // export_user_extensions(
    //     'gather_material_pbr_metallic_roughness_hook',
    //     export_settings,
    //     material,
    //     blender_material,
    //     orm_texture
    // );

    return [material, uvmap_infos, vc_info, udim_infos];
}

function __filter_pbr_material(blender_material: Material, export_settings: ExportSettings): boolean {
    return true;
}

function __gather_base_color_factor(
    blender_material: Material,
    export_settings: ExportSettings
): [number[] | null, VCInfo] {
    if (!blender_material.use_nodes) {
        return [
            [...blender_material.diffuse_color.slice(0, 3), 1.0],
            {
                color: null,
                alpha: null,
                color_type: null,
                alpha_type: null,
                alpha_mode: "OPAQUE"
            }
        ];
    }

    let rgb: number[] | null = null;
    let alpha: number | null = null;
    const vc_info: VCInfo = {
        color: null,
        alpha: null,
        color_type: null,
        alpha_type: null,
        alpha_mode: "OPAQUE"
    };

    let path_alpha: string | null = null;
    let path: string | null = null;

    const alpha_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Alpha");
    if (alpha_socket.socket !== null && alpha_socket.socket instanceof NodeSocket) {
        const alpha_info = gather_alpha_info(alpha_socket.to_node_nav());
        vc_info.alpha = alpha_info.alphaColorAttrib;
        vc_info.alpha_type = alpha_info.alphaColorAttribType;
        vc_info.alpha_mode = alpha_info.alphaMode || "OPAQUE";
        alpha = alpha_info.alphaFactor;
        path_alpha = alpha_info.alphaPath;
    }

    let base_color_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Base Color");
    if (base_color_socket.socket === null) {
        base_color_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "BaseColor");
    }
    if (base_color_socket.socket === null) {
        base_color_socket = get_socket_from_gltf_material_node(
            blender_material.node_tree,
            blender_material.use_nodes,
            "BaseColorFactor"
        );
    }
    if (base_color_socket.socket !== null && base_color_socket.socket instanceof NodeSocket) {
        if (export_settings.gltf_image_format !== "NONE") {
            const rgb_vc_info = gather_color_info(base_color_socket.to_node_nav());
            vc_info.color = rgb_vc_info.colorAttrib;
            vc_info.color_type = rgb_vc_info.colorAttribType;
            rgb = rgb_vc_info.colorFactor;
            path = rgb_vc_info.colorPath;
        } else {
            [rgb, path] = get_const_from_default_value_socket(base_color_socket, 'RGB');
        }
    }

    // Storing path for KHR_animation_pointer
    if (path !== null) {
        const path_: PathInfo = {
            length: 3,
            path: "/materials/XXX/pbrMetallicRoughness/baseColorFactor",
            additional_path: path_alpha
        };
        export_settings.current_paths[path] = path_;
    }

    // Storing path for KHR_animation_pointer
    if (path_alpha !== null) {
        const path_: PathInfo = {
            length: 1,
            path: "/materials/XXX/pbrMetallicRoughness/baseColorFactor",
            additional_path: path
        };
        export_settings.current_paths[path_alpha] = path_;
    }

    if (rgb === null) {
        rgb = [1.0, 1.0, 1.0];
    }
    if (alpha === null) {
        alpha = 1.0;
    }

    // Need to clamp between 0.0 and 1.0: Blender color can be outside this range
    rgb = rgb.map(c => Math.max(Math.min(c, 1.0), 0.0));

    const rgba = [...rgb, alpha];

    if (rgba[0] === 1 && rgba[1] === 1 && rgba[2] === 1 && rgba[3] === 1) {
        return [null, vc_info];
    }
    return [rgba, vc_info];
}

function __gather_base_color_texture(
    blender_material: Material,
    export_settings: ExportSettings
): [any, UVMapInfos, UDIMInfos, any] {
    let base_color_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Base Color");
    if (base_color_socket.socket === null) {
        base_color_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "BaseColor");
    }
    if (base_color_socket.socket === null) {
        base_color_socket = get_socket_from_gltf_material_node(
            blender_material.node_tree,
            blender_material.use_nodes,
            "BaseColor"
        );
    }

    const alpha_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Alpha");

    // keep sockets that have some texture : color and/or alpha
    const inputs = [base_color_socket, alpha_socket].filter(
        socket => socket.socket !== null && has_image_node_from_socket(socket, export_settings)
    );

    if (inputs.length === 0) {
        return [null, {}, {}, null];
    }

    const [tex, uvmap_info, udim_info, factor] = gather_texture_info(inputs[0], inputs, export_settings);

    if (Object.keys(export_settings.current_texture_transform).length !== 0) {
        for (const k of Object.keys(export_settings.current_texture_transform)) {
            const path_: PathInfo = {
                length: export_settings.current_texture_transform[k].length,
                path: export_settings.current_texture_transform[k].path.replace(
                    "YYY",
                    "pbrMetallicRoughness/baseColorTexture/extensions"
                ),
                vector_type: export_settings.current_texture_transform[k].vector_type
            };
            export_settings.current_paths[k] = path_;
        }
    }

    export_settings.current_texture_transform = {};

    return [
        tex,
        { baseColorTexture: uvmap_info },
        Object.keys(udim_info).length > 0 ? { baseColorTexture: udim_info } : {},
        factor
    ];
}

function __gather_extensions(blender_material: Material, export_settings: ExportSettings): any {
    return null;
}

function __gather_extras(blender_material: Material, export_settings: ExportSettings): any {
    return null;
}

function __gather_metallic_factor(blender_material: Material, export_settings: ExportSettings): number | null {
    if (!blender_material.use_nodes) {
        return blender_material.metallic;
    }

    let metallic_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Metallic");
    if (metallic_socket.socket === null) {
        metallic_socket = get_socket_from_gltf_material_node(
            blender_material.node_tree,
            blender_material.use_nodes,
            "MetallicFactor"
        );
    }
    if (metallic_socket.socket !== null && metallic_socket.socket instanceof NodeSocket) {
        const [fac, path] = get_factor_from_socket(metallic_socket, 'VALUE');

        // Storing path for KHR_animation_pointer
        if (path !== null) {
            const path_: PathInfo = {
                length: 1,
                path: "/materials/XXX/pbrMetallicRoughness/metallicFactor"
            };
            export_settings.current_paths[path] = path_;
        }

        return fac !== 1 ? fac : null;
    }

    return null;
}

function __gather_metallic_roughness_texture(
    blender_material: Material,
    orm_texture: any,
    export_settings: ExportSettings
): [any, UVMapInfos, UDIMInfos, any] {
    const metallic_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Metallic");
    const roughness_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Roughness");

    const hasMetal = metallic_socket.socket !== null && has_image_node_from_socket(metallic_socket, export_settings);
    const hasRough = roughness_socket.socket !== null && has_image_node_from_socket(roughness_socket, export_settings);

    let texture_input: NodeSocketClass[];

    // Warning: for default socket, do not use NodeSocket object, because it will break cache
    // Using directly the Blender socket object
    if (!hasMetal && !hasRough) {
        const metallic_roughness = get_socket_from_gltf_material_node(
            blender_material.node_tree,
            blender_material.use_nodes,
            "MetallicRoughness"
        );
        if (metallic_roughness.socket === null || !has_image_node_from_socket(metallic_roughness, export_settings)) {
            return [null, {}, {}, null];
        } else {
            texture_input = [metallic_roughness, metallic_roughness];
        }
    } else if (!hasMetal) {
        texture_input = [roughness_socket];
    } else if (!hasRough) {
        texture_input = [metallic_socket];
    } else {
        texture_input = [metallic_socket, roughness_socket];
    }

    const [tex, uvmap_info, udim_info, factor] = gather_texture_info(
        texture_input[0],
        orm_texture || texture_input,
        export_settings
    );

    return [
        tex,
        { metallicRoughnessTexture: uvmap_info },
        Object.keys(udim_info).length > 0 ? { metallicRoughnessTexture: udim_info } : {},
        factor
    ];
}

function __gather_roughness_factor(blender_material: Material, export_settings: ExportSettings): number | null {
    if (!blender_material.use_nodes) {
        return blender_material.roughness;
    }

    let roughness_socket = get_socket(blender_material.node_tree, blender_material.use_nodes, "Roughness");
    if (roughness_socket === null) {
        roughness_socket = get_socket_from_gltf_material_node(
            blender_material.node_tree,
            blender_material.use_nodes,
            "RoughnessFactor"
        );
    }
    if (roughness_socket.socket !== null && roughness_socket.socket instanceof NodeSocket) {
        const [fac, path] = get_factor_from_socket(roughness_socket, 'VALUE');

        // Storing path for KHR_animation_pointer
        if (path !== null) {
            const path_: PathInfo = {
                length: 1,
                path: "/materials/XXX/pbrMetallicRoughness/roughnessFactor"
            };
            export_settings.current_paths[path] = path_;
        }

        return fac !== 1 ? fac : null;
    }
    return null;
}

export function get_default_pbr_for_emissive_node(): gltf2_io.MaterialPBRMetallicRoughness {
    return new gltf2_io.MaterialPBRMetallicRoughness(
        [0.0, 0.0, 0.0, 1.0],  // base_color_factor
        null,                   // base_color_texture
        null,                   // extensions
        null,                   // extras
        null,                   // metallic_factor
        null,                   // metallic_roughness_texture
        null                    // roughness_factor
    );
}
