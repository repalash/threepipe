// SPDX-FileCopyrightText: 2018-2021 The glTF-Blender-IO authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Type definitions for Blender objects used in glTF export
 */

/**
 * Represents a Blender Node in the node tree
 */
export interface Node {
    typeof: string;

    name: string;
    type: string;
    mute: boolean;
    inputs: NodeSocket[];
    outputs: NodeSocket[];
    node_tree: NodeTree | null;
    is_active_output?: boolean;

    // Node-specific properties
    operation?: string;  // For MATH nodes
    vector_type?: string;  // For mapping nodes
    blend_type?: string;  // For MIX nodes
    data_type?: string;  // For MIX nodes
    attribute_type?: string;  // For ATTRIBUTE nodes
    attribute_name?: string;  // For ATTRIBUTE nodes
    layer_name?: string;  // For VERTEX_COLOR nodes
    direction_type?: string;  // For TANGENT nodes
    uv_map?: string;  // For TANGENT nodes
    image?: Image | null;  // For TEX_IMAGE nodes

    // Socket references for specific node types
    default_value?: any;

    // Path utilities
    path_from_id(): string;
}

/**
 * Represents a Blender NodeSocket
 */
export interface NodeSocket {
    name: string;
    type: string;
    identifier: string;
    node: Node;
    is_linked: boolean;
    is_output: boolean;
    links: NodeLink[];
    default_value: any;  // Can be number, number[], or other types depending on socket type

    // Path utilities
    path_from_id(): string;
}

/**
 * Represents a link between nodes
 */
export interface NodeLink {
    from_node: Node;
    to_node: Node;
    from_socket: NodeSocket;
    to_socket: NodeSocket;
}

/**
 * Represents a Blender NodeTree
 */
export interface NodeTree {
    name: string;
    nodes: Node[];
    links: NodeLink[];
    inputs: NodeSocket[];
    outputs: NodeSocket[];
}

/**
 * Represents a Blender Material
 */
export interface Material {
    name: string;
    use_nodes: boolean;
    node_tree: NodeTree; // py = node_tree

    // Non-node based properties
    diffuse_color: number[];  // RGBA array
    metallic: number;
    roughness: number;

    // Other material properties
    blend_method?: string;
    backface_culling?: boolean;
    show_transparent_back?: boolean;
    use_backface_culling?: boolean;
}

/**
 * Represents a Blender Image
 */
export interface Image {
    name: string;
    filepath: string;
    source: string;  // 'FILE', 'GENERATED', etc.
    alpha_mode: string;
    pixels: number[];  // Flattened RGBA array
    size: [number, number];  // [width, height]
    channels: number;
    is_dirty: boolean;

    // Color space
    colorspace_settings: {
        name: string;
    };
}

/**
 * Represents a Blender Object
 */
export interface BlenderObject {
    name: string;
    type: string;  // 'MESH', 'EMPTY', 'LIGHT', etc.
    data: any;  // Mesh, Light, Camera, etc.
    location: [number, number, number];
    rotation_euler: [number, number, number];
    scale: [number, number, number];
    matrix_world: number[][];  // 4x4 matrix
    parent: BlenderObject | null;
    children: BlenderObject[];
}

/**
 * Represents a Blender Mesh
 */
export interface Mesh {
    name: string;
    vertices: MeshVertex[];
    edges: MeshEdge[];
    polygons: MeshPolygon[];
    loops: MeshLoop[];
    uv_layers: UVLayer[];
    vertex_colors: VertexColorLayer[];
    materials: Material[];
}

/**
 * Represents a mesh vertex
 */
export interface MeshVertex {
    co: [number, number, number];  // Coordinates
    normal: [number, number, number];
    groups: VertexGroup[];
}

/**
 * Represents a mesh edge
 */
export interface MeshEdge {
    vertices: [number, number];  // Vertex indices
}

/**
 * Represents a mesh polygon (face)
 */
export interface MeshPolygon {
    vertices: number[];  // Vertex indices
    loop_indices: number[];
    material_index: number;
    normal: [number, number, number];
}

/**
 * Represents a mesh loop
 */
export interface MeshLoop {
    vertex_index: number;
    edge_index: number;
}

/**
 * Represents a UV layer
 */
export interface UVLayer {
    name: string;
    data: UVLoopData[];
    active: boolean;
    active_render: boolean;
}

