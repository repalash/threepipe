/**
 * The menu definitions (`src/menus/menus.ts`, Blender's `VIEW3D_MT_*` / `TOPBAR_MT_*`) and their
 * resolution (`src/menus/resolveMenu.ts`): structure, "not available yet" entries, keys from the
 * keymap with matching props, and the context-dependent rows.
 */

import {describe, expect, it} from 'vitest'
import {registerMenus, HEADER_MENUS, CONTEXT_MENUS} from '../src/menus/menus'
import {resolveMenu} from '../src/menus/resolveMenu'
import {Keymap} from '../src/keymap/Keymap'
import {blenderPreset} from '../src/keymap/presets/blender'
import {
    EditorContext,
    MenuDescriptor,
    NOT_AVAILABLE_YET,
    OperatorDescriptor,
    ResolvedMenu,
    ResolvedMenuItem,
    SelectModeName,
    SimpleRegistry,
} from '../src/registry'

interface FakeState {mode: 'object' | 'edit', selectMode: SelectModeName, sel: [number, number, number]}

/** Just what `registerMenus` and `resolveMenu` read from the engine. */
function makeEngine(ops: string[]) {
    const state: FakeState = {mode: 'edit', selectMode: 'vertex', sel: [0, 0, 0]}
    const keymap = new Keymap(blenderPreset)
    const operators = new SimpleRegistry<OperatorDescriptor>()
    for (const id of ops) operators.register({id, label: id, exec: () => ({ok: true})})
    const menus = new SimpleRegistry<MenuDescriptor>()
    const engine = {
        operators, menus,
        keymap: {shortcutFor: (id: string, mode?: 'object' | 'edit', props?: Record<string, unknown>) => keymap.shortcutFor(id, mode, props)},
        poll: () => ({enabled: true}),
        file: {recent: [] as {name: string}[]},
        meshEdit: {
            get state() {
                return state.mode === 'edit' ? {bm: {totvertsel: state.sel[0], totedgesel: state.sel[1], totfacesel: state.sel[2], selectHistory: []}} : null
            },
        },
    }
    registerMenus(engine as never)
    const ctx = (): EditorContext => ({mode: state.mode, selectMode: state.selectMode, selectedObjects: [], editObject: null} as never)
    const resolve = (id: string) => resolveMenu(engine as never, id, ctx())!
    return {engine, state, menus, resolve, ctx}
}

const flat = (menu: ResolvedMenu): ResolvedMenuItem[] => menu.items.flatMap(i => i.type === 'menu' && i.menu ? [i, ...flat(i.menu)] : [i])
const byLabel = (menu: ResolvedMenu, label: string) => menu.items.find(i => 'label' in i && i.label === label)

const ENGINE_OPS = ['mesh.move', 'mesh.rotate', 'mesh.scale', 'mesh.duplicate', 'mesh.extrude', 'mesh.merge', 'mesh.remove_doubles',
    'mesh.split', 'mesh.separate', 'mesh.bisect', 'mesh.knife', 'mesh.delete', 'mesh.dissolve_verts', 'mesh.dissolve_edges',
    'mesh.dissolve_faces', 'mesh.dissolve_limited', 'mesh.bevel', 'mesh.edge_face_add', 'mesh.vert_connect_path', 'mesh.vert_connect',
    'mesh.vert_slide', 'mesh.edge_slide', 'mesh.subdivide', 'mesh.subdivide_edgering', 'mesh.bridge_edge_loops', 'mesh.loopcut_slide',
    'mesh.inset', 'mesh.fill_grid', 'mesh.hide', 'mesh.reveal', 'mesh.select_all', 'mesh.select_none', 'mesh.select_invert',
    'mesh.select_linked', 'mesh.vertices_menu', 'mesh.edges_menu', 'mesh.faces_menu', 'add.menu', 'add.cube']

