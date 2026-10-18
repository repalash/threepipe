import type {MeshData} from '@threepipe/mesh-kernel'

export type Vec3 = [number, number, number]

/** A JSON Schema object, in the style the modelling commands use. */
export interface PartSchema {
    type: 'object'
    properties: Record<string, {type: string, description: string, default?: unknown, minimum?: number, maximum?: number, enum?: unknown[], items?: unknown}>
    required?: string[]
    additionalProperties?: boolean
}

export interface PartResult {
    /** Editable n-gon topology, in part space (the part's axis, base at the origin unless the part says otherwise). */
    mesh: MeshData
    /** Named element sets for later edits: `knurl` faces, `top` faces, `rim` edges ... */
    groups: Record<string, {faces?: number[], edges?: number[], verts?: number[]}>
    /** Named frames to place things against, in part space. */
    anchors: Record<string, {position: Vec3, normal: Vec3}>
    /** Smooth-by-angle threshold the part is designed for, degrees. */
    smoothAngle?: number
}

export interface PartDefinition<P = Record<string, unknown>> {
    /** `product/knurled-ring` */
    id: string
    title: string
    tags: string[]
    params: PartSchema
    build(params: P): PartResult
}
