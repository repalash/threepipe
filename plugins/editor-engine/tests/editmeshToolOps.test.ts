/**
 * The edit-mode tool operators (`src/ops/editmeshToolOps.ts`) as the engine runs them: each against a
 * real BMesh session (snapshot / revert / commit as `MeshEditPlugin` does them), with the counts
 * Blender gives for the same input (the kernel functions behind them are parity-tested against
 * Blender 5.2.2 in `mesh-kernel/tests/editmesh-tools-parity.test.ts`), the props the redo panel shows,
 * the Blender keymap's bindings, and the menu entries that stop being "Not available yet".
 */

import {describe, expect, it} from 'vitest'
import {BMesh, bmFromMesh, BM_FROM_MESH_NORMALS, bmToMesh, ElemFlag, MeshData, meshNormalsUpdate, primitiveCube, primitiveGrid, selectCountsRecalc, SelectMode} from '@threepipe/mesh-kernel'
import {selectLess, selectMore} from '../../mesh-edit/src/select/moreLess'
import {registerEditmeshToolOperators} from '../src/ops/editmeshToolOps'
import {registerFillOperators} from '../src/ops/fillOps'
import {registerMenus} from '../src/menus/menus'
import {resolveMenu} from '../src/menus/resolveMenu'
import {Keymap} from '../src/keymap/Keymap'
import {blenderPreset} from '../src/keymap/presets/blender'
import {EditorContext, MenuDescriptor, OperatorDescriptor, ResolvedMenu, ResolvedMenuItem, SimpleRegistry} from '../src/registry'

/** What the operators read from the engine and its mesh-edit session. */
function makeSession(mesh: MeshData) {
    let bm: BMesh = bmFromMesh(mesh, BM_FROM_MESH_NORMALS)
    const history: string[] = []
    const messages: string[] = []
    const keymap = new Keymap(blenderPreset)
    const meshEdit = {
        get state() { return {bm} },
        isEditing: true,
        isModal: false,
        snapshot: () => bmToMesh(bm),
        revert: (before: MeshData) => {
            const mode = bm.selectMode
            bm = bmFromMesh(before, BM_FROM_MESH_NORMALS)
            bm.selectMode = mode
        },
        // `MeshEditPlugin.commit`: one undo step, then `EditMeshState.update` (normals, `EDBM_update`).
        commit: (_before: MeshData, label: string) => {
            history.push(label)
            meshNormalsUpdate(bm)
        },
        selectMore: (faceStep: boolean) => selectMore(bm, faceStep),
        selectLess: (faceStep: boolean) => selectLess(bm, faceStep),
    }
    const operators = new SimpleRegistry<OperatorDescriptor>()
    const menus = new SimpleRegistry<MenuDescriptor>()
    const engine = {
        meshEdit, operators, menus, propDrag: null,
        keymap: {shortcutFor: (id: string, mode?: 'object' | 'edit', props?: Record<string, unknown>) => keymap.shortcutFor(id, mode, props)},
        message: (_l: string, text: string) => messages.push(text),
        poll: (op: OperatorDescriptor, ctx: EditorContext) => {
            const p = op.poll ? op.poll(ctx) : true
            return p === true ? {enabled: true} : {enabled: false, reason: typeof p === 'string' ? p : undefined}
        },
        file: {recent: []},
    }
    registerFillOperators(engine as never)
    registerEditmeshToolOperators(engine as never)
    registerMenus(engine as never)
    const ctx = (): EditorContext => ({mode: 'edit', selectMode: 'face', selectedObjects: [], editObject: null} as never)
    const run = (id: string, props?: Record<string, unknown>) => {
        const op = operators.get(id)!
        const polled = op.poll ? op.poll(ctx()) : true
        if (polled !== true) return {ok: false as const, error: String(polled)}
        return op.exec(ctx(), props) as ReturnType<OperatorDescriptor['exec']> & {ok: boolean, props?: Record<string, unknown>, error?: string}
    }
    return {get bm() { return bm }, history, messages, operators, keymap, run, engine, ctx}
}

const counts = (bm: BMesh) => [bm.totvert, bm.totedge, bm.totface]
const sel = (bm: BMesh) => [bm.totvertsel, bm.totedgesel, bm.totfacesel]
function selectFaces(bm: BMesh, pick: (i: number) => boolean) {
    bm.selectMode = SelectMode.Face
    for (const v of bm.verts) v.hflag &= ~ElemFlag.Select
    for (const e of bm.edges) e.hflag &= ~ElemFlag.Select
    for (const f of bm.faces) f.hflag &= ~ElemFlag.Select
    let i = 0
    for (const f of bm.faces) {
        if (pick(i++)) {
            f.hflag |= ElemFlag.Select
            for (const l of f.eachLoop()) {
                l.v.hflag |= ElemFlag.Select
                l.e!.hflag |= ElemFlag.Select
            }
        }
    }
    selectCountsRecalc(bm)
}

