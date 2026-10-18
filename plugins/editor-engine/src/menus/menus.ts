/**
 * The editor's menus, ported from Blender's 3D view and top bar (Blender 5.3, `e4e6c79a`):
 * `scripts/startup/bl_ui/space_view3d.py` (the `VIEW3D_MT_*` header and context menus) and
 * `scripts/startup/bl_ui/space_topbar.py` (`TOPBAR_MT_file` / `_edit` / `_help`). Line numbers below are
 * into those files.
 *
 * Each `Menu.draw` becomes a list of {@link MenuItem}s, in Blender's order and with its separators:
 * `layout.operator(id, text=...)` is an operator item with Blender's text (or the operator's `ot->name`
 * when the menu gives none), properties set on it become `props`, `layout.menu(...)` is a submenu,
 * `operator_menu_enum` an inline submenu, and an `if` in `draw` a `visible` predicate.
 *
 * Where the engine has the operator under another id, the item names the engine's id and keeps
 * Blender's in `blender`. Where it does not have it, the item keeps Blender's id, which is not
 * registered, so the shell shows it disabled: "not available yet". Submenus of whole subsystems this
 * editor does not have (vertex groups, animation, physics, collections...) are one disabled entry each;
 * their contents are not ported. The list of both is in
 * `issues/open/modelling-tools/12-p3-p4-next-wave.md`, "Menus".
 *
 * Left out: what Blender gates on a build option (Freestyle) or on an object type or mode this editor
 * does not have (curves, armatures, paint modes), node-group operator assets
 * (`template_node_operator_asset_*`), and the top bar's desktop-only entries (Link/Append, Recover,
 * External Data, Defaults, Quit).
 *
 * Not Blender's: a "Commands" submenu at the end of Object (the `plugin-modelling` commands, which have no
 * place in Blender's menus), edit-mode Discard Edits / Apply to Object at the end of Edit, File > Connect
 * Agent… and View > Look (Agent View) (the agent socket), Add > Lathe / Sweep, Help > Send Feedback… (the cloud plugin).
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, EditorMode, MenuDescriptor, MenuItem, MenuOperatorItem, MenuPredicate, MenuSubmenuItem} from '../registry'
import {BMVert} from '@threepipe/mesh-kernel'

// --- row builders ----------------------------------------------------------------------------------

const op = (id: string, label: string, extra: Partial<MenuOperatorItem> = {}): MenuOperatorItem => ({type: 'operator', id, label, ...extra})
const sub = (id: string, extra: Partial<MenuSubmenuItem> = {}): MenuSubmenuItem => ({type: 'menu', id, ...extra})
/** A submenu of a subsystem the editor does not have: one disabled entry. */
const absent = (id: string, label: string, why: string): MenuSubmenuItem => ({type: 'menu', id, label, unavailable: why})
const sep: MenuItem = {type: 'separator'}
const label = (text: string): MenuItem => ({type: 'label', label: text})

/** The header's menus, in order (see {@link EditorEnginePlugin.headerMenus}). */
export function HEADER_MENUS(ctx: EditorContext): string[] {
    // TOPBAR_MT_editor_menus (space_topbar.py:106): File, Edit (Render, Window omitted), Help; the 3D
    // view's header menus (VIEW3D_MT_editor_menus, space_view3d.py:1143) sit between Edit and Help,
    // since this editor has one header for both.
    const view3d = ctx.mode === 'edit'
        ? ['VIEW3D_MT_view', 'VIEW3D_MT_select_edit_mesh', 'VIEW3D_MT_mesh_add', 'VIEW3D_MT_edit_mesh',
            'VIEW3D_MT_edit_mesh_vertices', 'VIEW3D_MT_edit_mesh_edges', 'VIEW3D_MT_edit_mesh_faces', 'VIEW3D_MT_uv_map']
        : ['VIEW3D_MT_view', 'VIEW3D_MT_select_object', 'VIEW3D_MT_add', 'VIEW3D_MT_object']
    return ['TOPBAR_MT_file', 'TOPBAR_MT_edit', ...view3d, 'TOPBAR_MT_help']
}

/**
 * Header labels that differ from the menu's `bl_label`: `layout.menu("VIEW3D_MT_mesh_add", text="Add")`
 * and `layout.menu("VIEW3D_MT_uv_map", text="UV")` (space_view3d.py:1173, :1194).
 */
export const HEADER_LABELS: Record<string, string> = {VIEW3D_MT_mesh_add: 'Add', VIEW3D_MT_uv_map: 'UV'}

/** The object-mode Add menu (Shift+A), also behind the outliner's + button. */
export const ADD_MENU = 'VIEW3D_MT_add'

/**
 * The right-click menus: `_template_items_context_menu("VIEW3D_MT_object_context_menu", ...)` in object
 * mode and `"VIEW3D_MT_edit_mesh_context_menu"` in the mesh keymap (`blender_default.py:4582`, `:5656`).
 */
export const CONTEXT_MENUS: Record<EditorMode, string> = {
    object: 'VIEW3D_MT_object_context_menu',
    edit: 'VIEW3D_MT_edit_mesh_context_menu',
}

