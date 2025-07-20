// SPDX-FileCopyrightText: 2018-2021 The glTF-Blender-IO authors
//
// SPDX-License-Identifier: Apache-2.0

//
// Imports
//

import type { Node, NodeLink, NodeTree, Material, NodeSocket as NodeSocket_ } from './blender_types';
// import { Vector, Matrix } from './mathutils';
// import { cached } from './cache';
import { get_gltf_node_name, get_gltf_node_old_name, get_gltf_old_group_node_name } from './material_helpers';
import {bToArray} from "../loader/listBaseToArray";
// import { texture_transform_blender_to_gltf, inverted_trs_mapping_node } from './conversion';

/**
 * Base class for all node tree filter operations.
 */
class Filter {
    constructor() {}

    call(shader_node: Node): boolean {
        return true;
    }
}

/**
 * Filter the material node tree by name.
 *
 * example usage:
 * find_from_socket(start_socket, new FilterByName("Normal"))
 */
class FilterByName extends Filter {
    private name: string;

    constructor(name: string) {
        super();
        this.name = name;
    }

    call(shader_node: Node): boolean {
        return shader_node.name === this.name;
    }
}

/**
 * Filter the material node tree by type.
 */
class FilterByType extends Filter {
    private type: any;

    constructor(type: any) {
        super();
        this.type = type;
    }

    call(shader_node: Node): boolean {
        return shader_node instanceof this.type;
    }
}

class NodeTreeSearchResult {
    shader_node: Node;
    path: NodeLink[];
    group_path: Node[];

    constructor(
        shader_node: Node,
        path: NodeLink[],
        group_path: Node[]
    ) {
        this.shader_node = shader_node;
        this.path = path;
        this.group_path = group_path;
    }
}

// TODO: cache these searches
/**
 * Find shader nodes where the filter expression is true.
 *
 * @param start_socket - the beginning of the traversal
 * @param shader_node_filter - should be a function(x: shader_node) -> bool
 * @returns a list of shader nodes for which filter is true
 */
function from_socket(
    start_socket: NodeTreeSearchResult,
    shader_node_filter: Filter | ((node: Node) => boolean)
): NodeTreeSearchResult[] {
    // hide implementation (especially the search path)
    function __search_from_socket(
        start_socket: NodeSocket_,
        shader_node_filter: Filter | ((node: Node) => boolean),
        search_path: NodeLink[],
        group_path: Node[]
    ): NodeTreeSearchResult[] {
        const results: NodeTreeSearchResult[] = [];

        for (const link of start_socket.links) {
            // follow the link to a shader node
            const linked_node = link.from_node;

            if (linked_node.type === "GROUP") {
                const group_output_node = linked_node.node_tree.nodes.find(node => node.type === "GROUP_OUTPUT")!;
                const socket = group_output_node.inputs.find(sock => sock.name === link.from_socket.name)!;
                group_path.push(linked_node);
                const linked_results = __search_from_socket(
                    socket, shader_node_filter, [...search_path, link], [...group_path]
                );
                if (linked_results.length > 0) {
                    // add the link to the current path
                    search_path.push(link);
                    results.push(...linked_results);
                }
                continue;
            }

            if (linked_node.type === "GROUP_INPUT") {
                const socket = group_path[group_path.length - 1].inputs.find(
                    sock => sock.name === link.from_socket.name
                )!;
                const linked_results = __search_from_socket(
                    socket, shader_node_filter, [...search_path, link], group_path.slice(0, -1)
                );
                if (linked_results.length > 0) {
                    // add the link to the current path
                    search_path.push(link);
                    results.push(...linked_results);
                }
                continue;
            }

            // check if the node matches the filter
            const filterFunc = shader_node_filter instanceof Filter
                ? (node: Node) => shader_node_filter.call(node)
                : shader_node_filter;

            if (filterFunc(linked_node)) {
                results.push(new NodeTreeSearchResult(linked_node, [...search_path, link], group_path));
            }
            // traverse into inputs of the node
            for (const input_socket of linked_node.inputs) {
                const linked_results = __search_from_socket(
                    input_socket, shader_node_filter, [...search_path, link], [...group_path]
                );
                if (linked_results.length > 0) {
                    // add the link to the current path
                    search_path.push(link);
                    results.push(...linked_results);
                }
            }
        }

        return results;
    }

    if (!start_socket.socket) {
        return [];
    }

    // Search if direct node of the socket matches the filter
    const filterFunc = shader_node_filter instanceof Filter
        ? (node: Node) => shader_node_filter.call(node)
        : shader_node_filter;

    if (filterFunc(start_socket.socket.node)) {
        return [new NodeTreeSearchResult(start_socket.socket.node, [], [...start_socket.group_path])];
    }

    return __search_from_socket(start_socket.socket, shader_node_filter, [], start_socket.group_path);
}

// @cached
export function get_texture_node_from_socket(socket: NodeSocket, export_settings: any): NodeTreeSearchResult | null {
    const result = from_socket(
        socket,
        new FilterByType('ShaderNodeTexImage')
    );
    if (result.length === 0) {
        return null;
    }
    if (!result[0].shader_node.image) {
        return null;
    }
    return result[0];
}

export function has_image_node_from_socket(socket: NodeSocket, export_settings: any): boolean {
    const result = get_texture_node_from_socket(socket, export_settings);
    return result !== null;
}

/**
 * Return the default value of a socket, even if this socket is linked
 */
export function get_const_from_default_value_socket(socket: NodeSocket, kind: string): [any, string | null] {
    if (kind === 'RGB') {
        if (socket.socket.type !== 'RGBA') {
            return [null, null];
        }
        return [Array.from(socket.socket.default_value).slice(0, 3), `node_tree.${socket.socket.path_from_id()}.default_value`];
    }
    if (kind === 'VALUE') {
        if (socket.socket.type !== 'VALUE') {
            return [null, null];
        }
        return [socket.socket.default_value, `node_tree.${socket.socket.path_from_id()}.default_value`];
    }
    return [null, null];
}