describe('edit-mode tool operators', () => {
    it('Poke Faces: one quad of a cube becomes 4 triangles round a new vertex; redo shows every prop', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, i => i === 0)
        const r = s.run('mesh.poke')
        expect(r.ok).toBe(true)
        expect(counts(s.bm)).toEqual([9, 16, 9])
        expect(sel(s.bm)).toEqual([5, 8, 4]) // the fan: its 4 corners and the centre
        expect(r.props).toEqual({offset: 0, useRelativeOffset: false, centerMode: 'MEDIAN_WEIGHTED'})
        expect(s.history).toEqual(['Poke Faces'])
    })

    it('Triangulate Faces: a cube becomes 12 triangles; Ctrl+T passes BEAUTY / BEAUTY, Ctrl+Shift+T FIXED / CLIP', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, () => true)
        expect(s.run('mesh.quads_convert_to_tris').ok).toBe(true)
        expect(counts(s.bm)).toEqual([8, 18, 12])
        expect(s.keymap.shortcutFor('mesh.quads_convert_to_tris', 'edit', {quadMethod: 'BEAUTY', ngonMethod: 'BEAUTY'})).toBe('Ctrl+T')
        expect(s.keymap.shortcutFor('mesh.quads_convert_to_tris', 'edit', {quadMethod: 'FIXED', ngonMethod: 'CLIP'})).toBe('Ctrl+Shift+T')
    })

    it('Beautify Faces rotates the bad diagonals of a triangulated grid, keeping the counts', () => {
        const s = makeSession(primitiveGrid({xSegments: 4, ySegments: 3, size: 2}))
        selectFaces(s.bm, () => true)
        expect(s.run('mesh.quads_convert_to_tris', {quadMethod: 'FIXED'}).ok).toBe(true)
        const before = counts(s.bm)
        const r = s.run('mesh.beautify_fill')
        expect(r.ok).toBe(true)
        expect(counts(s.bm)).toEqual(before)
        expect(r.props).toEqual({angleLimit: 180})
    })

    it('Wireframe: a cube\'s 12 edges become struts (Blender: 40 verts, 48 faces)', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, () => true)
        expect(s.run('mesh.wireframe').ok).toBe(true)
        expect(counts(s.bm)).toEqual([40, 96, 48])
        expect(s.bm.totfacesel).toBe(48)
    })

    it('Fill (Alt+F) triangulates a hole\'s rim; Make Edge/Face (F) is mesh.edge_face_add', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, i => i === 0)
        // Delete the face only, keeping its rim, then fill the rim with triangles.
        for (const f of [...s.bm.faces]) if (f.hflag & ElemFlag.Select) s.bm.faceKill(f)
        selectCountsRecalc(s.bm)
        s.bm.selectMode = SelectMode.Edge
        expect(s.run('mesh.fill').ok).toBe(true)
        expect(counts(s.bm)).toEqual([8, 13, 7])
        expect(s.keymap.shortcutFor('mesh.fill', 'edit')).toBe('Alt+F')
        expect(s.keymap.shortcutFor('mesh.edge_face_add', 'edit')).toBe('F')
    })

    it('Mark / Clear Seam and Sharp write the edge flags; clear is hidden from the panel', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, i => i === 0)
        expect(s.run('mesh.mark_seam').ok).toBe(true)
        expect([...s.bm.edges].filter(e => e.hflag & ElemFlag.Seam).length).toBe(4)
        expect(s.run('mesh.mark_sharp').ok).toBe(true)
        expect([...s.bm.edges].filter(e => !(e.hflag & ElemFlag.Smooth)).length).toBe(4)
        // Written through to the mesh as Blender's attributes.
        const mesh = bmToMesh(s.bm)
        expect(mesh.attributes.get('uv_seam')).toBeTruthy()
        expect(mesh.attributes.get('sharp_edge')).toBeTruthy()
        expect(s.run('mesh.mark_seam', {clear: true}).ok).toBe(true)
        expect([...s.bm.edges].filter(e => e.hflag & ElemFlag.Seam).length).toBe(0)
        expect(s.history).toEqual(['Mark Seam', 'Mark Sharp', 'Clear Seam'])
        expect(s.operators.get('mesh.mark_seam')!.props!.properties.clear.hidden).toBe(true)
    })

    it('Flip and Recalculate Normals: flipped faces come back outside; Shift+N / Ctrl+Shift+N', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, i => i < 2)
        const normalsOut = () => [...s.bm.faces].filter(f => {
            const c = f.verts().reduce((a, v) => [a[0] + v.x, a[1] + v.y, a[2] + v.z], [0, 0, 0])
            return c[0] * f.nx + c[1] * f.ny + c[2] * f.nz > 0
        }).length
        expect(normalsOut()).toBe(6)
        expect(s.run('mesh.flip_normals').ok).toBe(true)
        expect(normalsOut()).toBe(4)
        selectFaces(s.bm, () => true)
        expect(s.run('mesh.normals_make_consistent').ok).toBe(true)
        expect(normalsOut()).toBe(6)
        expect(s.run('mesh.normals_make_consistent', {inside: true}).ok).toBe(true)
        expect(normalsOut()).toBe(0)
        expect(s.keymap.shortcutFor('mesh.normals_make_consistent', 'edit', {inside: false})).toBe('Shift+N')
        expect(s.keymap.shortcutFor('mesh.normals_make_consistent', 'edit', {inside: true})).toBe('Ctrl+Shift+N')
    })

    it('Delete Loose removes a stray vertex and wire edge and reports Blender\'s message', () => {
        const cube = primitiveCube()
        const bm = bmFromMesh(cube, BM_FROM_MESH_NORMALS)
        const a = bm.vertCreate(5, 5, 5), b = bm.vertCreate(6, 5, 5), c = bm.vertCreate(7, 7, 7)
        bm.edgeCreate(a, b)
        const s = makeSession(bmToMesh(bm))
        void c
        for (const v of s.bm.verts) v.hflag |= ElemFlag.Select
        for (const e of s.bm.edges) e.hflag |= ElemFlag.Select
        for (const f of s.bm.faces) f.hflag |= ElemFlag.Select
        selectCountsRecalc(s.bm)
        expect(s.run('mesh.delete_loose').ok).toBe(true)
        expect(counts(s.bm)).toEqual([8, 12, 6])
        expect(s.messages).toContain('Removed: 3 vertices, 1 edges, 0 faces')
        expect(sel(s.bm)).toEqual([0, 0, 0]) // EDBM_flag_disable_all
    })

    it('Select More / Less grow and shrink by face step (Ctrl+Numpad+ / -)', () => {
        const s = makeSession(primitiveGrid({xSegments: 5, ySegments: 5, size: 2}))
        selectFaces(s.bm, j => j === 12)
        expect(s.bm.totfacesel).toBe(1)
        expect(s.run('mesh.select_more').ok).toBe(true)
        expect(s.bm.totfacesel).toBe(9)
        expect(s.run('mesh.select_less').ok).toBe(true)
        expect(s.bm.totfacesel).toBe(1)
        expect(s.keymap.shortcutFor('mesh.select_more', 'edit')).toBe('Ctrl+Numpad +')
        expect(s.keymap.shortcutFor('mesh.select_less', 'edit')).toBe('Ctrl+Numpad -')
    })

    it('a run that fails leaves the mesh as it was (Fill on a selection with no closed loop)', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, () => false)
        s.bm.selectMode = SelectMode.Edge
        const e = [...s.bm.edges][0]
        e.hflag |= ElemFlag.Select
        e.v1.hflag |= ElemFlag.Select
        e.v2.hflag |= ElemFlag.Select
        selectCountsRecalc(s.bm)
        const before = counts(s.bm)
        const r = s.run('mesh.fill')
        expect(r).toMatchObject({ok: false, error: 'No faces filled'})
        expect(counts(s.bm)).toEqual(before)
        expect(s.history).toEqual([])
    })

    it('their menu entries are no longer "Not available yet"', () => {
        const s = makeSession(primitiveCube())
        selectFaces(s.bm, () => true)
        const flat = (m: ResolvedMenu): ResolvedMenuItem[] => m.items.flatMap(x => x.type === 'menu' && x.menu ? [x, ...flat(x.menu)] : [x])
        const entries = ['VIEW3D_MT_edit_mesh_faces', 'VIEW3D_MT_edit_mesh_edges', 'VIEW3D_MT_edit_mesh_normals', 'VIEW3D_MT_edit_mesh_clean']
            .flatMap(id => flat(resolveMenu(s.engine as never, id, s.ctx())!))
        for (const id of ['mesh.poke', 'mesh.quads_convert_to_tris', 'mesh.beautify_fill', 'mesh.wireframe', 'mesh.fill',
            'mesh.mark_seam', 'mesh.mark_sharp', 'mesh.flip_normals', 'mesh.normals_make_consistent', 'mesh.delete_loose']) {
            const items = entries.filter(x => x.type === 'operator' && x.id === id)
            expect(items.length, id).toBeGreaterThan(0)
            for (const x of items) expect(x.type === 'operator' && x.available, `${id} ${'label' in x ? x.label : ''}`).toBe(true)
        }
    })
})
