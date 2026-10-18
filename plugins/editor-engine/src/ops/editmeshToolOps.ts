/**
 * Edit-mode operators over the kernel's `edbm_*_exec` wrappers (`@threepipe/mesh-kernel`'s
 * `ops/editmeshTools.ts`): Poke, Triangulate, Beautify, Wireframe, Fill, Mark Seam / Sharp, Flip and
 * Recalculate Normals, Delete Loose, Select More / Less.
 *
 * Ids, props (Blender's RNA identifiers in camelCase), defaults and descriptions are Blender's
 * (`editors/mesh/editmesh_tools.cc`, `editmesh_select.cc`; each operator cites its `MESH_OT_*`). They
 * are *session* operators (`session.ts`): one undo step each, and the redo-last panel re-runs them with
 * changed props. The menus that list them are `menus/menus.ts`; the keys are in `keymap/presets`.
 *
 * Not ported, and so not offered as props: `MESH_OT_flip_normals`' `only_clnors` (custom normals; the
 * kernel has none) and Merge's `uvs` (see `meshOps.ts`).
 */

import {
    beautifyFillSelection,
    deleteLooseSelection,
    dissolveDegenerateSelection,
    edgeCollapseSelection,
    edgeRotateSelection,
    flipNormalsSelection,
    markSeamSelection,
    markSharpSelection,
    normalsMakeConsistentSelection,
    pokeFacesSelection,
    quadsConvertToTrisSelection,
    triangleFillSelection,
    wireframeSelection,
} from '@threepipe/mesh-kernel'
import type {PokeCenterMode, TriangulateNgonMethod, TriangulateQuadMethod} from '@threepipe/mesh-kernel'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {OperatorDescriptor, PropSchema} from '../registry'
import {onlyInEditMessage} from './messages'
import {sessionOps} from './session'

const DEG = Math.PI / 180

/** `rna_enum_modifier_triangulate_quad_method_items` (`rna_modifier.cc:449`) -> the kernel's names. */
const QUAD_METHODS: Record<string, TriangulateQuadMethod> = {
    BEAUTY: 'BEAUTY', FIXED: 'FIXED', FIXED_ALTERNATE: 'ALTERNATE', SHORTEST_DIAGONAL: 'SHORT_EDGE', LONGEST_DIAGONAL: 'LONG_EDGE',
}
/** `rna_enum_modifier_triangulate_ngon_method_items`. */
const NGON_METHODS: Record<string, TriangulateNgonMethod> = {BEAUTY: 'BEAUTY', CLIP: 'EAR_CLIP'}
/** `poke_center_modes` (`editmesh_tools.cc:5407`). */
const POKE_CENTER_MODES: Record<string, PokeCenterMode> = {MEDIAN_WEIGHTED: 'meanWeighted', MEDIAN: 'mean', BOUNDS: 'bounds'}

const ok = (r: {ok: true} | {ok: false, error: string}) => r.ok ? {ok: true as const} : {ok: false as const, error: r.error}