// TODOSNode : @cached? If yes, need to use id of node tree, has this is probably not fully hashable
// For now, not caching it. If we encounter performance issue, we will see later

/**
 * For a given tree, recursively return all nodes including node groups.
 */
export function get_material_nodes(node_tree: NodeTree, group_path: Node[], type: string): [Node, Node[]][] {
    const nodes: [Node, Node[]][] = [];
    for (const node of node_tree.nodes.filter(n => n.type === type && !n.mute)) {
        nodes.push([node, [...group_path]]);
    }

    // Some weird node groups with missing datablock can have no node_tree, so checking n.node_tree (See #1797)
    for (const node of node_tree.nodes.filter(n =>
        n.type === "GROUP" &&
        n.node_tree !== null &&
        !n.mute &&
        n.node_tree.name !== get_gltf_old_group_node_name()
    )) {  // Do not enter the old glTF node group
        const new_group_path = [...group_path];
        new_group_path.push(node);
        nodes.push(...get_material_nodes(node.node_tree!, new_group_path, type));
    }

    return nodes;
}

/**
 * For a given material input name, retrieve the corresponding node tree socket in the special glTF node group.
 *
 * @param blender_material_nodetree - a blender material node tree for which to get the socket
 * @param use_nodes - whether to use nodes
 * @param name - the name of the socket
 * @returns a blender NodeSocket
 */
export function get_socket_from_gltf_material_node(
    blender_material_nodetree: NodeTree,
    use_nodes: boolean,
    name: string
): NodeSocket {
    const gltf_node_group_names = [get_gltf_node_name().toLowerCase(), get_gltf_node_old_name().toLowerCase()];
    if (blender_material_nodetree && use_nodes) {
        let nodes = get_material_nodes(blender_material_nodetree, [blender_material_nodetree], 'ShaderNodeGroup');
        // Some weird node groups with missing datablock can have no node_tree, so checking n.node_tree (See #1797)
        nodes = nodes.filter(n =>
            n[0].node_tree !== null &&
            gltf_node_group_names.some(g => n[0].node_tree.name.toLowerCase().startsWith(g))
        );
        const inputs: [NodeSocket, Node[]][] = nodes.flatMap(node =>
            node[0].inputs.filter(input => input.name === name).map(input => [input, node[1]] as [NodeSocket, Node[]])
        );
        if (inputs.length > 0) {
            return new NodeSocket(inputs[0][0], inputs[0][1]);
        }
    }

    return new NodeSocket(null, null);
}

/**
 * Helper for navigating through node trees.
 */
class NodeNav {
    node: Node | null;              // Current node
    out_socket: NodeSocket | null;  // Socket through which we arrived at this node
    in_socket: NodeSocket | null;   // Socket through which we will leave this node
    stack: [Node, NodeSocket | null][];  // Stack of (group node, socket) pairs descended through to get here
    moved: boolean;                 // Whether the last move_back call moved back or not

    constructor(node: Node | null, in_socket: NodeSocket | null = null, out_socket: NodeSocket | null = null) {
        this.node = node;
        this.out_socket = out_socket;
        this.in_socket = in_socket;
        this.stack = [];
        this.moved = false;
    }

    copy(): NodeNav {
        const new_nav = new NodeNav(this.node);
        new_nav.assign(this);
        return new_nav;
    }

    assign(other: NodeNav): void {
        this.node = other.node;
        this.in_socket = other.in_socket;
        this.out_socket = other.out_socket;
        this.stack = [...other.stack];
        this.moved = other.moved;
    }

    /**
     * Selects an input socket.
     *
     * Most operations that operate on the input socket can be passed an in_soc
     * parameter to select an input socket before running.
     */
    select_input_socket(in_soc: NodeSocket | number | string | null): void {
        if (in_soc === null) {
            // Keep current selected input socket
            return;
        } else if (in_soc instanceof NodeSocket) {
            console.assert(in_soc.node === this.node);
            this.in_socket = in_soc;
        } else if (typeof in_soc === 'number') {
            this.in_socket = this.node!.inputs[in_soc];
        } else {
            console.assert(typeof in_soc === 'string');
            // An identifier like "#A_Color" selects a socket by
            // identifier. This is useful for sockets that cannot be
            // selected because of non-unique names.
            if (in_soc.startsWith('#')) {
                const ident = in_soc.slice(1);
                for (const socket of this.node!.inputs) {
                    if (socket.identifier === ident) {
                        this.in_socket = socket;
                        return;
                    }
                }
            }
            // Select by regular name
            this.in_socket = this.node!.inputs.find(s => s.name === in_soc) || null;
        }
    }

    get_out_socket_index(): number {
        console.assert(this.out_socket);
        for (let i = 0; i < this.node!.outputs.length; i++) {
            if (this.node!.outputs[i] === this.out_socket) {
                return i;
            }
        }
        console.assert(false);
        return -1;
    }

    /**
     * Descend into a group node.
     */
    descend(): void {
        if (this.node && this.node.type === 'GROUP' && this.node.node_tree && this.out_socket) {
            const i = this.get_out_socket_index();
            this.stack.push([this.node, this.out_socket]);
            this.node = this.node.node_tree.nodes.find(node => node.type === 'GROUP_OUTPUT') || null;
            this.in_socket = this.node!.inputs[i];
            this.out_socket = null;
        }
    }

    /**
     * Ascend from a group input node back to the group node.
     */
    ascend(): void {
        if (this.stack.length > 0 && this.node && this.node.type === 'GROUP_INPUT' && this.out_socket) {
            const i = this.get_out_socket_index();
            const [node, socket] = this.stack.pop()!;
            this.node = node;
            this.out_socket = socket;
            this.in_socket = this.node.inputs[i];
        }
    }