/**
 * Represents UV data for a loop
 */
export interface UVLoopData {
    uv: [number, number];
}

/**
 * Represents a vertex color layer
 */
export interface VertexColorLayer {
    name: string;
    data: VertexColorData[];
    active: boolean;
    active_render: boolean;
}

/**
 * Represents vertex color data
 */
export interface VertexColorData {
    color: [number, number, number, number];  // RGBA
}

/**
 * Represents a vertex group
 */
export interface VertexGroup {
    group: number;  // Group index
    weight: number;  // Weight value
}

/**
 * Represents Blender context
 */
export interface Context {
    scene: Scene;
    view_layer: ViewLayer;
    active_object: BlenderObject | null;
    selected_objects: BlenderObject[];
}

/**
 * Represents a Blender Scene
 */
export interface Scene {
    name: string;
    objects: BlenderObject[];
    frame_start: number;
    frame_end: number;
    frame_current: number;
    fps: number;
}

/**
 * Represents a View Layer
 */
export interface ViewLayer {
    name: string;
    objects: BlenderObject[];
}

/**
 * Shader node type constants
 */
export const ShaderNodeTypes = {
    TEX_IMAGE: 'TEX_IMAGE',
    BSDF_PRINCIPLED: 'BSDF_PRINCIPLED',
    EMISSION: 'EMISSION',
    BACKGROUND: 'BACKGROUND',
    OUTPUT_MATERIAL: 'OUTPUT_MATERIAL',
    GROUP: 'GROUP',
    GROUP_INPUT: 'GROUP_INPUT',
    GROUP_OUTPUT: 'GROUP_OUTPUT',
    REROUTE: 'REROUTE',
    RGB: 'RGB',
    VALUE: 'VALUE',
    MATH: 'MATH',
    VECT_MATH: 'VECT_MATH',
    MIX: 'MIX',
    SEPXYZ: 'SEPXYZ',
    ATTRIBUTE: 'ATTRIBUTE',
    VERTEX_COLOR: 'VERTEX_COLOR',
    TANGENT: 'TANGENT',
    AMBIENT_OCCLUSION: 'AMBIENT_OCCLUSION',
    MAPPING: 'MAPPING',
    NORMAL_MAP: 'NORMAL_MAP',
    VOLUME_ABSORPTION: 'VOLUME_ABSORPTION'
} as const;

/**
 * Socket type constants
 */
export const SocketTypes = {
    RGBA: 'RGBA',
    VALUE: 'VALUE',
    VECTOR: 'VECTOR',
    SHADER: 'SHADER'
} as const;

/**
 * Math operation constants
 */
export const MathOperations = {
    ADD: 'ADD',
    SUBTRACT: 'SUBTRACT',
    MULTIPLY: 'MULTIPLY',
    DIVIDE: 'DIVIDE',
    ROUND: 'ROUND',
    LESS_THAN: 'LESS_THAN',
    GREATER_THAN: 'GREATER_THAN',
    ARCTAN2: 'ARCTAN2'
} as const;

/**
 * Vector math operation constants
 */
export const VectorMathOperations = {
    MULTIPLY_ADD: 'MULTIPLY_ADD'
} as const;

/**
 * Attribute type constants
 */
export const AttributeTypes = {
    GEOMETRY: 'GEOMETRY'
} as const;

/**
 * Vector type constants for mapping nodes
 */
export const VectorTypes = {
    TEXTURE: 'TEXTURE',
    POINT: 'POINT',
    VECTOR: 'VECTOR'
} as const;

/**
 * Blend type constants
 */
export const BlendTypes = {
    MULTIPLY: 'MULTIPLY'
} as const;

/**
 * Data type constants for mix nodes
 */
export const DataTypes = {
    RGBA: 'RGBA'
} as const;

/**
 * Direction type constants for tangent nodes
 */
export const DirectionTypes = {
    UV_MAP: 'UV_MAP'
} as const;

/**
 * Type guards
 */
export function isShaderNode(node: Node): boolean {
    return node.type in ShaderNodeTypes;
}

export function isNodeSocket(obj: any): obj is NodeSocket {
    return obj && typeof obj === 'object' && 'node' in obj && 'is_linked' in obj;
}

export function isMaterial(obj: any): obj is Material {
    return obj && typeof obj === 'object' && 'use_nodes' in obj && 'node_tree' in obj;
}