export function registerEditmeshToolOperators(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit
    const {ready, runSession, selected} = sessionOps(engine)
    const bm = () => me.state!.bm
    const facesSelected = (what: string) => ready(selected('face', 1, what))
    const edgesSelected = (what: string) => ready(selected('edge', 1, what))

    // `MESH_OT_poke` (editmesh_tools.cc:5405)
    const pokeProps: PropSchema = {type: 'object', properties: {
        offset: {type: 'number', minimum: -1000, maximum: 1000, default: 0, description: 'Poke Offset.'},
        useRelativeOffset: {type: 'boolean', default: false, description: 'Offset Relative: scale the offset by surrounding geometry.'},
        centerMode: {type: 'string', enum: Object.keys(POKE_CENTER_MODES), default: 'MEDIAN_WEIGHTED',
            description: 'Poke Center: poke face center calculation - Weighted Median, Median or Bounds.'},
    }}
    // `MESH_OT_quads_convert_to_tris` (:5510)
    const triangulateProps: PropSchema = {type: 'object', properties: {
        quadMethod: {type: 'string', enum: Object.keys(QUAD_METHODS), default: 'BEAUTY', description: 'Quad Method: method for splitting the quads into triangles.'},
        ngonMethod: {type: 'string', enum: Object.keys(NGON_METHODS), default: 'BEAUTY', description: 'N-gon Method: method for splitting the n-gons into triangles.'},
    }}
    // `MESH_OT_beautify_fill` (:5319); Blender stores radians and shows degrees, as the panel does.
    const beautifyProps: PropSchema = {type: 'object', properties: {
        angleLimit: {type: 'number', minimum: 0, maximum: 180, default: 180, description: 'Max Angle (degrees): angle limit.'},
    }}
    // `MESH_OT_wireframe` (:7682)
    const wireframeProps: PropSchema = {type: 'object', properties: {
        useBoundary: {type: 'boolean', default: true, description: 'Boundary: inset face boundaries.'},
        useEvenOffset: {type: 'boolean', default: true, description: 'Offset Even: scale the offset to give more even thickness.'},
        useRelativeOffset: {type: 'boolean', default: false, description: 'Offset Relative: scale the offset by surrounding geometry.'},
        useReplace: {type: 'boolean', default: true, description: 'Replace: remove original faces.'},
        thickness: {type: 'number', minimum: 0, maximum: 10000, default: 0.01, description: 'Thickness.'},
        offset: {type: 'number', minimum: 0, maximum: 10000, default: 0.01, description: 'Offset.'},
        useCrease: {type: 'boolean', default: false, description: 'Crease: crease hub edges for an improved subdivision surface.'},
        creaseWeight: {type: 'number', minimum: 0, maximum: 1000, default: 0.01, description: 'Crease Weight.'},
    }}
    // `MESH_OT_fill` (:4742)
    const fillProps: PropSchema = {type: 'object', properties: {
        useBeauty: {type: 'boolean', default: true, description: 'Beauty: use best triangulation division.'},
    }}
    // `MESH_OT_mark_seam` (:1088): `clear` is PROP_HIDDEN | PROP_SKIP_SAVE (the menu entry sets it).
    const markSeamProps: PropSchema = {type: 'object', properties: {
        clear: {type: 'boolean', default: false, hidden: true, description: 'Clear.'},
    }}
    // `MESH_OT_mark_sharp` (:1161)
    const markSharpProps: PropSchema = {type: 'object', properties: {
        clear: {type: 'boolean', default: false, hidden: true, description: 'Clear.'},
        useVerts: {type: 'boolean', default: false, description: 'Vertices: consider vertices instead of edges to select which edges to (un)tag as sharp.'},
    }}
    // `MESH_OT_normals_make_consistent` (:2710)
    const recalcProps: PropSchema = {type: 'object', properties: {
        inside: {type: 'boolean', default: false, description: 'Inside.'},
    }}
    // `MESH_OT_delete_loose` (:663)
    const deleteLooseProps: PropSchema = {type: 'object', properties: {
        useVerts: {type: 'boolean', default: true, description: 'Vertices: remove loose vertices.'},
        useEdges: {type: 'boolean', default: true, description: 'Edges: remove loose edges.'},
        useFaces: {type: 'boolean', default: false, description: 'Faces: remove loose faces.'},
    }}
    // `MESH_OT_edge_rotate` (:2507)
    const edgeRotateProps: PropSchema = {type: 'object', properties: {
        useCcw: {type: 'boolean', default: false, description: 'Counter Clockwise.'},
    }}
    // `MESH_OT_dissolve_degenerate` (:6512)
    const degenerateProps: PropSchema = {type: 'object', properties: {
        threshold: {type: 'number', minimum: 1e-6, maximum: 50, default: 1e-4, description: 'Merge Distance: maximum distance between elements to merge.'},
    }}
    // `MESH_OT_select_more` / `_less` (editmesh_select.cc:4971, :5020)
    const faceStepProps: PropSchema = {type: 'object', properties: {
        useFaceStep: {type: 'boolean', default: true, description: 'Face Step: connected faces (instead of edges).'},
    }}

    const ops: OperatorDescriptor[] = [
        {
            id: 'mesh.poke', label: 'Poke Faces', icon: 'asterisk', category: 'Mesh', modes: ['edit'],
            description: 'Split each selected face into a fan of triangles around a new centre vertex.',
            flags: {undo: true, register: true},
            props: pokeProps,
            poll: facesSelected('Select the faces to poke first'),
            exec: runSession('Poke Faces', pokeProps, p => ok(pokeFacesSelection(bm(), {
                offset: Number(p.offset), useRelativeOffset: !!p.useRelativeOffset,
                centerMode: POKE_CENTER_MODES[String(p.centerMode)] ?? 'meanWeighted',
            }))),
        },
        {
            id: 'mesh.quads_convert_to_tris', label: 'Triangulate Faces', icon: 'symbol-triangle-up', category: 'Mesh', modes: ['edit'],
            description: 'Split the selected quads and n-gons into triangles (Blender\'s Ctrl+T).',
            flags: {undo: true, register: true},
            props: triangulateProps,
            poll: facesSelected('Select the faces to triangulate first'),
            exec: runSession('Triangulate Faces', triangulateProps, p => ok(quadsConvertToTrisSelection(bm(),
                QUAD_METHODS[String(p.quadMethod)] ?? 'BEAUTY', NGON_METHODS[String(p.ngonMethod)] ?? 'BEAUTY'))),
        },
        {
            id: 'mesh.beautify_fill', label: 'Beautify Faces', icon: 'clean', category: 'Mesh', modes: ['edit'],
            description: 'Rotate the edges between selected triangles until the triangles are as evenly shaped as they can be.',
            flags: {undo: true, register: true},
            props: beautifyProps,
            poll: facesSelected('Select the triangles to beautify first'),
            exec: runSession('Beautify Faces', beautifyProps, p => ok(beautifyFillSelection(bm(), Number(p.angleLimit) * DEG))),
        },
        {
            id: 'mesh.wireframe', label: 'Wireframe', icon: 'grid', category: 'Mesh', modes: ['edit'],
            description: 'Turn the edges of the selected faces into solid struts - a lattice or cage. Thickness and offset in the panel.',
            flags: {undo: true, register: true},
            props: wireframeProps,
            poll: facesSelected('Select the faces to make a wireframe of first'),
            exec: runSession('Wireframe', wireframeProps, p => ok(wireframeSelection(bm(), {
                useBoundary: !!p.useBoundary, useEvenOffset: !!p.useEvenOffset, useRelativeOffset: !!p.useRelativeOffset,
                useReplace: !!p.useReplace, thickness: Number(p.thickness), offset: Number(p.offset),
                useCrease: !!p.useCrease, creaseWeight: Number(p.creaseWeight),
            }))),
        },
        {
            id: 'mesh.fill', label: 'Fill', icon: 'polygon-filter', category: 'Mesh', modes: ['edit'],
            description: 'Fill the closed loops of selected edges with triangles (Blender\'s Alt+F). Make Edge/Face (F) makes one n-gon instead.',
            flags: {undo: true, register: true},
            props: fillProps,
            poll: edgesSelected('Select a closed loop of edges to fill first'),
            exec: runSession('Fill', fillProps, p => ok(triangleFillSelection(bm(), !!p.useBeauty))),
        },
        {
            id: 'mesh.mark_seam', label: 'Mark Seam', icon: 'cut', category: 'Mesh', modes: ['edit'],
            description: '(Un)mark the selected edges as UV seams.',
            flags: {undo: true, register: true},
            props: markSeamProps,
            poll: edgesSelected('Select the edges to mark first'),
            exec: runSession('Mark Seam', markSeamProps, p => {
                const r = markSeamSelection(bm(), !!p.clear)
                return r.ok ? {ok: true, label: p.clear ? 'Clear Seam' : 'Mark Seam'} : r
            }),
        },
        {
            id: 'mesh.mark_sharp', label: 'Mark Sharp', icon: 'symbol-diamond', category: 'Mesh', modes: ['edit'],
            description: '(Un)mark the selected edges as sharp (the mesh\'s sharp_edge attribute).',
            flags: {undo: true, register: true},
            props: markSharpProps,
            poll: ready(ctx => {
                if (!me.state) return onlyInEditMessage(engine)
                // Unset, `use_verts` is false; a menu entry passes it.
                return me.state.bm.totvertsel > 0 || (ctx.selectMode === 'vertex' ? 'Select vertices first' : 'Select the edges to mark first')
            }),
            exec: runSession('Mark Sharp', markSharpProps, p => {
                const r = markSharpSelection(bm(), !!p.clear, !!p.useVerts)
                return r.ok ? {ok: true, label: p.clear ? 'Clear Sharp' : 'Mark Sharp'} : r
            }),
        },
        {
            id: 'mesh.flip_normals', label: 'Flip Normals', icon: 'swap-vertical', category: 'Mesh', modes: ['edit'],
            description: 'Flip the direction of the selected faces\' normals (and of their vertices).',
            flags: {undo: true, register: true},
            poll: facesSelected('Select the faces to flip first'),
            exec: runSession('Flip Normals', undefined, () => ok(flipNormalsSelection(bm()))),
        },
        {
            id: 'mesh.normals_make_consistent', label: 'Recalculate Normals', icon: 'arrows-vertical', category: 'Mesh', modes: ['edit'],
            description: 'Make the selected faces\' normals point consistently outside (or, with Inside, inside) the mesh (Blender\'s Shift+N).',
            flags: {undo: true, register: true},
            props: recalcProps,
            poll: facesSelected('Select the faces to recalculate first (A selects everything)'),
            exec: runSession('Recalculate Normals', recalcProps, p => ok(normalsMakeConsistentSelection(bm(), !!p.inside))),
        },
        {
            id: 'mesh.delete_loose', label: 'Delete Loose', icon: 'eraser', category: 'Mesh', modes: ['edit'],
            description: 'Delete the selected vertices with no edges and edges with no faces (and, with Faces, faces joined to nothing).',
            flags: {undo: true, register: true},
            props: deleteLooseProps,
            poll: ready(selected('vert', 1, 'Select the part to clean up first (A selects everything)')),
            exec: runSession('Delete Loose', deleteLooseProps, p => {
                const r = deleteLooseSelection(bm(), {useVerts: !!p.useVerts, useEdges: !!p.useEdges, useFaces: !!p.useFaces})
                if (!r.ok) return r
                // `edbm_report_delete_info` (editmesh_tools.cc:433).
                const [v, e, f] = r.removed
                return {ok: true, message: `Removed: ${v} vertices, ${e} edges, ${f} faces`}
            }),
        },
        {
            id: 'mesh.edge_collapse', label: 'Collapse Edges & Faces', icon: 'collapse-all', category: 'Mesh', modes: ['edit'],
            description: 'Collapse each connected group of selected edges (or faces) into one vertex, merging UVs and colours.',
            flags: {undo: true, register: true},
            poll: edgesSelected('Select the edges or faces to collapse first'),
            exec: runSession('Collapse Edges & Faces', undefined, () => ok(edgeCollapseSelection(bm()))),
        },
        {
            id: 'mesh.edge_rotate', label: 'Rotate Selected Edge', icon: 'refresh', category: 'Mesh', modes: ['edit'],
            description: 'Rotate the selected edges (or the edges between two selected faces) to join the other corners of their two faces.',
            flags: {undo: true, register: true},
            props: edgeRotateProps,
            poll: edgesSelected('Select edges or face pairs for edge loops to rotate about'),
            exec: runSession('Rotate Selected Edge', edgeRotateProps, p => {
                const r = edgeRotateSelection(bm(), !!p.useCcw)
                if (!r.ok) return r
                // `BKE_reportf(.., RPT_WARNING, "Unable to rotate %d edge(s)", tot_failed_all)` (:2496).
                return {ok: true, warning: r.failed ? `Unable to rotate ${r.failed} edge(s)` : undefined}
            }),
        },
        {
            id: 'mesh.dissolve_degenerate', label: 'Degenerate Dissolve', icon: 'clean', category: 'Mesh', modes: ['edit'],
            description: 'Dissolve zero-length edges and zero-area faces among the selection (closer than the merge distance).',
            flags: {undo: true, register: true},
            props: degenerateProps,
            poll: edgesSelected('Select the part to clean up first (A selects everything)'),
            exec: runSession('Degenerate Dissolve', degenerateProps, p => {
                const r = dissolveDegenerateSelection(bm(), Number(p.threshold))
                const [v, e, f] = r.removed
                return {ok: true, message: r.changed ? `Removed: ${v} vertices, ${e} edges, ${f} faces` : 'No degenerate geometry found'}
            }),
        },
        ...([
            ['mesh.select_more', 'Select More', 'plus', 'Select more vertices, edges or faces connected to the selection (Blender\'s Ctrl+Numpad+).', false],
            ['mesh.select_less', 'Select Less', 'minus', 'Deselect the vertices, edges or faces at the boundary of each selected region (Blender\'s Ctrl+Numpad-).', true],
        ] as const).map(([id, label, icon, description, less]): OperatorDescriptor => ({
            id, label, icon, category: 'Select', modes: ['edit'], description,
            props: faceStepProps,
            // `ED_operator_editmesh`; with nothing selected the exec does nothing (`continue`).
            poll: () => me.isEditing || onlyInEditMessage(engine),
            exec: (_ctx, p) => {
                const useFaceStep = p?.useFaceStep === undefined ? true : !!p.useFaceStep
                const b = me.state?.bm
                if (b && b.totvertsel + b.totedgesel + b.totfacesel > 0) {
                    if (less) me.selectLess(useFaceStep)
                    else me.selectMore(useFaceStep)
                }
                return {ok: true, props: {useFaceStep}}
            },
        })),
    ]
    for (const op of ops) engine.operators.register(op)
}