    /**
     * Move backwards through an input socket to the next node.
     */
    move_back(in_soc: NodeSocket | number | string | null = null): void {
        this.moved = false;

        this.select_input_socket(in_soc);

        if (!this.in_socket || !this.in_socket.is_linked) {
            return;
        }

        // Warning, slow! socket.links is O(total number of links)!
        const link = this.in_socket.links[0];

        this.node = link.from_node;
        this.out_socket = link.from_socket;
        this.in_socket = null;
        this.moved = true;

        // Continue moving
        if (this.node.type === 'REROUTE') {
            this.move_back(0);
        } else if (this.node.type === 'GROUP') {
            this.descend();
            this.move_back();
        } else if (this.node.type === 'GROUP_INPUT') {
            this.ascend();
            this.move_back();
        }
    }

    /**
     * Peeks backwards through an input socket without modifying self.
     */
    peek_back(in_soc: NodeSocket | number | string | null = null): NodeNav {
        const s = this.copy();
        s.select_input_socket(in_soc);
        s.move_back();
        return s;
    }

    /**
     * Gets a constant from an input socket. Returns null if non-constant.
     */
    get_constant(in_soc: NodeSocket | number | string | null = null): [any, string | null] {
        this.select_input_socket(in_soc);

        if (!this.in_socket) {
            return [null, null];
        }

        // Get constant from unlinked socket's default value
        if (!this.in_socket.is_linked) {
            if (this.in_socket.type === 'RGBA') {
                const color = Array.from(this.in_socket.default_value);
                return [color.slice(0, 3), `node_tree.${this.in_socket.path_from_id()}.default_value`];
            } else if (this.in_socket.type === 'SHADER') {
                // Treat unlinked shader sockets as black
                return [[0.0, 0.0, 0.0], null];
            } else if (this.in_socket.type === 'VECTOR') {
                return [Array.from(this.in_socket.default_value), null];
            } else if (this.in_socket.type === 'VALUE') {
                return [this.in_socket.default_value, `node_tree.${this.in_socket.path_from_id()}.default_value`];
            } else {
                return [null, null];
            }
        }

        // Check for a constant in the next node
        const nav = this.peek_back();
        // Dev warning: because of loopbacks, this can be an infinite loop if not careful
        // Please check all branches of your if statements
        while (true) {
            if (!nav.moved) {
                break;
            }

            if (this.in_socket.type === 'RGBA') {
                // RGB node
                if (nav.node!.type === 'RGB') {
                    const color = Array.from(nav.out_socket!.default_value);
                    return [color.slice(0, 3), `node_tree.${nav.out_socket!.path_from_id()}.default_value`];
                }
                // Ambient Occlusion node, not linked
                else if (nav.node!.type === 'AMBIENT_OCCLUSION' && !nav.node!.inputs['Color'].is_linked) {
                    const color = Array.from(nav.node!.inputs['Color'].default_value);
                    return [color.slice(0, 3), `node_tree.${nav.node!.inputs['Color'].path_from_id()}.default_value`];
                }
                // Ambient Occlusion node, linked, so check the next node
                else if (nav.node!.type === "AMBIENT_OCCLUSION" && nav.node!.inputs['Color'].is_linked) {
                    nav.move_back('Color');
                    continue;
                } else {
                    break;
                }
            } else if (this.in_socket.type === 'SHADER') {
                // Historically, we manage RGB node plugged into a shader socket (output node)
                if (nav.node!.type === 'RGB') {
                    const color = Array.from(nav.out_socket!.default_value);
                    return [color.slice(0, 3), `node_tree.${nav.out_socket!.path_from_id()}.default_value`];
                }
                // Ambient Occlusion node, not linked
                else if (nav.node!.type === 'AMBIENT_OCCLUSION' && !nav.node!.inputs['Color'].is_linked) {
                    const color = Array.from(nav.node!.inputs['Color'].default_value);
                    return [color.slice(0, 3), `node_tree.${nav.node!.inputs['Color'].path_from_id()}.default_value`];
                }
                // Ambient Occlusion node, linked, so check the next node
                else if (nav.node!.type === "AMBIENT_OCCLUSION" && nav.node!.inputs['Color'].is_linked) {
                    nav.move_back('Color');
                    continue;
                } else {
                    break;
                }
            } else if (this.in_socket.type === 'VALUE') {
                if (nav.node!.type === 'VALUE') {
                    return [nav.out_socket!.default_value, `node_tree.${nav.out_socket!.path_from_id()}.default_value`];
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return [null, null];
    }

    /**
     * Gets a factor, eg. metallicFactor. Either a constant or constant multiplier.
     */
    get_factor(in_soc: NodeSocket | number | string | null = null): [any, string | null] {
        this.select_input_socket(in_soc);

        if (!this.in_socket) {
            return [null, null];
        }

        // Constant
        const [fac, path] = this.get_constant();
        if (fac !== null) {
            return [fac, path];
        }

        // Multiplied by constant
        const nav = this.peek_back();
        if (nav.moved) {
            let x1: any = null, x2: any = null;
            let path_1: string | null = null, path_2: string | null = null;

            if (this.in_socket.type === 'RGBA') {
                const is_mul = (
                    nav.node!.type === 'MIX' &&
                    nav.node!.data_type === 'RGBA' &&
                    nav.node!.blend_type === 'MULTIPLY'
                );
                if (is_mul) {
                    // TODO: check factor is 1?
                    [x1, path_1] = nav.get_constant('#A_Color');
                    [x2, path_2] = nav.get_constant('#B_Color');
                }
            } else if (this.in_socket.type === 'VALUE') {
                if (nav.node!.type === 'MATH' && nav.node!.operation === 'MULTIPLY') {
                    [x1, path_1] = nav.get_constant(0);
                    [x2, path_2] = nav.get_constant(1);
                }
            }

            if (x1 !== null && x2 === null) {
                return [x1, path_1];
            }
            if (x2 !== null && x1 === null) {
                return [x2, path_2];
            }
        }

        return [null, null];
    }
}

/**
 * Gather information about factor and vertex color from the Color socket
 * The general form for color is
 *   color = factor * color attribute * texture
 */
export function gather_color_info(color_nav: NodeNav): {
    colorFactor: number[] | null;
    colorAttrib: string | null;
    colorAttribType: string | null;
    colorPath: string | null;
} {
    const info = {
        colorFactor: null as number[] | null,
        colorAttrib: null as string | null,
        colorAttribType: null as string | null,
        colorPath: null as string | null,
    };

    // Reads the factor and color attribute by checking for variations on
    // -> [Multiply by Factor] -> [Multiply by Color Attrib] ->

    for (let i = 0; i < 2; i++) {  // Twice, to handle both factor and attrib
        // No factor found yet?
        if (info.colorFactor === null) {
            const [a, color_path] = color_nav.get_constant();
            if (a !== null) {
                info.colorFactor = a.slice(0, 3);
                info.colorPath = color_path;
                break;
            }

            const [a2, color_path2] = detect_multiply_by_constant(color_nav);
            if (a2 !== null) {
                info.colorFactor = a2.slice(0, 3);
                info.colorPath = color_path2;
                continue;
            }
        }

        // No color attrib found yet?
        if (info.colorAttrib === null) {
            let attr = get_color_attrib(color_nav);
            if (attr !== null) {
                info.colorAttrib = attr;
                info.colorAttribType = attr === "" ? 'active' : 'name';
                break;
            }

            attr = detect_multiply_by_color_attrib(color_nav);
            if (attr !== null) {
                info.colorAttrib = attr;
                info.colorAttribType = attr === "" ? 'active' : 'name';
                continue;
            }
        }

        break;
    }

    return info;
}

/**
 * Gather information about alpha from the Alpha socket. Alpha has the
 * general form
 *
 *  alpha = alpha_clip(factor * color attribute * texture)
 *
 * Alpha mode is determined by the nodes too (previously it used the
 * Eevee blend_method).
 */
export function gather_alpha_info(alpha_nav: NodeNav | null): {
    alphaMode: string | null;
    alphaCutoff: number | null;
    alphaFactor: number | null;
    alphaColorAttrib: string | null;
    alphaColorAttribType: string | null;
    alphaPath: string | null;
} {
    const info = {
        alphaMode: null as string | null,
        alphaCutoff: null as number | null,
        alphaFactor: null as number | null,
        alphaColorAttrib: null as string | null,
        alphaColorAttribType: null as string | null,
        alphaPath: null as string | null,
    };

    if (!alpha_nav) {
        return info;
    }

    // Opaque?
    const [c, alpha_path] = alpha_nav.get_constant();
    if (c === 1) {
        info.alphaMode = 'OPAQUE';
        return info;
    }

    // Check for alpha clipping
    const cutoff = detect_alpha_clip(alpha_nav);
    if (cutoff !== null) {
        info.alphaMode = 'MASK';
        info.alphaCutoff = cutoff;
    }

    // Reads the factor and color attribute by checking for variations on
    // -> [Multiply by Factor] -> [Multiply by Color Attrib Alpha] ->

    for (let i = 0; i < 2; i++) {  // Twice, to handle both factor and attrib
        // No factor found yet?
        if (info.alphaFactor === null) {
            const [a, alpha_path] = alpha_nav.get_constant();
            if (a !== null) {
                info.alphaFactor = a;
                info.alphaPath = alpha_path;
                break;
            }

            const [a2, alpha_path2] = detect_multiply_by_constant(alpha_nav);
            if (a2 !== null) {
                info.alphaFactor = a2;
                info.alphaPath = alpha_path2;
                continue;
            }
        }

        // No color attrib found yet?
        if (info.alphaColorAttrib === null) {
            let attr = get_color_attrib(alpha_nav);
            if (attr !== null) {
                info.alphaColorAttrib = attr;
                info.alphaColorAttribType = attr === "" ? 'active' : 'name';
                break;
            }

            attr = detect_multiply_by_color_attrib(alpha_nav);
            if (attr !== null) {
                info.alphaColorAttrib = attr;
                info.alphaColorAttribType = attr === "" ? 'active' : 'name';
                continue;
            }
        }

        break;
    }

    // Set alpha mode
    if (info.alphaMode === null) {
        // Is zero? Weird, but okay.
        if (info.alphaFactor === 0) {
            info.alphaMode = 'MASK';
            info.alphaCutoff = 0.5;
        } else {
            info.alphaMode = 'BLEND';
        }
    }

    return info;
}

/**
 * Detects a node setup for doing alpha clip/mask, ie.
 *
 * alpha = alpha >= cutoff ? 1.0 : 0.0
 *
 * If detected, alpha_nav is advanced to point to the new Alpha socket
 * and the alphaCutoff value is returned. Otherwise, returns null.
 *
 * Nodes will look like:
 *  Alpha -> [Math:Round] -> Alpha Socket
 *  Alpha -> [Math:X < cutoff] -> [Math:1 - X] -> Alpha Socket
 *  Alpha -> [X > cutoff] -> Alpha Socket (Wrong, but backwards compatible with legacy)
 */
function detect_alpha_clip(alpha_nav: NodeNav): number | null {
    const nav = alpha_nav.peek_back();
    if (!nav.moved) {
        return null;
    }

    // Detect [Math:Round]
    if (nav.node!.type === 'MATH' && nav.node!.operation === 'ROUND') {
        nav.select_input_socket(0);
        alpha_nav.assign(nav);
        return 0.5;
    }

    // Detect 1 - (X < cutoff)
    // (There is no >= node)
    if (nav.node!.type === 'MATH' && nav.node!.operation === 'SUBTRACT') {
        if (nav.get_constant(0)[0] === 1.0) {
            const nav2 = nav.peek_back(1);
            if (nav2.moved && nav2.node!.type === 'MATH') {
                const in0 = nav2.get_constant(0)[0];
                const in1 = nav2.get_constant(1)[0];
                // X < cutoff
                if (nav2.node!.operation === 'LESS_THAN' && in0 === null && in1 !== null) {
                    nav2.select_input_socket(0);
                    alpha_nav.assign(nav2);
                    return in1;
                }
                // cutoff > X
                else if (nav2.node!.operation === 'GREATER_THAN' && in0 !== null && in1 === null) {
                    nav2.select_input_socket(1);
                    alpha_nav.assign(nav2);
                    return in0;
                }
            }
        }
    }

    // Detect (X > cutoff)
    // Wrong when X = cutoff, but backwards compatible with legacy
    // Alpha Clip setup
    if (nav.node!.type === 'MATH') {
        const in0 = nav.get_constant(0)[0];
        const in1 = nav.get_constant(1)[0];
        if (nav.node!.operation === 'GREATER_THAN' && in1 !== null) {
            nav.select_input_socket(0);
            alpha_nav.assign(nav);
            return in1;
        } else if (nav.node!.operation === 'LESS_THAN' && in0 !== null) {
            nav.select_input_socket(1);
            alpha_nav.assign(nav);
            return in0;
        }
    }

    return null;
}

/**
 * When nav connects to a multiply node (A*B), returns NodeNavs that
 * point at both factors (A, B). Otherwise, returns null, null.
 *
 * Works for both colors and floats.
 */
export function get_multiply_factors(nav: NodeNav): [NodeNav | null, NodeNav | null] {
    const prev = nav.peek_back();
    if (prev.moved) {
        if (nav.in_socket!.type === 'RGBA') {
            const is_mul = (
                prev.node!.type === 'MIX' &&
                prev.node!.data_type === 'RGBA' &&
                prev.node!.blend_type === 'MULTIPLY' &&
                prev.get_constant('Factor')[0] === 1
            );
            if (is_mul) {
                const fac1 = prev;
                fac1.select_input_socket('#A_Color');
                const fac2 = prev.copy();
                fac2.select_input_socket('#B_Color');

                return [fac1, fac2];
            }
        } else if (nav.in_socket!.type === 'VALUE') {
            if (prev.node!.type === 'MATH' && prev.node!.operation === 'MULTIPLY') {
                const fac1 = prev;
                fac1.select_input_socket(0);
                const fac2 = prev.copy();
                fac2.select_input_socket(1);

                return [fac1, fac2];
            }
        }
    }

    return [null, null];
}

/**
 * Detects if nav is multiplied by a constant. If detected, the constant
 * is returned, and nav is advanced to the other factor in the
 * multiplication. Otherwise, returns null.
 */
function detect_multiply_by_constant(nav: NodeNav): [any, string | null] {
    const [fac1, fac2] = get_multiply_factors(nav);
    if (fac1 === null) {
        return [null, null];
    }

    const [c, alpha_path] = fac1.get_constant();
    if (c !== null) {
        nav.assign(fac2!);
        return [c, alpha_path];
    }

    // Try other order too
    const [c2, alpha_path2] = fac2!.get_constant();
    if (c2 !== null) {
        nav.assign(fac1);
        return [c2, alpha_path2];
    }

    return [null, null];
}

/**
 * Detects if nav is multiplied by a color attribute. If detected, the
 * color attribute name is returned, and nav is advanced to the other
 * factor in the multiplication. Otherwise, returns null.
 *
 * Note: ignores whether the multiplication is by the attribute's RGB or
 * Alpha.
 */
function detect_multiply_by_color_attrib(nav: NodeNav): string | null {
    const [fac1, fac2] = get_multiply_factors(nav);
    if (fac1 === null) {
        return null;
    }

    let attr = get_color_attrib(fac1);
    if (attr !== null) {
        nav.assign(fac2!);
        return attr;
    }

    // Try other order too
    attr = get_color_attrib(fac2!);
    if (attr !== null) {
        nav.assign(fac1);
        return attr;
    }

    return null;
}

/**
 * Checks if nav connects to a Color Attribute node. An Attribute node is
 * also accepted, but there's no check that the attribute is actually a
 * *color* attribute in that case.
 *
 * Returns the name of the color attribute if detected. Note that a blank
 * name, "", means to use the mesh's active render color attribute.
 * Otherwise, returns null.
 */
export function get_color_attrib(nav: NodeNav): string | null {
    const navCopy = nav.peek_back();
    if (!navCopy.moved) {
        return null;
    }

    if (navCopy.node!.type === 'VERTEX_COLOR') {
        return navCopy.node!.layer_name;
    }

    if (navCopy.node!.type === 'ATTRIBUTE') {
        if (navCopy.node!.attribute_type === 'GEOMETRY') {
            // Does NOT use color attribute when blank
            const name = navCopy.node!.attribute_name;
            return name;  // Fixed name or "" for active color
        }
    }

    return null;
}

export class NodeSocket {
    socket: NodeSocket | null;
    group_path: Node[];

    constructor(socket: NodeSocket | null, group_path: Node[]) {
        this.socket = socket;
        this.group_path = group_path;
    }

    to_node_nav(): NodeNav {
        console.assert(this.socket);
        const nav = new NodeNav(
            this.socket!.node,
            this.socket!.is_output ? null : this.socket,
            this.socket!.is_output ? this.socket : null
        );
        // No output socket information
        nav.stack = this.group_path.map(node => [node, null]);
        return nav;
    }
}

class ShNode {
    node: Node | null;
    group_path: Node[];

    constructor(node: Node | null, group_path: Node[]) {
        this.node = node;
        this.group_path = group_path;
    }
}

/**
 * For a given material input name, retrieve the corresponding node tree socket for a given node type.
 *
 * @param blender_material_node_tree - a blender material node tree for which to get the socket
 * @param type - the node type
 * @param name - the socket name
 * @returns a blender NodeSocket for a given type
 */
export function get_node_socket(blender_material_node_tree: NodeTree, type: any, name: string): NodeSocket {
    let nodes = get_material_nodes(blender_material_node_tree, [blender_material_node_tree], type);
    // TODOSNode : Why checking outputs[0] ? What about alpha for texture node, that is outputs[1] ????
    nodes = nodes.filter(node => check_if_is_linked_to_active_output(node[0].outputs[0], node[1]));
    const inputs: [NodeSocket, Node[]][] = nodes.flatMap(node =>
        node[0].inputs.filter(input => input.name === name).map(input => [input, node[1]] as [NodeSocket, Node[]])
    );
    if (inputs.length > 0) {
        return new NodeSocket(inputs[0][0], inputs[0][1]);
    }
    return new NodeSocket(null, null);
}

/**
 * For a given material input name, retrieve the corresponding node tree socket.
 *
 * @param blender_material_nodetree - a blender material node tree for which to get the socket
 * @param use_nodes - whether to use nodes
 * @param name - the name of the socket
 * @param volume - whether this is for volume
 * @returns a blender NodeSocket
 */
export function get_socket(
    blender_material_nodetree: NodeTree,
    use_nodes: boolean,
    name: string,
    volume: boolean = false
): NodeSocket {
    if (blender_material_nodetree && use_nodes) {
        // i = [input for input in blender_material.node_tree.inputs]
        // o = [output for output in blender_material.node_tree.outputs]
        let type
        if (name === "Emissive") {
            // Check for a dedicated Emission node first, it must supersede the newer built-in one
            // because the newer one is always present in all Principled BSDF materials.
            const emissive_socket = get_node_socket(blender_material_nodetree, 'ShaderNodeEmission', "Color");
            if (emissive_socket.socket !== null) {
                return emissive_socket;
            }
            // If a dedicated Emission node was not found, fall back to the Principled BSDF Emission Color socket.
            name = "Emission Color";
            type = 'ShaderNodeBsdfPrincipled';
        } else if (name === "Background") {
            type = 'ShaderNodeBackground';
            name = "Color";
        } else {
            if (volume === false) {
                type = 'ShaderNodeBsdfPrincipled';
            } else {
                type = 'ShaderNodeVolumeAbsorption';
            }
        }

        return get_node_socket(blender_material_nodetree, type, name);
    }

    return new NodeSocket(null, null);
}

// Old, prefer NodeNav.get_factor in new code
export function get_factor_from_socket(socket: NodeSocket, kind: string): [any, string | null] {
    return socket.to_node_nav().get_factor();
}

// Old, prefer NodeNav.get_constant in new code
export function get_const_from_socket(socket: NodeSocket, kind: string): [any, string | null] {
    return socket.to_node_nav().get_constant();
}

function previous_socket(socket: NodeSocket): NodeSocket {
    let soc = socket.socket;
    let group_path = [...socket.group_path];

    while (true) {
        if (!soc || !soc.is_linked) {
            return new NodeSocket(null, null);
        }

        const from_socket = soc.links[0].from_socket;

        // If we are entering a node group (from outputs)
        if (from_socket.node.type === "GROUP") {
            const socket_name = from_socket.name;
            const group_output_nodes = from_socket.node.node_tree.nodes.filter(n => n.type === "GROUP_OUTPUT");
            const sockets = group_output_nodes[0].inputs;
            const socket = sockets.find(s => s.name === socket_name)!;
            group_path.push(from_socket.node);
            soc = socket;
            continue;
        }

        // If we are exiting a node group (from inputs)
        if (from_socket.node.type === "GROUP_INPUT") {
            const socket_name = from_socket.name;
            const sockets = group_path[group_path.length - 1].inputs;
            const socket = sockets.find(s => s.name === socket_name)!;
            group_path = group_path.slice(0, -1);
            soc = socket;
            continue;
        }

        // Skip over reroute nodes
        if (from_socket.node.type === 'REROUTE') {
            soc = from_socket.node.inputs[0];
            continue;
        }

        return new NodeSocket(from_socket, group_path);
    }
}

function previous_node(socket: NodeSocket): ShNode {
    const prev_socket = previous_socket(socket);
    if (prev_socket.socket !== null) {
        return new ShNode(prev_socket.socket.node, prev_socket.group_path);
    }
    return new ShNode(null, null);
}

export function get_texture_transform_from_mapping_node(mapping_node: ShNode, export_settings: any): any {
    if (!["TEXTURE", "POINT", "VECTOR"].includes(mapping_node.node!.vector_type)) {
        export_settings['log'].warning(
            "Skipping exporting texture transform because it had type " +
            mapping_node.node!.vector_type + "; recommend using POINT instead"
        );
        return null;
    }

    const rotation_0 = mapping_node.node!.inputs['Rotation'].default_value[0];
    const rotation_1 = mapping_node.node!.inputs['Rotation'].default_value[1];
    if (rotation_0 || rotation_1) {
        // TODO: can we handle this?
        export_settings['log'].warning(
            "Skipping exporting texture transform because it had non-zero " +
            "rotations in the X/Y direction; only a Z rotation can be exported!"
        );
        return null;
    }

    const mapping_transform: any = {};
    if (mapping_node.node!.vector_type !== "VECTOR") {
        mapping_transform["offset"] = [
            mapping_node.node!.inputs['Location'].default_value[0],
            mapping_node.node!.inputs['Location'].default_value[1]
        ];
    }
    mapping_transform["rotation"] = mapping_node.node!.inputs['Rotation'].default_value[2];
    mapping_transform["scale"] = [
        mapping_node.node!.inputs['Scale'].default_value[0],
        mapping_node.node!.inputs['Scale'].default_value[1]
    ];

    if (mapping_node.node!.vector_type === "TEXTURE") {
        const inverted = inverted_trs_mapping_node(mapping_transform);
        if (inverted === null) {
            export_settings['log'].warning(
                "Skipping exporting texture transform with type TEXTURE because " +
                "we couldn't convert it to TRS; recommend using POINT instead"
            );
            return null;
        }
        Object.assign(mapping_transform, inverted);
    } else if (mapping_node.node!.vector_type === "VECTOR") {
        // Vectors don't get translated
        mapping_transform["offset"] = [0, 0];
    }

    const texture_transform = texture_transform_blender_to_gltf(mapping_transform);

    if (texture_transform["offset"] && texture_transform["offset"].every((component: number) => component === 0)) {
        delete texture_transform["offset"];
    }
    if (texture_transform["scale"] && texture_transform["scale"].every((component: number) => component === 1)) {
        delete texture_transform["scale"];
    }
    if (texture_transform["rotation"] === 0) {
        delete texture_transform["rotation"];
    }

    // glTF Offset needs: offset, rotation, scale (note that Offset is not used for Vector mapping)
    // glTF Rotation needs: rotation
    // glTF Scale needs: scale

    if (mapping_node.node!.vector_type !== "VECTOR") {
        const path_: any = {};
        path_['length'] = 2;
        path_['path'] = "/materials/XXX/YYY/KHR_texture_transform/offset";
        path_['vector_type'] = mapping_node.node!.vector_type;
        export_settings['current_texture_transform'][
            `node_tree.${mapping_node.node!.inputs['Location'].path_from_id()}.default_value`
            ] = path_;
    }

    const path_scale: any = {};
    path_scale['length'] = 2;
    path_scale['path'] = "/materials/XXX/YYY/KHR_texture_transform/scale";
    path_scale['vector_type'] = mapping_node.node!.vector_type;
    export_settings['current_texture_transform'][
        `node_tree.${mapping_node.node!.inputs['Scale'].path_from_id()}.default_value`
        ] = path_scale;

    const path_rotation: any = {};
    path_rotation['length'] = 1;
    path_rotation['path'] = "/materials/XXX/YYY/KHR_texture_transform/rotation";
    path_rotation['vector_type'] = mapping_node.node!.vector_type;
    export_settings['current_texture_transform'][
        `node_tree.${mapping_node.node!.inputs['Rotation'].path_from_id()}.default_value[2]`
        ] = path_rotation;

    return texture_transform;
}

function check_if_is_linked_to_active_output(shader_socket: NodeSocket, group_path: Node[]): boolean {
    // Here, group_path must be copied, because if there are multiply link that enter/exit a group node
    // This will modify it, and we don't want to modify the original group_path (from the parameter) inside the loop
    for (const link of shader_socket.links) {
        // If we are entering a node group
        if (link.to_node.type === "GROUP") {
            const socket_name = link.to_socket.name;
            const group_input_nodes = link.to_node.node_tree.nodes.filter(n => n.type === "GROUP_INPUT");
            const sockets = group_input_nodes[0].outputs;
            const socket = sockets.find(s => s.name === socket_name)!;
            const new_group_path = [...group_path];
            new_group_path.push(link.to_node);
            // TODOSNode : Why checking outputs[0] ? What about alpha for texture node, that is outputs[1] ????
            // recursive until find an output material node
            const ret = check_if_is_linked_to_active_output(socket, new_group_path);
            if (ret === true) {
                return true;
            }
            continue;
        }

        // If we are exiting a node group
        if (link.to_node.type === "GROUP_OUTPUT") {
            const socket_name = link.to_socket.name;
            const sockets = group_path[group_path.length - 1].outputs;
            const socket = sockets.find(s => s.name === socket_name)!;
            const new_group_path = group_path.slice(0, -1);
            // TODOSNode : Why checking outputs[0] ? What about alpha for texture node, that is outputs[1] ????
            // recursive until find an output material node
            const ret = check_if_is_linked_to_active_output(socket, new_group_path);
            if (ret === true) {
                return true;
            }
            continue;
        }

        if (link.to_node.type === 'ShaderNodeOutputMaterial' && link.to_node.is_active_output === true) {
            return true;
        }

        if (link.to_node.outputs.length > 0) {  // ignore non active output, not having output sockets
            // TODOSNode : Why checking outputs[0] ? What about alpha for texture node, that is outputs[1] ????
            const ret = check_if_is_linked_to_active_output(
                link.to_node.outputs[0],
                group_path
            );  // recursive until find an output material node
            if (ret === true) {
                return true;
            }
        }
    }

    return false;
}

export function get_attribute_name(socket: NodeSocket, export_settings: any): [boolean, string | null, boolean | null] {
    const node = previous_node(socket);
    if (node.node !== null && node.node.type === "ATTRIBUTE" &&
        node.node.attribute_type === "GEOMETRY" &&
        node.node.attribute_name !== null &&
        node.node.attribute_name !== "") {
        return [true, node.node.attribute_name, null];
    } else if (node.node !== null && node.node.type === "ATTRIBUTE" &&
        node.node.attribute_type === "GEOMETRY" &&
        node.node.attribute_name === "") {
        return [true, null, true];
    }

    if (node.node !== null && node.node.type === "VERTEX_COLOR" &&
        node.node.layer_name !== null &&
        node.node.layer_name !== "") {
        return [true, node.node.layer_name, null];
    } else if (node.node !== null && node.node.type === "VERTEX_COLOR" &&
        node.node.layer_name === "") {
        return [true, null, true];
    }

    return [false, null, null];
}

/**
 * Detects if the material uses anisotropy and returns the corresponding data.
 *
 * @param anisotropy_socket - the anisotropy socket
 * @param anisotropy_rotation_socket - the anisotropy rotation socket
 * @param anisotropy_tangent_socket - the anisotropy tangent socket
 * @param export_settings - the export settings
 * @returns a tuple (is_anisotropy, anisotropy_data)
 */
function detect_anisotropy_nodes(
    anisotropy_socket: NodeSocket,
    anisotropy_rotation_socket: NodeSocket,
    anisotropy_tangent_socket: NodeSocket,
    export_settings: any
): [boolean, any] {
    if (anisotropy_socket.socket === null) {
        return [false, null];
    }
    if (anisotropy_rotation_socket.socket === null) {
        return [false, null];
    }
    if (anisotropy_tangent_socket.socket === null) {
        return [false, null];
    }

    // Check that tangent is linked to a tangent node, with UVMap as input
    const tangent_node = previous_node(anisotropy_tangent_socket);
    if (tangent_node.node === null || tangent_node.node.type !== "TANGENT") {
        return [false, null];
    }
    if (tangent_node.node.direction_type !== "UV_MAP") {
        return [false, null];
    }

    // Check that anisotropy is linked to a multiply node
    if (!anisotropy_socket.socket.is_linked) {
        return [false, null];
    }
    if (!anisotropy_rotation_socket.socket.is_linked) {
        return [false, null];
    }
    if (!anisotropy_tangent_socket.socket.is_linked) {
        return [false, null];
    }
    const anisotropy_multiply_node = anisotropy_socket.socket.links[0].from_node;
    if (anisotropy_multiply_node === null || anisotropy_multiply_node.type !== "MATH") {
        return [false, null];
    }
    if (anisotropy_multiply_node.operation !== "MULTIPLY") {
        return [false, null];
    }
    // this multiply node should have the first input linked to separate XYZ, on Z
    if (!anisotropy_multiply_node.inputs[0].is_linked) {
        return [false, null];
    }
    const separate_xyz_node = anisotropy_multiply_node.inputs[0].links[0].from_node;
    if (separate_xyz_node === null || separate_xyz_node.type !== "SEPXYZ") {
        return [false, null];
    }
    const separate_xyz_z_socket = anisotropy_multiply_node.inputs[0].links[0].from_socket;
    if (separate_xyz_z_socket.name !== "Z") {
        return [false, null];
    }
    // This separate XYZ node output should be linked to ArcTan2 node (X on inputs[1], Y on inputs[0])
    if (!separate_xyz_node.outputs[0].is_linked) {
        return [false, null];
    }
    const arctan2_node = separate_xyz_node.outputs[0].links[0].to_node;
    if (arctan2_node.type !== "MATH") {
        return [false, null];
    }
    if (arctan2_node.operation !== "ARCTAN2") {
        return [false, null];
    }
    if (arctan2_node.inputs[0].links[0].from_socket.name !== "Y") {
        return [false, null];
    }
    if (arctan2_node.inputs[1].links[0].from_socket.name !== "X") {
        return [false, null];
    }
    // This arctan2 node output should be linked to anisotropy rotation (Math add node)
    if (!arctan2_node.outputs[0].is_linked) {
        return [false, null];
    }
    const anisotropy_rotation_node = arctan2_node.outputs[0].links[0].to_node;
    if (anisotropy_rotation_node.type !== "MATH") {
        return [false, null];
    }
    if (anisotropy_rotation_node.operation !== "ADD") {
        return [false, null];
    }
    // This anisotropy rotation node should have the output linked to rotation conversion node
    if (!anisotropy_rotation_node.outputs[0].is_linked) {
        return [false, null];
    }
    const rotation_conversion_node = anisotropy_rotation_node.outputs[0].links[0].to_node;
    if (rotation_conversion_node.type !== "MATH") {
        return [false, null];
    }
    if (rotation_conversion_node.operation !== "DIVIDE") {
        return [false, null];
    }
    // This rotation conversion node should have the second input value PI
    if (Math.abs(rotation_conversion_node.inputs[1].default_value - 6.283185) > 0.0001) {
        return [false, null];
    }
    // This rotation conversion node should have the output linked to anisotropy rotation socket of Principled BSDF
    if (!rotation_conversion_node.outputs[0].is_linked) {
        return [false, null];
    }
    if (rotation_conversion_node.outputs[0].links[0].to_socket.name !== "Anisotropic Rotation") {
        return [false, null];
    }
    if (rotation_conversion_node.outputs[0].links[0].to_node.type !== "BSDF_PRINCIPLED") {
        return [false, null];
    }

    // Separate XYZ node should have the input linked to anisotropy multiply Add node (for normalization)
    if (!separate_xyz_node.inputs[0].is_linked) {
        return [false, null];
    }
    const anisotropy_multiply_add_node = separate_xyz_node.inputs[0].links[0].from_node;
    if (anisotropy_multiply_add_node.type !== "VECT_MATH") {
        return [false, null];
    }
    if (anisotropy_multiply_add_node.operation !== "MULTIPLY_ADD") {
        return [false, null];
    }
    if (!arraysEqual(anisotropy_multiply_add_node.inputs[1].default_value, [2.0, 2.0, 1.0])) {
        return [false, null];
    }
    if (!arraysEqual(anisotropy_multiply_add_node.inputs[2].default_value, [-1.0, -1.0, 0.0])) {
        return [false, null];
    }
    if (!anisotropy_multiply_add_node.inputs[0].is_linked) {
        return [false, null];
    }
    // This anisotropy multiply Add node should have the first input linked to a texture node
    const anisotropy_texture_node = anisotropy_multiply_add_node.inputs[0].links[0].from_node;
    if (anisotropy_texture_node.type !== "TEX_IMAGE") {
        return [false, null];
    }

    const tex_ok = has_image_node_from_socket(
        new NodeSocket(
            anisotropy_multiply_add_node.inputs[0],
            anisotropy_socket.group_path
        ),
        export_settings
    );
    if (tex_ok === false) {
        return [false, null];
    }

    const [strength, path_strength] = get_const_from_socket(
        new NodeSocket(
            anisotropy_multiply_node.inputs[1],
            anisotropy_socket.group_path
        ),
        'VALUE'
    );
    const [rotation, path_rotation] = get_const_from_socket(
        new NodeSocket(
            anisotropy_rotation_node.inputs[1],
            anisotropy_socket.group_path
        ),
        'VALUE'
    );

    return [true, {
        'anisotropyStrength': [strength, path_strength],
        'anisotropyRotation': [rotation, path_rotation],
        'tangent': tangent_node.node.uv_map,
        'tex_socket': new NodeSocket(anisotropy_multiply_add_node.inputs[0], anisotropy_socket.group_path),
    }];
}

// Helper function to compare arrays
function arraysEqual(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