describe('menu definitions', () => {
    it('every header menu resolves, in Blender\'s order for each mode', () => {
        const {resolve, ctx, state} = makeEngine(ENGINE_OPS)
        state.mode = 'object'
        expect(HEADER_MENUS(ctx()).map(id => resolve(id).label)).toEqual(['File', 'Edit', 'View', 'Select', 'Add', 'Object', 'Help'])
        state.mode = 'edit'
        // VIEW3D_MT_mesh_add is "Mesh" and VIEW3D_MT_uv_map "UV Mapping"; the header renames them (HEADER_LABELS).
        expect(HEADER_MENUS(ctx()).map(id => resolve(id).label))
            .toEqual(['File', 'Edit', 'View', 'Select', 'Mesh', 'Mesh', 'Vertex', 'Edge', 'Face', 'UV Mapping', 'Help'])
    })

    it('every submenu a definition names is registered, unless marked as a subsystem the editor does not have', () => {
        const {menus} = makeEngine(ENGINE_OPS)
        const missing: string[] = []
        for (const m of menus.list()) {
            const items = typeof m.items === 'function' ? [] : m.items
            const walk = (list: typeof items) => {
                for (const it of list) {
                    if (it.type !== 'menu') continue
                    if (it.items) walk(it.items)
                    else if (!it.unavailable && !menus.get(it.id)) missing.push(`${m.id} > ${it.id}`)
                }
            }
            walk(items)
        }
        expect(missing).toEqual([])
    })

    it('Mesh follows VIEW3D_MT_edit_mesh: submenus, separators, Delete last', () => {
        const {resolve} = makeEngine(ENGINE_OPS)
        const mesh = resolve('VIEW3D_MT_edit_mesh')
        const rows = mesh.items.map(i => i.type === 'separator' ? '---' : (i as {label: string}).label)
        expect(rows).toEqual([
            'Transform', 'Mirror', 'Snap', '---',
            'Duplicate', 'Extrude', '---',
            'Merge', 'Split', 'Separate', '---',
            'Bisect', 'Knife Project', 'Knife', 'Convex Hull', '---',
            'Symmetrize', 'Snap to Symmetry', '---',
            'Normals', 'Shading', 'Weights', 'Set Attribute', 'Sort Elements', '---',
            'Show/Hide', 'Clean Up', '---',
            'Delete',
        ])
    })

    it('an operator the engine does not have is disabled, "not available yet", naming Blender\'s operator', () => {
        const {resolve} = makeEngine(ENGINE_OPS)
        const mesh = resolve('VIEW3D_MT_edit_mesh')
        const hull = byLabel(mesh, 'Convex Hull') as Extract<ResolvedMenuItem, {type: 'operator'}>
        expect(hull.enabled).toBe(false)
        expect(hull.available).toBe(false)
        expect(hull.tooltip).toBe(`${NOT_AVAILABLE_YET} (Blender's mesh.convex_hull)`)
        const bisect = byLabel(mesh, 'Bisect') as Extract<ResolvedMenuItem, {type: 'operator'}>
        expect(bisect.enabled).toBe(true)
        expect(bisect.available).toBe(true)
        // A whole subsystem is one disabled entry, not an empty submenu.
        const weights = byLabel(mesh, 'Weights') as Extract<ResolvedMenuItem, {type: 'menu'}>
        expect(weights.available).toBe(false)
        expect(weights.menu).toBeUndefined()
        expect(weights.tooltip).toContain(NOT_AVAILABLE_YET)
        // A variant the engine's operator does not implement (Separate > By Material).
        const separate = byLabel(mesh, 'Separate') as Extract<ResolvedMenuItem, {type: 'menu'}>
        expect(separate.menu!.items.map(i => [(i as {label: string}).label, (i as {enabled: boolean}).enabled]))
            .toEqual([['Selection', true], ['By Material', false], ['By Loose Parts', false]])
    })

    it('keys come from the active keymap, matching the entry\'s props', () => {
        const {resolve} = makeEngine(ENGINE_OPS)
        const mesh = resolve('VIEW3D_MT_edit_mesh')
        // A submenu shows the key of the operator that opens it (`wm.call_menu`'s binding): X, M.
        expect((byLabel(mesh, 'Delete') as {shortcut?: string}).shortcut).toBe('X')
        expect((byLabel(mesh, 'Merge') as {shortcut?: string}).shortcut).toBe('M')
        expect((byLabel(mesh, 'Duplicate') as {shortcut?: string}).shortcut).toBe('Shift+D')
        // X's binding has no props, so it is not "Delete > Vertices".
        const del = resolve('VIEW3D_MT_edit_mesh_delete')
        expect((byLabel(del, 'Vertices') as {shortcut?: string}).shortcut).toBeUndefined()
        // Ctrl+Shift+B is `mesh.bevel affect=VERTICES`; Bevel Vertices shows it, Bevel Edges does not.
        expect((byLabel(resolve('VIEW3D_MT_edit_mesh_vertices'), 'Bevel Vertices') as {shortcut?: string}).shortcut).toBe('Ctrl+Shift+B')
        expect((byLabel(resolve('VIEW3D_MT_edit_mesh_edges'), 'Bevel Edges') as {shortcut?: string}).shortcut).toBeUndefined()
        // H / Shift+H set `unselected`; Alt+H reveals.
        const showhide = resolve('VIEW3D_MT_edit_mesh_showhide')
        expect(showhide.items.map(i => (i as {shortcut?: string}).shortcut)).toEqual(['Alt+H', 'H', 'Shift+H'])
    })

    it('the Ctrl+V/E/F operators and their menus are the same definitions as the header\'s', () => {
        const {menus} = makeEngine(ENGINE_OPS)
        expect(menus.get('VIEW3D_MT_edit_mesh_vertices')!.operator).toBe('mesh.vertices_menu')
        expect(menus.get('VIEW3D_MT_edit_mesh_edges')!.operator).toBe('mesh.edges_menu')
        expect(menus.get('VIEW3D_MT_edit_mesh_faces')!.operator).toBe('mesh.faces_menu')
    })

    it('Extrude lists what the selection can extrude (VIEW3D_MT_edit_mesh_extrude.draw)', () => {
        const {resolve, state} = makeEngine(ENGINE_OPS)
        const labels = () => resolve('VIEW3D_MT_edit_mesh_extrude').items.filter(i => i.type !== 'separator').map(i => (i as {label: string}).label)
        state.selectMode = 'vertex'
        state.sel = [2, 1, 0]
        expect(labels()).toEqual(['Extrude Edges', 'Extrude Vertices', 'Extrude Repeat', 'Spin'])
        state.selectMode = 'face'
        state.sel = [4, 4, 1]
        expect(labels()).toEqual(['Extrude Faces', 'Extrude Faces Along Normals', 'Extrude Individual Faces', 'Extrude Manifold', 'Extrude Repeat', 'Spin'])
    })

    it('the edit-mode context menu has the select mode\'s column only', () => {
        const {resolve, state} = makeEngine(ENGINE_OPS)
        for (const [mode, first, last] of [['vertex', 'Vertex', 'Delete Vertices'], ['edge', 'Edge', 'Delete Edges'], ['face', 'Face', 'Delete Faces']] as const) {
            state.selectMode = mode
            state.sel = [4, 4, 1]
            const items = resolve(CONTEXT_MENUS.edit).items
            expect((items[0] as {label: string}).label).toBe(first)
            expect((items[items.length - 1] as {label: string}).label).toBe(last)
            expect(items.filter(i => i.type === 'label')).toHaveLength(1)
        }
        // "if selected_verts_len > 1" (:4621): one vertex, no Connect Vertex Path.
        state.selectMode = 'vertex'
        state.sel = [1, 0, 0]
        expect(flat(resolve(CONTEXT_MENUS.edit)).some(i => (i as {label?: string}).label === 'Connect Vertex Path')).toBe(false)
        state.sel = [2, 1, 0]
        expect(flat(resolve(CONTEXT_MENUS.edit)).some(i => (i as {label?: string}).label === 'Connect Vertex Path')).toBe(true)
    })

    it('Add in edit mode is VIEW3D_MT_mesh_add, whose primitives cannot add into the edit mesh yet', () => {
        const {resolve, state} = makeEngine(ENGINE_OPS)
        state.mode = 'edit'
        const cube = byLabel(resolve('VIEW3D_MT_mesh_add'), 'Cube') as Extract<ResolvedMenuItem, {type: 'operator'}>
        expect(cube.enabled).toBe(false)
        expect(cube.tooltip).toContain('adding a primitive into the mesh being edited')
        state.mode = 'object'
        expect((byLabel(resolve('VIEW3D_MT_mesh_add'), 'Cube') as {enabled: boolean}).enabled).toBe(true)
    })
})