export function registerMenus(engine: EditorEnginePlugin): void {
    const me = engine.meshEdit

    // --- context helpers (what Blender's `draw` functions read) -----------------------------------
    const edit: MenuPredicate = ctx => ctx.mode === 'edit'
    const hasOp = (id: string): MenuPredicate => () => !!engine.operators.get(id)
    const selCounts = () => {
        const bm = me.state?.bm
        return bm ? {v: bm.totvertsel, e: bm.totedgesel, f: bm.totfacesel} : {v: 0, e: 0, f: 0}
    }
    const isMode = (m: 'vertex' | 'edge' | 'face'): MenuPredicate => ctx => ctx.mode === 'edit' && ctx.selectMode === m
    const activeObject = (ctx: EditorContext) => ctx.selectedObjects[ctx.selectedObjects.length - 1] as (EditorContext['selectedObjects'][number] & {isLight?: boolean, isMesh?: boolean, type?: string}) | undefined
    const isLight = (ctx: EditorContext) => !!activeObject(ctx)?.isLight
    const lightType = (ctx: EditorContext) => (activeObject(ctx) as {type?: string} | undefined)?.type

    const notInEditMesh = (ctx: EditorContext) => ctx.mode === 'edit' ? 'adding a primitive into the mesh being edited' : undefined

    // --- shared menus ----------------------------------------------------------------------------
    const transformBase: MenuItem[] = [
        // VIEW3D_MT_transform_base (space_view3d.py:1257).
        op('mesh.move', 'Move', {blender: 'transform.translate', visible: edit}),
        op('transform.translate', 'Move', {visible: c => !edit(c)}),
        op('mesh.rotate', 'Rotate', {blender: 'transform.rotate', visible: edit}),
        op('transform.rotate', 'Rotate', {visible: c => !edit(c)}),
        op('mesh.scale', 'Scale', {blender: 'transform.resize', visible: edit}),
        op('transform.resize', 'Scale', {visible: c => !edit(c)}),
        sep,
        op('transform.tosphere', 'To Sphere'),
        op('transform.shear', 'Shear'),
        op('transform.bend', 'Bend'),
        op('transform.push_pull', 'Push/Pull'),
    ]

    const menus: MenuDescriptor[] = [
        // ================================================================== top bar (space_topbar.py)
        {
            id: 'TOPBAR_MT_file', label: 'File', source: 'space_topbar.py:157',
            items: [
                sub('TOPBAR_MT_file_new', {label: 'New'}),
                op('file.open', 'Open...', {blender: 'wm.open_mainfile'}),
                sub('TOPBAR_MT_file_open_recent'),
                op('wm.revert_mainfile', 'Revert'),
                sep,
                op('file.save', 'Save', {blender: 'wm.save_mainfile'}),
                op('file.save_as', 'Save As...', {blender: 'wm.save_as_mainfile'}),
                op('wm.save_as_mainfile', 'Save Copy...', {props: {copy: true}}),
                op('wm.save_mainfile', 'Save Incremental', {props: {incremental: true}}),
                sep,
                // `TOPBAR_MT_file_import` lists one entry per format; here one picker takes every format
                // the importers know (.glb/.gltf, .obj, .fbx, .stl ...).
                op('file.import', 'Import...', {blender: 'TOPBAR_MT_file_import'}),
                sub('TOPBAR_MT_file_export'),
                // Not Blender's: the agent socket (an AI agent drives this document).
                sep,
                op('agent.connect', 'Connect Agent…'),
            ],
        },
        {
            // TOPBAR_MT_file_new.draw_ex (space_topbar.py:243): "General" and the app templates.
            id: 'TOPBAR_MT_file_new', label: 'New File', source: 'space_topbar.py:218', operator: 'file.new',
            items: [op('file.new', 'General', {blender: 'wm.read_homefile'})],
        },
        {
            // TOPBAR_MT_file_open_recent, registered in C (`recent_files_menu_draw`, space_topbar.cc:189): up to
            // 20 recent files, then "More..." and "Clear Recent Files List...", or "No Recent Files".
            id: 'TOPBAR_MT_file_open_recent', label: 'Open Recent', source: 'space_topbar.cc:189',
            items: () => engine.file.recent.length ? [
                ...engine.file.recent.slice(0, 20).map(r => op('file.open_recent', r.name, {props: {name: r.name}})),
                sep,
                op('wm.search_single_menu', 'More...', {props: {menu_idname: 'TOPBAR_MT_file_open_recent'}}),
                op('file.clear_recent', 'Clear Recent Files List...', {blender: 'wm.clear_recent_files'}),
            ] : [label('No Recent Files')],
        },
        {
            // TOPBAR_MT_file_export (space_topbar.py:391), with the glTF add-on's entry
            // (io_scene_gltf2 `menu_func_export`).
            id: 'TOPBAR_MT_file_export', label: 'Export', source: 'space_topbar.py:391',
            items: [
                op('file.export_glb', 'glTF 2.0 (.glb/.gltf)', {blender: 'export_scene.gltf'}),
                op('file.export_obj', 'Wavefront (.obj)', {blender: 'wm.obj_export'}),
                op('wm.ply_export', 'Stanford PLY (.ply)'),
                op('file.export_stl', 'STL (.stl)', {blender: 'wm.stl_export'}),
            ],
        },
        {
            id: 'TOPBAR_MT_edit', label: 'Edit', source: 'space_topbar.py:511',
            items: [
                op('edit.undo', 'Undo', {blender: 'ed.undo'}),
                op('edit.redo', 'Redo', {blender: 'ed.redo'}),
                op('edit.history', 'Undo History...', {blender: 'TOPBAR_MT_undo_history'}),
                sep,
                op('edit.repeat_last', 'Adjust Last Operation...', {blender: 'screen.redo_last'}),
                op('edit.repeat', 'Repeat Last', {blender: 'screen.repeat_last'}),
                op('screen.repeat_history', 'Repeat History...'),
                sep,
                op('ui.command_palette', 'Menu Search...', {blender: 'wm.search_menu'}),
                sep,
                op('edit.rename', 'Rename Active Item...', {blender: 'wm.call_panel TOPBAR_PT_name'}),
                op('wm.batch_rename', 'Batch Rename...'),
                sep,
                // `screen.userpref_show` opens Blender's Preferences, where the keymap and input live.
                op('edit.keymap', 'Keymap', {blender: 'screen.userpref_show'}),
                op('edit.input_device', 'Input Device', {blender: 'screen.userpref_show'}),
                // Not Blender's: edit mode's own exits (Blender only has the mode switch).
                {...sep, visible: edit},
                op('mesh.exit_discard', 'Discard Edits', {visible: edit}),
                op('mesh.apply', 'Apply to Object', {visible: edit}),
            ],
        },
        {
            // TOPBAR_MT_help (space_topbar.py:601), with the app's own entries for the splash screen and
            // About (TOPBAR_MT_blender) and its cheat sheet (`wm.operator_cheat_sheet`).
            id: 'TOPBAR_MT_help', label: 'Help', source: 'space_topbar.py:601',
            items: [
                op('help.docs', 'Threepipe Documentation', {blender: 'wm.url_open_preset MANUAL'}),
                // Blender's Report a Bug (`wm.url_open_preset BUG`), as a dialog that sends the report; with Send
                // Feedback, only when the app has the cloud plugin (`@threepipe/plugin-cloud`), which registers both.
                op('help.report_problem', 'Report a Problem…', {blender: 'wm.url_open_preset BUG', visible: hasOp('help.report_problem')}),
                op('help.send_feedback', 'Send Feedback…', {visible: hasOp('help.send_feedback')}),
                sep,
                op('help.shortcuts', 'Keyboard Shortcuts', {blender: 'wm.operator_cheat_sheet'}),
                op('ui.command_palette', 'Search Commands…', {blender: 'wm.search_operator'}),
                sep,
                op('help.welcome', 'Welcome…', {blender: 'wm.splash'}),
                op('help.hints', 'Show Hints Again'),
                sep,
                op('help.about', 'About', {blender: 'wm.splash_about'}),
            ],
        },

        // ================================================================== View
        {
            id: 'VIEW3D_MT_view', label: 'View', source: 'space_view3d.py:1454',
            items: [
                // `layout.prop(view, "show_region_*")` toggles (:1461-1465).
                op('view3d.show_region_toolbar', 'Toolbar'),
                op('view3d.show_region_ui', 'Sidebar'),
                op('view3d.show_region_tool_header', 'Tool Settings'),
                op('view3d.show_region_asset_shelf', 'Asset Shelf'),
                op('view3d.show_region_hud', 'Adjust Last Operation'),
                sep,
                op('view.frame_selected', 'Frame Selected', {blender: 'view3d.view_selected'}),
                op('view.frame_all', 'Frame All', {blender: 'view3d.view_all'}),
                op('view.toggle_projection', 'Perspective/Orthographic', {blender: 'view3d.view_persportho'}),
                sub('VIEW3D_MT_view_local'),
                op('view3d.show_viewer', 'Viewer Node'),
                sep,
                sub('VIEW3D_MT_view_cameras', {label: 'Cameras'}),
                sep,
                sub('VIEW3D_MT_view_viewpoint'),
                sub('VIEW3D_MT_view_navigation'),
                sub('VIEW3D_MT_view_align'),
                sep,
                sub('VIEW3D_MT_view_regions', {label: 'View Regions'}),
                sep,
                op('screen.animation_play', 'Play Animation'),
                sep,
                op('render.opengl', 'Render Viewport Preview'),
                op('render.opengl', 'Render Playblast', {props: {animation: true}}),
                op('render.opengl', 'Render Playblast on Keyframes', {props: {animation: true, render_keyed_only: true}}),
                sep,
                absent('INFO_MT_area', 'Area', 'the editor has one fixed layout, not Blender\'s areas'),
                // Not Blender's: the multi-view sheet an agent sees with `look`.
                sep,
                op('view.look', 'Look (Agent View)'),
            ],
        },
        {id: 'VIEW3D_MT_view_local', label: 'Local View', source: 'space_view3d.py:1524', items: [
            op('view3d.localview', 'Toggle Local View'),
            op('view3d.localview_remove_from', 'Remove from Local View'),
        ]},
        {id: 'VIEW3D_MT_view_cameras', label: 'Cameras', source: 'space_view3d.py:1534', items: [
            op('view3d.object_as_camera', 'Set Active Object as Camera'),
            op('view3d.view_camera', 'Active Camera'),
            op('view3d.view_center_camera', 'Frame Camera Bounds'),
        ]},
        {id: 'VIEW3D_MT_view_viewpoint', label: 'Viewpoint', source: 'space_view3d.py:1545', items: [
            op('view3d.view_camera', 'Camera'),
            sep,
            op('view.top', 'Top', {blender: 'view3d.view_axis TOP'}),
            op('view.bottom', 'Bottom', {blender: 'view3d.view_axis BOTTOM'}),
            sep,
            op('view.front', 'Front', {blender: 'view3d.view_axis FRONT'}),
            op('view.back', 'Back', {blender: 'view3d.view_axis BACK'}),
            sep,
            op('view.right', 'Right', {blender: 'view3d.view_axis RIGHT'}),
            op('view.left', 'Left', {blender: 'view3d.view_axis LEFT'}),
        ]},
        {id: 'VIEW3D_MT_view_navigation', label: 'Navigation', source: 'space_view3d.py:1569', items: [
            // `operator_enum("view3d.view_orbit", "type")` (view3d_navigate_view_orbit.cc:39).
            op('view3d.view_orbit', 'Orbit Left', {props: {type: 'ORBITLEFT'}}),
            op('view3d.view_orbit', 'Orbit Right', {props: {type: 'ORBITRIGHT'}}),
            op('view3d.view_orbit', 'Orbit Up', {props: {type: 'ORBITUP'}}),
            op('view3d.view_orbit', 'Orbit Down', {props: {type: 'ORBITDOWN'}}),
            op('view3d.view_orbit', 'Orbit Opposite', {props: {type: 'ORBITRIGHT', angle: Math.PI}}),
            sep,
            op('view3d.view_roll', 'Roll Left', {props: {type: 'LEFT'}}),
            op('view3d.view_roll', 'Roll Right', {props: {type: 'RIGHT'}}),
            sep,
            // `operator_enum("view3d.view_pan", "type")` (view3d_navigate_view_pan.cc:34).
            op('view3d.view_pan', 'Pan Left', {props: {type: 'PANLEFT'}}),
            op('view3d.view_pan', 'Pan Right', {props: {type: 'PANRIGHT'}}),
            op('view3d.view_pan', 'Pan Up', {props: {type: 'PANUP'}}),
            op('view3d.view_pan', 'Pan Down', {props: {type: 'PANDOWN'}}),
            sep,
            op('view3d.zoom', 'Zoom In', {props: {delta: 1}}),
            op('view3d.zoom', 'Zoom Out', {props: {delta: -1}}),
            op('view3d.zoom_border', 'Zoom Region...'),
            op('view3d.dolly', 'Dolly View...'),
            op('view3d.zoom_camera_1_to_1', 'Zoom Camera 1:1'),
            sep,
            op('view3d.fly', 'Fly Navigation'),
            op('view3d.walk', 'Walk Navigation'),
        ]},
        {id: 'VIEW3D_MT_view_align', label: 'Align View', source: 'space_view3d.py:1604', items: [
            sub('VIEW3D_MT_view_align_selected'),
            sep,
            op('view3d.camera_to_view', 'Align Active Camera to View'),
            op('view3d.camera_to_view_selected', 'Align Active Camera to Selected'),
            sep,
            op('view3d.view_all', 'Center Cursor and Frame All', {props: {center: true}}),
            op('view3d.view_center_cursor', 'Center View to Cursor'),
            sep,
            op('view3d.view_lock_to_active', 'View Lock to Active'),
            op('view3d.view_lock_clear', 'View Lock Clear'),
        ]},
        {id: 'VIEW3D_MT_view_align_selected', label: 'Align View to Active', source: 'space_view3d.py:1628', items: [
            op('view3d.view_axis', 'Top', {props: {align_active: true, type: 'TOP'}}),
            op('view3d.view_axis', 'Bottom', {props: {align_active: true, type: 'BOTTOM'}}),
            sep,
            op('view3d.view_axis', 'Front', {props: {align_active: true, type: 'FRONT'}}),
            op('view3d.view_axis', 'Back', {props: {align_active: true, type: 'BACK'}}),
            sep,
            op('view3d.view_axis', 'Right', {props: {align_active: true, type: 'RIGHT'}}),
            op('view3d.view_axis', 'Left', {props: {align_active: true, type: 'LEFT'}}),
        ]},
        {id: 'VIEW3D_MT_view_regions', label: 'View Regions', source: 'space_view3d.py:1663', items: [
            op('view3d.clip_border', 'Clipping Region...'),
            op('view3d.render_border', 'Render Region...'),
            sep,
            op('view3d.clear_render_border', 'Clear Render Region'),
        ]},

        // ================================================================== Select
        {
            id: 'VIEW3D_MT_select_object', label: 'Select', source: 'space_view3d.py:1708',
            items: [
                op('object.select_all', 'All', {blender: 'object.select_all SELECT'}),
                op('object.select_none', 'None', {blender: 'object.select_all DESELECT'}),
                op('object.select_invert', 'Invert', {blender: 'object.select_all INVERT'}),
                sep,
                op('view3d.select_box', 'Box Select'),
                op('view3d.select_circle', 'Circle Select'),
                absent('view3d.select_lasso', 'Lasso Select', 'the lasso gesture (`view3d.select_lasso` modes)'),
                sep,
                op('object.select_camera', 'Select Active Camera'),
                op('object.select_mirror', 'Select Mirror'),
                op('object.select_random', 'Select Random'),
                sep,
                sub('VIEW3D_MT_select_object_more_less', {label: 'More/Less'}),
                sep,
                absent('object.select_by_type', 'Select All by Type', '`object.select_by_type`'),
                absent('object.select_grouped', 'Select Grouped', '`object.select_grouped`'),
                absent('object.select_linked', 'Select Linked', '`object.select_linked`'),
                op('object.select_pattern', 'Select Pattern...'),
            ],
        },
        {id: 'VIEW3D_MT_select_object_more_less', label: 'Select More/Less', source: 'space_view3d.py:1678', items: [
            op('object.select_more', 'More'),
            op('object.select_less', 'Less'),
            sep,
            op('object.select_hierarchy', 'Parent', {props: {extend: false, direction: 'PARENT'}}),
            op('object.select_hierarchy', 'Child', {props: {extend: false, direction: 'CHILD'}}),
            sep,
            op('object.select_hierarchy', 'Extend Parent', {props: {extend: true, direction: 'PARENT'}}),
            op('object.select_hierarchy', 'Extend Child', {props: {extend: true, direction: 'CHILD'}}),
        ]},
        {
            id: 'VIEW3D_MT_select_edit_mesh', label: 'Select', source: 'space_view3d.py:1912',
            items: [
                op('mesh.select_all', 'All', {blender: 'mesh.select_all SELECT'}),
                op('mesh.select_none', 'None', {blender: 'mesh.select_all DESELECT'}),
                op('mesh.select_invert', 'Invert', {blender: 'mesh.select_all INVERT'}),
                sep,
                op('view3d.select_box', 'Box Select'),
                op('view3d.select_circle', 'Circle Select'),
                absent('view3d.select_lasso', 'Lasso Select', 'the lasso gesture (`view3d.select_lasso` modes)'),
                sep,
                op('mesh.select_mirror', 'Select Mirror'),
                op('mesh.select_random', 'Select Random'),
                op('mesh.select_nth', 'Checker Deselect'),
                sep,
                sub('VIEW3D_MT_edit_mesh_select_more_less', {label: 'More/Less'}),
                sep,
                absent('VIEW3D_MT_edit_mesh_select_similar', 'Select Similar', '`mesh.select_similar`'),
                sub('VIEW3D_MT_edit_mesh_select_by_trait'),
                sub('VIEW3D_MT_edit_mesh_select_linked'),
                sub('VIEW3D_MT_edit_mesh_select_loops'),
                sep,
                op('mesh.edges_select_sharp', 'Sharp Edges'),
                op('mesh.select_axis', 'Side of Active'),
                sep,
                op('mesh.select_by_attribute', 'By Attribute'),
            ],
        },
        {id: 'VIEW3D_MT_edit_mesh_select_more_less', label: 'Select More/Less', source: 'space_view3d.py:1870', items: [
            op('mesh.select_more', 'More'),
            op('mesh.select_less', 'Less'),
            sep,
            op('mesh.select_next_item', 'Next Active'),
            op('mesh.select_prev_item', 'Previous Active'),
        ]},
        {id: 'VIEW3D_MT_edit_mesh_select_by_trait', label: 'Select All by Trait', source: 'space_view3d.py:1851', items: [
            op('mesh.select_non_manifold', 'Non Manifold', {visible: c => c.selectMode !== 'face'}),
            op('mesh.select_loose', 'Loose Geometry'),
            op('mesh.select_interior_faces', 'Interior Faces'),
            op('mesh.select_face_by_sides', 'Faces by Sides'),
            op('mesh.select_by_pole_count', 'Poles by Count'),
            sep,
            op('mesh.select_ungrouped', 'Ungrouped Vertices'),
        ]},
        {id: 'VIEW3D_MT_edit_mesh_select_linked', label: 'Select Linked', source: 'space_view3d.py:1885', items: [
            op('mesh.select_linked', 'Linked'),
            op('mesh.shortest_path_select', 'Shortest Path'),
            op('mesh.faces_select_linked_flat', 'Linked Flat Faces'),
        ]},
        {id: 'VIEW3D_MT_edit_mesh_select_loops', label: 'Select Loops', source: 'space_view3d.py:1896', items: [
            // The engine's `mesh.select_loop` / `_ring` walk from the active edge only (Alt+click); these
            // are the multi versions, from every selected edge.
            op('mesh.select_edge_loop_multi', 'Edge Loops'),
            op('mesh.select_edge_ring_multi', 'Edge Rings'),
            op('mesh.select_boundary_loop_multi', 'Boundary Loops'),
            sep,
            op('mesh.loop_to_region', 'Loop Inner-Region'),
            op('mesh.region_to_loop', 'Boundary of Selected'),
        ]},

        // ================================================================== Add
        {
            id: 'VIEW3D_MT_add', label: 'Add', source: 'space_view3d.py:2680', operator: 'add.menu', operatorModes: ['object'],
            items: [
                sub('VIEW3D_MT_mesh_add'),
                absent('VIEW3D_MT_curve_add', 'Curve', 'curve objects'),
                absent('VIEW3D_MT_surface_add', 'Surface', 'NURBS surfaces'),
                absent('VIEW3D_MT_metaball_add', 'Metaball', 'metaballs'),
                op('object.text_add', 'Text'),
                op('object.pointcloud_random_add', 'Point Cloud'),
                absent('VIEW3D_MT_grease_pencil_add', 'Grease Pencil', 'Grease Pencil'),
                sep,
                op('object.armature_add', 'Armature'),
                absent('VIEW3D_MT_lattice_add', 'Lattice', 'lattices'),
                sep,
                absent('VIEW3D_MT_empty_add', 'Empty', 'empties'),
                absent('VIEW3D_MT_image_add', 'Image', 'image empties and planes'),
                sep,
                sub('VIEW3D_MT_light_add'),
                absent('VIEW3D_MT_lightprobe_add', 'Light Probe', 'light probes'),
                sep,
                // VIEW3D_MT_camera_add.draw inline (:2736).
                op('object.camera_add', 'Camera'),
                sep,
                op('object.speaker_add', 'Speaker'),
                sep,
                absent('object.effector_add', 'Force Field', 'physics'),
                sep,
                op('object.collection_instance_add', 'Collection Instance...'),
                // Not Blender's: the modelling commands that make a new object from a profile.
                sep,
                op('modelling.lathe', 'Lathe'),
                op('modelling.sweep', 'Sweep'),
            ],
        },
        {
            id: 'VIEW3D_MT_mesh_add', label: 'Mesh', source: 'space_view3d.py:2419', operator: 'add.menu', operatorModes: ['edit'],
            items: [
                op('add.plane', 'Plane', {blender: 'mesh.primitive_plane_add', unavailable: notInEditMesh}),
                op('add.cube', 'Cube', {blender: 'mesh.primitive_cube_add', unavailable: notInEditMesh}),
                op('add.circle', 'Circle', {blender: 'mesh.primitive_circle_add', unavailable: notInEditMesh}),
                op('add.sphere', 'UV Sphere', {blender: 'mesh.primitive_uv_sphere_add', unavailable: notInEditMesh}),
                op('add.icosphere', 'Ico Sphere', {blender: 'mesh.primitive_ico_sphere_add', unavailable: notInEditMesh}),
                op('add.cylinder', 'Cylinder', {blender: 'mesh.primitive_cylinder_add', unavailable: notInEditMesh}),
                op('add.cone', 'Cone', {blender: 'mesh.primitive_cone_add', unavailable: notInEditMesh}),
                op('add.torus', 'Torus', {blender: 'mesh.primitive_torus_add', unavailable: notInEditMesh}),
                sep,
                op('add.grid', 'Grid', {blender: 'mesh.primitive_grid_add', unavailable: notInEditMesh}),
                op('mesh.primitive_monkey_add', 'Monkey'),
            ],
        },
        {
            // `operator_enum("object.light_add", "type")` (:2585) over `rna_enum_light_type_items`:
            // Point, Sun, Spot, Area. `modelling.light` makes three.js lights; Sun is a directional light.
            id: 'VIEW3D_MT_light_add', label: 'Light', source: 'space_view3d.py:2575',
            items: [
                op('modelling.light', 'Point', {blender: 'object.light_add POINT', props: {type: 'point'}}),
                op('modelling.light', 'Sun', {blender: 'object.light_add SUN', props: {type: 'directional'}}),
                op('modelling.light', 'Spot', {blender: 'object.light_add SPOT', props: {type: 'spot'}}),
                op('object.light_add', 'Area', {props: {type: 'AREA'}}),
            ],
        },

        // ================================================================== Object (object mode)
        {
            id: 'VIEW3D_MT_object', label: 'Object', source: 'space_view3d.py:2807',
            items: () => [
                sub('VIEW3D_MT_transform_object'),
                absent('object.origin_set', 'Set Origin', 'object origins (`object.origin_set`)'),
                sub('VIEW3D_MT_mirror'),
                sub('VIEW3D_MT_object_clear'),
                sub('VIEW3D_MT_object_apply'),
                sub('VIEW3D_MT_snap'),
                sep,
                op('object.duplicate', 'Duplicate Objects', {blender: 'object.duplicate_move'}),
                op('object.duplicate_move_linked', 'Duplicate Linked'),
                op('object.join', 'Join'),
                sep,
                op('view3d.copybuffer', 'Copy Objects'),
                op('view3d.pastebuffer', 'Paste Objects'),
                sep,
                absent('VIEW3D_MT_object_asset', 'Asset', 'the asset library'),
                absent('VIEW3D_MT_object_collection', 'Collection', 'collections'),
                sep,
                absent('VIEW3D_MT_object_liboverride', 'Library Override', 'linked libraries'),
                absent('VIEW3D_MT_object_relations', 'Relations', 'instancing and linked data'),
                sub('VIEW3D_MT_object_parent'),
                sub('VIEW3D_MT_object_modifiers'),
                absent('VIEW3D_MT_object_constraints', 'Constraints', 'object constraints'),
                absent('VIEW3D_MT_object_track', 'Track', 'track constraints'),
                absent('VIEW3D_MT_make_links', 'Link/Transfer Data', 'linked data'),
                sep,
                op('object.shade_smooth', 'Shade Smooth'),
                op('object.shade_auto_smooth', 'Shade Auto Smooth'),
                op('object.shade_flat', 'Shade Flat'),
                sep,
                absent('VIEW3D_MT_object_animation', 'Animation', 'animation'),
                absent('VIEW3D_MT_object_rigid_body', 'Rigid Body', 'physics'),
                sep,
                absent('VIEW3D_MT_object_quick_effects', 'Quick Effects', 'physics and particle effects'),
                sep,
                absent('VIEW3D_MT_object_convert', 'Convert', 'other object types to convert between (`object.convert`)'),
                sep,
                sub('VIEW3D_MT_object_showhide'),
                sub('VIEW3D_MT_object_cleanup'),
                sep,
                op('object.delete', 'Delete', {props: undefined, blender: 'object.delete use_global=False'}),
                op('object.delete', 'Delete Global', {unavailable: 'deleting from every scene (there is one scene)'}),
                // Not Blender's: the plugin-modelling commands, one object at a time.
                sep,
                sub('EDITOR_MT_object_commands', {label: 'Commands'}),
            ],
        },
        {
            id: 'VIEW3D_MT_transform_object', label: 'Transform', source: 'space_view3d.py:1313',
            items: [
                ...transformBase,
                sep,
                op('transform.translate', 'Move Texture Space', {props: {texture_space: true}}),
                op('transform.resize', 'Scale Texture Space', {props: {texture_space: true}}),
                sep,
                op('transform.transform', 'Align to Transform Orientation', {props: {mode: 'ALIGN'}}),
                sep,
                op('object.randomize_transform', 'Randomize Transform'),
                op('object.align', 'Align Objects'),
            ],
        },
        {id: 'VIEW3D_MT_object_clear', label: 'Clear', source: 'space_view3d.py:2933', items: [
            op('object.reset_position', 'Location', {blender: 'object.location_clear'}),
            op('object.reset_rotation', 'Rotation', {blender: 'object.rotation_clear'}),
            op('object.reset_scale', 'Scale', {blender: 'object.scale_clear'}),
            sep,
            op('object.origin_clear', 'Origin'),
        ]},
        {id: 'VIEW3D_MT_object_apply', label: 'Apply', source: 'space_view3d.py:3198', operator: 'object.apply_transform', items: [
            op('object.apply_transform', 'Location', {blender: 'object.transform_apply', props: {location: true, rotation: false, scale: false}}),
            op('object.apply_transform', 'Rotation', {blender: 'object.transform_apply', props: {location: false, rotation: true, scale: false}}),
            op('object.apply_transform', 'Scale', {blender: 'object.transform_apply', props: {location: false, rotation: false, scale: true}}),
            op('object.apply_transform', 'All Transforms', {blender: 'object.transform_apply', props: {location: true, rotation: true, scale: true}}),
            op('object.apply_transform', 'Rotation & Scale', {blender: 'object.transform_apply', props: {location: false, rotation: true, scale: true}}),
            sep,
            op('object.transforms_to_deltas', 'Location to Deltas', {props: {mode: 'LOC'}}),
            op('object.transforms_to_deltas', 'Rotation to Deltas', {props: {mode: 'ROT'}}),
            op('object.transforms_to_deltas', 'Scale to Deltas', {props: {mode: 'SCALE'}}),
            op('object.transforms_to_deltas', 'All Transforms to Deltas', {props: {mode: 'ALL'}}),
            op('object.anim_transforms_to_deltas', 'Animated Transforms to Deltas'),
            sep,
            op('object.visual_transform_apply', 'Visual Transform'),
            op('object.convert', 'Visual Geometry to Mesh', {props: {target: 'MESH'}}),
            op('object.visual_geometry_to_objects', 'Visual Geometry to Objects'),
            op('object.duplicates_make_real', 'Make Instances Real'),
        ]},
        {
            // `operator_enum("object.parent_set", "type")` (:3275) lists Object (and Vertex / Vertex
            // (Triangle) for meshes in edit mode); `operator_enum("object.parent_clear", "type")` (:3286),
            // `prop_clear_parent_types` (object_relations.cc:315). The engine's parent and clear both keep the
            // world placement: Blender's Object (with its parent inverse) and Clear and Keep Transformation.
            id: 'VIEW3D_MT_object_parent', label: 'Parent', source: 'space_view3d.py:3266',
            items: [
                op('object.parent', 'Object', {blender: 'object.parent_set OBJECT'}),
                sep,
                op('object.parent_no_inverse_set', 'Make Parent without Inverse', {props: {keep_transform: false}}),
                op('object.parent_no_inverse_set', 'Make Parent without Inverse (Keep Transform)', {props: {keep_transform: true}}),
                sep,
                op('object.parent_clear', 'Clear Parent', {props: {type: 'CLEAR'}}),
                op('object.clear_parent', 'Clear and Keep Transformation', {blender: 'object.parent_clear CLEAR_KEEP_TRANSFORM'}),
                op('object.parent_clear', 'Clear Parent Inverse', {props: {type: 'CLEAR_INVERSE'}}),
            ],
        },
        {id: 'VIEW3D_MT_object_modifiers', label: 'Modifiers', source: 'space_view3d.py:3339', items: [
            absent('OBJECT_MT_modifier_add', 'Add Modifier', 'the live modifier stack in the UI (plugin-modelling has the `modifier` command)'),
            op('object.modifiers_copy_to_selected', 'Copy Modifiers to Selected Objects'),
            sep,
            op('object.modifiers_clear', 'Clear Object Modifiers'),
        ]},
        {id: 'VIEW3D_MT_object_showhide', label: 'Show/Hide', source: 'space_view3d.py:3381', items: [
            op('object.unhide_all', 'Show Hidden Objects', {blender: 'object.hide_view_clear'}),
            sep,
            op('object.hide', 'Hide Selected', {blender: 'object.hide_view_set unselected=False'}),
            op('object.hide_view_set', 'Hide Unselected', {props: {unselected: true}}),
        ]},
        {id: 'VIEW3D_MT_object_cleanup', label: 'Clean Up', source: 'space_view3d.py:3395', items: [
            op('object.vertex_group_clean', 'Clean Vertex Group Weights', {props: {group_select_mode: 'ALL'}}),
            op('object.vertex_group_limit_total', 'Limit Total Vertex Groups', {props: {group_select_mode: 'ALL'}}),
            sep,
            op('object.material_slot_remove_unused', 'Remove Unused Material Slots'),
            op('object.material_slot_remove_all', 'Remove All Materials'),
        ]},
        {
            // Not Blender's. The plugin-modelling commands registered as `modelling.*` object operators
            // (whole-object inset, bevel, solidify, mirror, array ...), and Separate by Loose Parts, which
            // Blender only has in edit mode (Mesh > Separate).
            id: 'EDITOR_MT_object_commands', label: 'Commands',
            items: () => [
                op('object.separate', 'Separate by Loose Parts', {blender: 'mesh.separate LOOSE'}),
                sep,
                ...engine.operators.list(o => o.id.startsWith('modelling.') && o.id !== 'modelling.light'
                    && o.id !== 'modelling.lathe' && o.id !== 'modelling.sweep')
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map(o => op(o.id, o.label)),
            ],
        },

        // ================================================================== shared Transform / Mirror / Snap
        {
            id: 'VIEW3D_MT_transform', label: 'Transform', source: 'space_view3d.py:1278',
            items: [
                ...transformBase,
                sep,
                op('mesh.circularize', 'To Circle'),
                op('mesh.flatten', 'Flatten'),
                op('transform.shrink_fatten', 'Shrink/Fatten'),
                op('mesh.space_edge_loops_evenly', 'Space Edge Loops Evenly'),
                op('transform.skin_resize', 'Skin Resize'),
                op('transform.vertex_warp', 'Warp'),
                op('transform.vertex_random', 'Randomize', {props: {offset: 0.1}}),
            ],
        },
        {
            id: 'VIEW3D_MT_mirror', label: 'Mirror', source: 'space_view3d.py:1379',
            items: [
                op('transform.mirror', 'Interactive Mirror'),
                sep,
                ...(['GLOBAL', 'LOCAL'] as const).flatMap((space, si) => [
                    ...['X', 'Y', 'Z'].map((axis, i) => op('transform.mirror', `${axis} ${space === 'GLOBAL' ? 'Global' : 'Local'}`,
                        {props: {constraint_axis: [i === 0, i === 1, i === 2], orient_type: space}})),
                    ...si === 0 ? [sep] : [],
                ]),
            ],
        },
        {id: 'VIEW3D_MT_snap', label: 'Snap', source: 'space_view3d.py:1406', items: [
            op('view3d.snap_selected_to_grid', 'Selection to Grid'),
            op('view3d.snap_selected_to_cursor', 'Selection to Cursor', {props: {use_offset: false}}),
            op('view3d.snap_selected_to_cursor', 'Selection to Cursor (Keep Offset)', {props: {use_offset: true}}),
            op('view3d.snap_selected_to_active', 'Selection to Active'),
            sep,
            op('view3d.snap_cursor_to_selected', 'Cursor to Selected'),
            op('view3d.snap_cursor_to_center', 'Cursor to World Origin'),
            op('view3d.snap_cursor_to_grid', 'Cursor to Grid'),
            op('view3d.snap_cursor_to_active', 'Cursor to Active'),
        ]},

        // ================================================================== Mesh (edit mode)
        {
            id: 'VIEW3D_MT_edit_mesh', label: 'Mesh', source: 'space_view3d.py:4507',
            items: [
                sub('VIEW3D_MT_transform'),
                sub('VIEW3D_MT_mirror'),
                sub('VIEW3D_MT_snap'),
                sep,
                op('mesh.duplicate', 'Duplicate', {blender: 'mesh.duplicate_move'}),
                sub('VIEW3D_MT_edit_mesh_extrude'),
                sep,
                sub('VIEW3D_MT_edit_mesh_merge', {label: 'Merge'}),
                sub('VIEW3D_MT_edit_mesh_split', {label: 'Split'}),
                separateEnum('VIEW3D_MT_edit_mesh/separate'),
                sep,
                op('mesh.bisect', 'Bisect'),
                op('mesh.knife_project', 'Knife Project'),
                op('mesh.knife', 'Knife', {blender: 'mesh.knife_tool use_occlude_geometry=True only_selected=False'}),
                op('mesh.convex_hull', 'Convex Hull'),
                sep,
                op('mesh.symmetrize', 'Symmetrize'),
                op('mesh.symmetry_snap', 'Snap to Symmetry'),
                sep,
                sub('VIEW3D_MT_edit_mesh_normals'),
                sub('VIEW3D_MT_edit_mesh_shading'),
                absent('VIEW3D_MT_edit_mesh_weights', 'Weights', 'vertex groups and weights'),
                op('mesh.attribute_set', 'Set Attribute'),
                absent('mesh.sort_elements', 'Sort Elements', '`mesh.sort_elements`'),
                sep,
                sub('VIEW3D_MT_edit_mesh_showhide'),
                sub('VIEW3D_MT_edit_mesh_clean'),
                sep,
                sub('VIEW3D_MT_edit_mesh_delete'),
            ],
        },
        {
            // Its `draw` lists what the selection can extrude (:4801-4811).
            id: 'VIEW3D_MT_edit_mesh_extrude', label: 'Extrude', source: 'space_view3d.py:4787',
            items: [
                op('mesh.extrude', 'Extrude Faces', {blender: 'view3d.edit_mesh_extrude_move_normal', visible: () => selCounts().f > 0}),
                op('view3d.edit_mesh_extrude_move_shrink_fatten', 'Extrude Faces Along Normals', {visible: () => selCounts().f > 0}),
                op('mesh.extrude_faces_move', 'Extrude Individual Faces', {visible: () => selCounts().f > 0}),
                op('view3d.edit_mesh_extrude_manifold_normal', 'Extrude Manifold', {visible: () => selCounts().f > 0}),
                op('mesh.extrude_edges_move', 'Extrude Edges', {
                    visible: c => selCounts().e > 0 && (c.selectMode === 'vertex' || c.selectMode === 'edge')}),
                op('mesh.extrude_vertices_move', 'Extrude Vertices', {
                    visible: c => selCounts().v > 0 && c.selectMode === 'vertex'}),
                sep,
                op('mesh.extrude_repeat', 'Extrude Repeat'),
                op('mesh.spin', 'Spin', {props: {angle: 360}}),
            ],
        },
        {
            // `operator_enum("mesh.merge", "type")` (:5194) over `merge_type_itemf` (editmesh_tools.cc:3565):
            // At Center, At Cursor and Collapse always; At First / At Last in vertex select mode when the
            // first / last element of the select history is a vertex.
            id: 'VIEW3D_MT_edit_mesh_merge', label: 'Merge', source: 'space_view3d.py:5188', operator: 'mesh.merge',
            items: [
                op('mesh.merge', 'At Center', {props: {type: 'CENTER'}}),
                op('mesh.merge', 'At Cursor', {props: {type: 'CURSOR'}}),
                op('mesh.merge', 'Collapse', {props: {type: 'COLLAPSE'}}),
                op('mesh.merge', 'At First', {props: {type: 'FIRST'}, visible: c => historyEndIsVert(c, 'first')}),
                op('mesh.merge', 'At Last', {props: {type: 'LAST'}, visible: c => historyEndIsVert(c, 'last')}),
                sep,
                op('mesh.remove_doubles', 'By Distance'),
            ],
        },
        {
            id: 'VIEW3D_MT_edit_mesh_split', label: 'Split', source: 'space_view3d.py:5203',
            items: [
                op('mesh.split', 'Selection'),
                sep,
                // `operator_enum("mesh.edge_split", "type")`, `split_type_items` (editmesh_tools.cc:2054).
                op('mesh.edge_split', 'Faces by Edges', {props: {type: 'EDGE'}}),
                op('mesh.edge_split', 'Faces & Edges by Vertices', {props: {type: 'VERT'}}),
            ],
        },
        {id: 'VIEW3D_MT_edit_mesh_normals', label: 'Normals', source: 'space_view3d.py:5066', items: [
            op('mesh.flip_normals', 'Flip'),
            op('mesh.normals_make_consistent', 'Recalculate Outside', {props: {inside: false}}),
            op('mesh.normals_make_consistent', 'Recalculate Inside', {props: {inside: true}}),
            sep,
            op('mesh.set_normals_from_faces', 'Set from Faces'),
            op('transform.rotate_normal', 'Rotate...'),
            op('mesh.point_normals', 'Point to Target...'),
            op('mesh.merge_normals', 'Merge'),
            op('mesh.split_normals', 'Split'),
            absent('VIEW3D_MT_edit_mesh_normals_average', 'Average', 'custom normals'),
            sep,
            op('mesh.normals_tools', 'Copy Vector', {props: {mode: 'COPY'}}),
            op('mesh.normals_tools', 'Paste Vector', {props: {mode: 'PASTE'}}),
            op('mesh.smooth_normals', 'Smooth Vectors'),
            op('mesh.normals_tools', 'Reset Vectors', {props: {mode: 'RESET'}}),
            sep,
            absent('VIEW3D_MT_edit_mesh_normals_select_strength', 'Select by Face Strength', 'face strength (`mesh.mod_weighted_strength`)'),
            absent('VIEW3D_MT_edit_mesh_normals_set_strength', 'Set Face Strength', 'face strength (`mesh.mod_weighted_strength`)'),
        ]},
        {id: 'VIEW3D_MT_edit_mesh_shading', label: 'Shading', source: 'space_view3d.py:5104', items: [
            op('mesh.faces_shade_smooth', 'Smooth Faces'),
            op('mesh.faces_shade_flat', 'Flat Faces'),
            sep,
            op('mesh.mark_sharp', 'Smooth Edges', {props: {clear: true}}),
            op('mesh.mark_sharp', 'Sharp Edges'),
            sep,
            op('mesh.mark_sharp', 'Smooth Vertices', {props: {useVerts: true, clear: true}}),
            op('mesh.mark_sharp', 'Sharp Vertices', {props: {useVerts: true}}),
        ]},
        {
            // ShowHideMenu with `_operator_name = "mesh"` (:1244, :5218).
            id: 'VIEW3D_MT_edit_mesh_showhide', label: 'Show/Hide', source: 'space_view3d.py:5218',
            items: [
                op('mesh.reveal', 'Reveal Hidden'),
                op('mesh.hide', 'Hide Selected', {props: {unselected: false}}),
                op('mesh.hide', 'Hide Unselected', {props: {unselected: true}}),
            ],
        },
        {id: 'VIEW3D_MT_edit_mesh_clean', label: 'Clean Up', source: 'space_view3d.py:5137', items: [
            op('mesh.delete_loose', 'Delete Loose'),
            sep,
            op('mesh.decimate', 'Decimate Geometry'),
            op('mesh.dissolve_degenerate', 'Degenerate Dissolve'),
            op('mesh.dissolve_limited', 'Limited Dissolve'),
            op('mesh.face_make_planar', 'Make Planar Faces'),
            sep,
            op('mesh.vert_connect_nonplanar', 'Split Non-Planar Faces'),
            op('mesh.vert_connect_concave', 'Split Concave Faces'),
            op('mesh.remove_doubles', 'Merge by Distance'),
            op('mesh.fill_holes', 'Fill Holes'),
        ]},
        {
            // `operator_enum("mesh.delete", "type")` over `prop_mesh_delete_types` (editmesh_tools.cc:532).
            id: 'VIEW3D_MT_edit_mesh_delete', label: 'Delete', source: 'space_view3d.py:5162', operator: 'mesh.delete',
            items: [
                op('mesh.delete', 'Vertices', {props: {type: 'VERT'}}),
                op('mesh.delete', 'Edges', {props: {type: 'EDGE'}}),
                op('mesh.delete', 'Faces', {props: {type: 'FACE'}}),
                op('mesh.delete', 'Only Edges & Faces', {props: {type: 'EDGE_FACE'}}),
                op('mesh.delete', 'Only Faces', {props: {type: 'ONLY_FACE'}}),
                sep,
                op('mesh.dissolve_verts', 'Dissolve Vertices'),
                op('mesh.dissolve_edges', 'Dissolve Edges'),
                op('mesh.dissolve_faces', 'Dissolve Faces'),
                sep,
                op('mesh.dissolve_limited', 'Limited Dissolve'),
                sep,
                op('mesh.edge_collapse', 'Collapse Edges & Faces'),
                op('mesh.delete_edgeloop', 'Edge Loops'),
            ],
        },

        // ================================================================== Vertex / Edge / Face
        {
            id: 'VIEW3D_MT_edit_mesh_vertices', label: 'Vertex', source: 'space_view3d.py:4820', operator: 'mesh.vertices_menu',
            items: [
                op('mesh.extrude_vertices_move', 'Extrude Vertices'),
                op('mesh.dupli_extrude_cursor', 'Extrude to Cursor or Add', {props: {rotate_source: true}}),
                op('mesh.bevel', 'Bevel Vertices', {props: {affect: 'VERTICES'}}),
                sep,
                op('mesh.edge_face_add', 'New Edge/Face from Vertices'),
                op('mesh.vert_connect_path', 'Connect Vertex Path'),
                op('mesh.vert_connect', 'Connect Vertex Pairs'),
                sep,
                op('mesh.rip_move', 'Rip Vertices', {props: {MESH_OT_rip: {use_fill: false}}}),
                op('mesh.rip_move', 'Rip Vertices and Fill', {props: {MESH_OT_rip: {use_fill: true}}}),
                op('mesh.rip_edge_move', 'Rip Vertices and Extend'),
                sep,
                op('mesh.vert_slide', 'Slide Vertices', {blender: 'transform.vert_slide'}),
                op('mesh.vertices_smooth', 'Smooth Vertices', {props: {factor: 0.5}}),
                op('mesh.vertices_smooth_laplacian', 'Smooth Vertices (Laplacian)'),
                sep,
                op('transform.vert_crease', 'Vertex Crease'),
                sep,
                op('mesh.blend_from_shape', 'Blend from Shape'),
                op('mesh.shape_propagate_to_all', 'Propagate to Shapes'),
                sep,
                absent('VIEW3D_MT_vertex_group', 'Vertex Groups', 'vertex groups'),
                absent('VIEW3D_MT_hook', 'Hooks', 'hook modifiers'),
                sep,
                op('object.vertex_parent_set', 'Make Vertex Parent'),
            ],
        },
        {
            id: 'VIEW3D_MT_edit_mesh_edges', label: 'Edge', source: 'space_view3d.py:4874', operator: 'mesh.edges_menu',
            items: [
                op('mesh.extrude_edges_move', 'Extrude Edges'),
                op('mesh.bevel', 'Bevel Edges', {props: {affect: 'EDGES'}}),
                op('mesh.bridge_edge_loops', 'Bridge Edge Loops'),
                op('mesh.screw', 'Screw'),
                sep,
                op('mesh.subdivide', 'Subdivide'),
                op('mesh.subdivide_edgering', 'Subdivide Edge-Ring'),
                op('mesh.unsubdivide', 'Un-Subdivide'),
                sep,
                op('mesh.edge_rotate', 'Rotate Edge CW', {props: {useCcw: false}}),
                op('mesh.edge_rotate', 'Rotate Edge CCW', {props: {useCcw: true}}),
                sep,
                op('mesh.edge_slide', 'Edge Slide', {blender: 'transform.edge_slide'}),
                op('mesh.loopcut_slide', 'Loop Cut and Slide'),
                op('mesh.offset_edge_loops_slide', 'Offset Edge Slide'),
                sep,
                op('transform.edge_bevelweight', 'Edge Bevel Weight'),
                op('transform.edge_crease', 'Edge Crease'),
                sep,
                op('mesh.mark_seam', 'Mark Seam', {props: {clear: false}}),
                op('mesh.mark_seam', 'Clear Seam', {props: {clear: true}}),
                sep,
                op('mesh.mark_sharp', 'Mark Sharp'),
                op('mesh.mark_sharp', 'Clear Sharp', {props: {clear: true}}),
                op('mesh.mark_sharp', 'Mark Sharp from Vertices', {props: {useVerts: true}}),
                op('mesh.mark_sharp', 'Clear Sharp from Vertices', {props: {useVerts: true, clear: true}}),
                op('mesh.set_sharpness_by_angle', 'Set Sharpness by Angle'),
            ],
        },
        {
            id: 'VIEW3D_MT_edit_mesh_faces', label: 'Face', source: 'space_view3d.py:4967', operator: 'mesh.faces_menu',
            items: [
                op('mesh.extrude', 'Extrude Faces', {blender: 'view3d.edit_mesh_extrude_move_normal'}),
                op('view3d.edit_mesh_extrude_move_shrink_fatten', 'Extrude Faces Along Normals'),
                op('mesh.extrude_faces_move', 'Extrude Individual Faces'),
                sep,
                op('mesh.inset', 'Inset Faces'),
                op('mesh.poke', 'Poke Faces'),
                op('mesh.quads_convert_to_tris', 'Triangulate Faces', {props: {quadMethod: 'BEAUTY', ngonMethod: 'BEAUTY'}}),
                op('mesh.tris_convert_to_quads', 'Triangles to Quads'),
                op('mesh.solidify', 'Solidify Faces'),
                op('mesh.wireframe', 'Wireframe'),
                sep,
                op('mesh.fill', 'Fill'),
                op('mesh.fill_grid', 'Grid Fill'),
                op('mesh.beautify_fill', 'Beautify Faces'),
                sep,
                op('mesh.intersect', 'Intersect (Knife)'),
                op('mesh.intersect_boolean', 'Intersect (Boolean)'),
                sep,
                op('mesh.face_split_by_edges', 'Weld Edges into Faces'),
                sep,
                op('mesh.faces_shade_smooth', 'Shade Smooth'),
                op('mesh.faces_shade_flat', 'Shade Flat'),
                sep,
                sub('VIEW3D_MT_edit_mesh_faces_data'),
            ],
        },
        {id: 'VIEW3D_MT_edit_mesh_faces_data', label: 'Face Data', source: 'space_view3d.py:4938', items: [
            op('mesh.colors_rotate', 'Rotate Colors'),
            op('mesh.colors_reverse', 'Reverse Colors'),
            sep,
            op('mesh.uvs_rotate', 'Rotate UVs'),
            op('mesh.uvs_reverse', 'Reverse UVs'),
            sep,
            op('mesh.flip_quad_tessellation', 'Flip Quad Tessellation'),
        ]},
        {
            // `menu_contents("IMAGE_MT_uvs_unwrap")` (space_image.py:406) inline, then the projections.
            id: 'VIEW3D_MT_uv_map', label: 'UV Mapping', source: 'space_view3d.py:1425',
            items: [
                op('uv.unwrap', 'Unwrap Angle Based', {props: {method: 'ANGLE_BASED'}}),
                op('uv.unwrap', 'Unwrap Conformal', {props: {method: 'CONFORMAL'}}),
                op('uv.unwrap', 'Unwrap Minimum Stretch', {props: {method: 'MINIMUM_STRETCH'}}),
                sep,
                op('uv.smart_project', 'Smart UV Project...'),
                op('uv.lightmap_pack', 'Lightmap Pack...'),
                op('uv.follow_active_quads', 'Follow Active Quads...'),
                sep,
                op('uv.cube_project', 'Cube Projection'),
                op('uv.cylinder_project', 'Cylinder Projection'),
                op('uv.sphere_project', 'Sphere Projection'),
                sep,
                op('uv.project_from_view', 'Project from View', {props: {scale_to_bounds: false}}),
                op('uv.project_from_view', 'Project from View (Bounds)', {props: {scale_to_bounds: true}}),
                sep,
                op('mesh.mark_seam', 'Mark Seam', {props: {clear: false}}),
                op('mesh.mark_seam', 'Clear Seam', {props: {clear: true}}),
                sep,
                op('uv.reset', 'Reset'),
            ],
        },

        // ================================================================== context menus
        {
            // One column per enabled select mode (:4605); the editor has one select mode at a time.
            id: 'VIEW3D_MT_edit_mesh_context_menu', label: 'Context Menu', source: 'space_view3d.py:4566',
            items: [
                // --- vertex (:4607) ---
                ...([
                    label('Vertex'), sep,
                    op('mesh.subdivide', 'Subdivide'),
                    sep,
                    op('mesh.extrude_vertices_move', 'Extrude Vertices'),
                    op('mesh.bevel', 'Bevel Vertices', {props: {affect: 'VERTICES'}}),
                    {...sep, visible: () => selCounts().v > 1},
                    op('mesh.edge_face_add', 'New Edge/Face from Vertices', {visible: () => selCounts().v > 1}),
                    op('mesh.vert_connect_path', 'Connect Vertex Path', {visible: () => selCounts().v > 1}),
                    op('mesh.vert_connect', 'Connect Vertex Pairs', {visible: () => selCounts().v > 1}),
                    sep,
                    op('transform.push_pull', 'Push/Pull'),
                    op('transform.shrink_fatten', 'Shrink/Fatten'),
                    op('transform.shear', 'Shear'),
                    op('mesh.vert_slide', 'Slide Vertices', {blender: 'transform.vert_slide'}),
                    op('transform.vertex_random', 'Randomize Vertices', {props: {offset: 0.1}}),
                    op('mesh.vertices_smooth', 'Smooth Vertices', {props: {factor: 0.5}}),
                    op('mesh.vertices_smooth_laplacian', 'Smooth Laplacian'),
                    sep,
                    sub('VIEW3D_MT_mirror', {label: 'Mirror Vertices'}),
                    sub('VIEW3D_MT_snap', {label: 'Snap Vertices'}),
                    sep,
                    op('transform.vert_crease', 'Vertex Crease'),
                    sep,
                    sub('VIEW3D_MT_edit_mesh_merge', {label: 'Merge Vertices', visible: () => selCounts().v > 1}),
                    op('mesh.split', 'Split'),
                    separateEnum('VIEW3D_MT_edit_mesh_context_menu/vertex/separate'),
                    op('mesh.dissolve_verts', 'Dissolve Vertices'),
                    op('mesh.delete', 'Delete Vertices', {props: {type: 'VERT'}}),
                ] as MenuItem[]).map(onlyIn(isMode('vertex'))),
                // --- edge (:4659) ---
                ...([
                    label('Edge'), sep,
                    op('mesh.subdivide', 'Subdivide'),
                    sep,
                    op('mesh.extrude_edges_move', 'Extrude Edges'),
                    op('mesh.bevel', 'Bevel Edges', {props: {affect: 'EDGES'}}),
                    op('mesh.bridge_edge_loops', 'Bridge Edge Loops', {visible: () => selCounts().e >= 2}),
                    op('mesh.edge_face_add', 'New Face from Edges', {visible: () => selCounts().e >= 1}),
                    op('mesh.fill', 'Fill', {visible: () => selCounts().e >= 2}),
                    sep,
                    op('mesh.loopcut_slide', 'Loop Cut and Slide'),
                    op('mesh.offset_edge_loops_slide', 'Offset Edge Slide'),
                    sep,
                    op('mesh.knife', 'Knife', {blender: 'mesh.knife_tool'}),
                    op('mesh.bisect', 'Bisect'),
                    sep,
                    op('mesh.edge_rotate', 'Rotate Edge CW', {props: {useCcw: false}}),
                    op('mesh.edge_slide', 'Edge Slide', {blender: 'transform.edge_slide'}),
                    op('mesh.edge_split', 'Edge Split'),
                    sep,
                    op('transform.edge_bevelweight', 'Edge Bevel Weight'),
                    op('transform.edge_crease', 'Edge Crease'),
                    sep,
                    op('mesh.mark_seam', 'Mark Seam', {props: {clear: false}}),
                    op('mesh.mark_seam', 'Clear Seam', {props: {clear: true}}),
                    sep,
                    op('mesh.mark_sharp', 'Mark Sharp', {props: {clear: false}}),
                    op('mesh.mark_sharp', 'Clear Sharp', {props: {clear: true}}),
                    op('mesh.set_sharpness_by_angle', 'Set Sharpness by Angle'),
                    sep,
                    op('mesh.unsubdivide', 'Un-Subdivide'),
                    op('mesh.split', 'Split'),
                    separateEnum('VIEW3D_MT_edit_mesh_context_menu/edge/separate'),
                    op('mesh.dissolve_edges', 'Dissolve Edges'),
                    op('mesh.delete', 'Delete Edges', {props: {type: 'EDGE'}}),
                ] as MenuItem[]).map(onlyIn(isMode('edge'))),
                // --- face (:4728) ---
                ...([
                    label('Face'), sep,
                    op('mesh.subdivide', 'Subdivide'),
                    sep,
                    op('mesh.extrude', 'Extrude Faces', {blender: 'view3d.edit_mesh_extrude_move_normal'}),
                    op('view3d.edit_mesh_extrude_move_shrink_fatten', 'Extrude Faces Along Normals'),
                    op('mesh.extrude_faces_move', 'Extrude Individual Faces'),
                    op('mesh.inset', 'Inset Faces'),
                    op('mesh.poke', 'Poke Faces'),
                    op('mesh.bridge_edge_loops', 'Bridge Faces', {visible: () => selCounts().f >= 2}),
                    sep,
                    sub('VIEW3D_MT_uv_map', {label: 'UV Unwrap Faces'}),
                    sep,
                    op('mesh.quads_convert_to_tris', 'Triangulate Faces', {props: {quadMethod: 'BEAUTY', ngonMethod: 'BEAUTY'}}),
                    op('mesh.tris_convert_to_quads', 'Triangles to Quads'),
                    sep,
                    op('mesh.faces_shade_smooth', 'Shade Smooth'),
                    op('mesh.faces_shade_flat', 'Shade Flat'),
                    sep,
                    op('mesh.unsubdivide', 'Un-Subdivide'),
                    op('mesh.split', 'Split'),
                    separateEnum('VIEW3D_MT_edit_mesh_context_menu/face/separate'),
                    op('mesh.dissolve_faces', 'Dissolve Faces'),
                    op('mesh.delete', 'Delete Faces', {props: {type: 'FACE'}}),
                ] as MenuItem[]).map(onlyIn(isMode('face'))),
            ],
        },
        {
            // The object-type branches (:2974-3108) for the types this editor has, meshes and lights, then
            // the rows shared by all types.
            id: 'VIEW3D_MT_object_context_menu', label: 'Object', source: 'space_view3d.py:2948',
            items: [
                // --- light (:3049) ---
                op('wm.context_modal_mouse', 'Adjust Light Power', {props: {data_path_item: 'data.energy'}, visible: isLight}),
                op('wm.context_modal_mouse', 'Adjust Light Radius', {props: {data_path_item: 'data.shadow_soft_size'},
                    visible: c => isLight(c) && (lightType(c) === 'PointLight' || lightType(c) === 'SpotLight')}),
                op('wm.context_modal_mouse', 'Adjust Sun Light Angle', {props: {data_path_item: 'data.angle'},
                    visible: c => isLight(c) && lightType(c) === 'DirectionalLight'}),
                {...sep, visible: c => isLight(c) && lightType(c) === 'SpotLight'},
                op('wm.context_modal_mouse', 'Adjust Spot Light Beam Angle', {props: {data_path_item: 'data.spot_size'},
                    visible: c => isLight(c) && lightType(c) === 'SpotLight'}),
                op('wm.context_modal_mouse', 'Adjust Spot Light Blend', {props: {data_path_item: 'data.spot_blend'},
                    visible: c => isLight(c) && lightType(c) === 'SpotLight'}),
                {...sep, visible: isLight},
                op('object.transform_axis_target', 'Look at Surface', {visible: isLight}),
                {...sep, visible: isLight},
                // --- mesh (:3111-3146) ---
                ...([
                    op('object.shade_smooth', 'Shade Smooth'),
                    op('object.shade_auto_smooth', 'Shade Auto Smooth'),
                    op('object.shade_flat', 'Shade Flat'),
                    sep,
                    op('object.join', 'Join', {visible: c => c.selectedObjects.length > 1}),
                    absent('object.convert', 'Convert To', 'other object types to convert between (`object.convert`)'),
                    absent('object.origin_set', 'Set Origin', 'object origins (`object.origin_set`)'),
                    sep,
                ] as MenuItem[]).map(onlyIn(c => !!activeObject(c) && !isLight(c))),
                // --- every type (:3148) ---
                op('view3d.copybuffer', 'Copy Objects'),
                op('view3d.pastebuffer', 'Paste Objects'),
                sep,
                op('object.duplicate', 'Duplicate Objects', {blender: 'object.duplicate_move'}),
                op('object.duplicate_move_linked', 'Duplicate Linked'),
                sep,
                op('edit.rename', 'Rename Active Object...', {blender: 'wm.call_panel TOPBAR_PT_name'}),
                sep,
                sub('VIEW3D_MT_mirror'),
                sub('VIEW3D_MT_snap'),
                sub('VIEW3D_MT_object_parent'),
                absent('OBJECT_MT_move_to_collection', 'Move to Collection', 'collections'),
                sep,
                op('anim.keyframe_insert', 'Insert Keyframe'),
                op('anim.keyframe_insert_menu', 'Insert Keyframe with Keying Set...', {props: {always_prompt: true}}),
                sep,
                op('object.delete', 'Delete', {blender: 'object.delete use_global=False'}),
            ],
        },
    ]

    /** `prop_separate_types` (editmesh_tools.cc:4647): `operator_menu_enum("mesh.separate", "type")` (:4528) and P's `WM_menu_invoke`. */
    function separateItems(): MenuItem[] {
        return [
            op('mesh.separate', 'Selection', {props: {type: 'SELECTED'}}),
            op('mesh.separate', 'By Material', {blender: 'mesh.separate MATERIAL', unavailable: 'separating by material'}),
            op('mesh.separate', 'By Loose Parts', {props: {type: 'LOOSE'}}),
        ]
    }
    function separateEnum(key: string): MenuSubmenuItem {
        return sub(key, {label: 'Separate', items: separateItems()})
    }

    /** `merge_type_itemf`: the first / last entry of the select history is a vertex, in vertex select mode. */
    function historyEndIsVert(ctx: EditorContext, end: 'first' | 'last'): boolean {
        const bm = me.state?.bm
        if (!bm || ctx.selectMode !== 'vertex' || !bm.selectHistory.length) return false
        const h = end === 'first' ? bm.selectHistory[0] : bm.selectHistory[bm.selectHistory.length - 1]
        return h.elem instanceof BMVert
    }

    // P (`mesh.separate` without props): the operator's `type` enum as a popup (`WM_menu_invoke`).
    menus.push({id: 'MESH_OT_separate.type', label: 'Separate', source: 'editmesh_tools.cc:4645', items: separateItems()})

    for (const m of menus) engine.menus.register(m)
}

/** Gate rows on a condition, keeping their own `visible` (an `if` around a block of `layout` calls). */
function onlyIn(pred: MenuPredicate) {
    return (item: MenuItem): MenuItem => {
        const own = item.visible
        return {...item, visible: own ? (c: EditorContext) => pred(c) && own(c) : pred} as MenuItem
    }
}
