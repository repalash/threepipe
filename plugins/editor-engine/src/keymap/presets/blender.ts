/**
 * The Blender preset, ported from Blender's default keymap
 * (`scripts/presets/keyconfig/keymap_data/blender_default.py`, Blender main e4e6c79a, 2026-06).
 * Line numbers below are into that file. Only the keys that have an operator here are bound; keys
 * for things that do not exist yet (knife, loop cut, proportional editing) are left out rather than
 * bound to nothing.
 *
 * Deviations, on purpose:
 * - `A` selects all and `Alt+A` deselects (`_template_items_select_actions`, :420, the 2.8 default),
 *   not the legacy `A` toggle.
 * - Blender's `L` is *select linked under the cursor* (`mesh.select_linked_pick`, :5586); without a
 *   cursor-pick path yet it grows the selection like `Ctrl+L` (:5585). Both keys are bound to it.
 * - Navigation is Blender's: MMB orbits, Shift+MMB pans (`km_view3d` :1651-1652), the wheel zooms, a
 *   left drag box-selects (track S's `dragSelect`), two-finger scroll orbits and Shift+two-finger pans
 *   (TRACKPADPAN :1653-1654), pinch zooms (TRACKPADZOOM :1667). Alt+LMB orbits too - Blender's
 *   "Emulate 3 Button Mouse", which every laptop user switches on. Right drag pans (threepipe's
 *   default); a right click still opens the context menu.
 */

import type {KeymapPreset} from '../../registry'

export const blenderPreset: KeymapPreset = {
    id: 'blender',
    label: 'Blender',
    description: 'Blender 2.8+ keys: Tab, G/R/S, E, X menu, Shift+A, Ctrl+Z. MMB orbits, Shift+MMB pans.',
    navigation: {orbit: 'middle', pan: 'right', zoom: 'wheel', leftDrag: 'select', altOrbit: true, trackpad: 'orbit'},
    bindings: [
        // ── screen / window (km_screen :806, km_window :689) ─────────────────────────────────
        {keys: 'ctrl+z', id: 'edit.undo', repeat: true},                 // ed.undo :839
        {keys: 'ctrl+shift+z', id: 'edit.redo', repeat: true},           // ed.redo :840
        {keys: 'ctrl+alt+z', id: 'edit.history'},                        // ed.undo_history :865
        {keys: 'f9', id: 'edit.repeat_last'},                            // screen.redo_last :860
        {keys: 'shift+r', id: 'edit.repeat', repeat: true},              // screen.repeat_last :830
        {keys: 'f3', id: 'ui.command_palette'},                          // wm.search_menu :775
        {keys: 'f2', id: 'edit.rename'},                                 // topbar.rename (space_topbar.py)
        {keys: 'ctrl+n', id: 'file.new'},                                // wm.read_homefile
        {keys: 'ctrl+o', id: 'file.open'},                               // wm.open_mainfile
        {keys: 'ctrl+s', id: 'file.save'},                               // wm.save_mainfile
        // ── 3D view (km_view3d :1616) ────────────────────────────────────────────────────────
        {keys: 'home', id: 'view.frame_all'},                            // view3d.view_all :1693
        {keys: 'numpaddecimal', id: 'view.frame_selected'},              // view3d.view_selected :1664
        {keys: 'numpad5', id: 'view.toggle_projection'},                 // view3d.view_persportho :1731
        {keys: 'numpad1', id: 'view.front'},                             // view3d.view_axis FRONT :1709
        {keys: 'ctrl+numpad1', id: 'view.back'},
        {keys: 'numpad3', id: 'view.right'},
        {keys: 'ctrl+numpad3', id: 'view.left'},
        {keys: 'numpad7', id: 'view.top'},
        {keys: 'ctrl+numpad7', id: 'view.bottom'},
        {keys: 'alt+z', id: 'mesh.toggle_xray'},                         // view3d.toggle_xray :1867
        {keys: 'shift+a', id: 'add.menu'},                               // VIEW3D_MT_add :4559, VIEW3D_MT_mesh_add :5622
        {keys: 'w', id: 'select', tool: true},                           // builtin.select_box cycle :1586
        // ── object mode (km_object_mode :4516, km_object_non_modal :4614) ────────────────────
        {keys: 'tab', id: 'object.enter_edit', mode: 'object'},          // object.mode_set EDIT :4624
        {keys: 'a', id: 'object.select_all', mode: 'object'},            // object.select_all SELECT :4527
        {keys: 'alt+a', id: 'object.select_none', mode: 'object'},       // object.select_all DESELECT
        {keys: 'ctrl+i', id: 'object.select_invert', mode: 'object'},    // object.select_all INVERT
        {keys: 'x', id: 'object.delete', mode: 'object'},                // object.delete :4551
        {keys: 'delete', id: 'object.delete', mode: 'object'},           // object.delete :4555
        {keys: 'shift+d', id: 'object.duplicate', mode: 'object'},       // object.duplicate_move :4562
        {keys: 'ctrl+j', id: 'object.join', mode: 'object'},             // object.join :4564
        {keys: 'ctrl+p', id: 'object.parent', mode: 'object'},           // object.parent_set :4540
        {keys: 'alt+p', id: 'object.clear_parent', mode: 'object'},      // object.parent_clear :4541
        {keys: 'alt+g', id: 'object.reset_position', mode: 'object'},    // object.location_clear :4545
        {keys: 'alt+r', id: 'object.reset_rotation', mode: 'object'},    // object.rotation_clear :4547
        {keys: 'alt+s', id: 'object.reset_scale', mode: 'object'},       // object.scale_clear :4549
        {keys: 'ctrl+a', id: 'object.apply_transform', mode: 'object'},  // VIEW3D_MT_object_apply :4557
        {keys: 'h', id: 'object.hide', mode: 'object'},                  // object.hide_view_set :4580
        {keys: 'alt+h', id: 'object.unhide_all', mode: 'object'},        // object.hide_view_clear :4580
        {keys: 'g', id: 'object.move', mode: 'object', tool: true},      // transform.translate (gizmo stands in)
        {keys: 'r', id: 'object.rotate', mode: 'object', tool: true},    // transform.rotate
        {keys: 's', id: 'object.scale', mode: 'object', tool: true},     // transform.resize
        // ── edit mode (Mesh keymap :5524) ────────────────────────────────────────────────────
        {keys: 'tab', id: 'mesh.exit_edit', mode: 'edit'},               // object.mode_set toggle :4624
        {keys: '1', id: 'mesh.select_mode_vertex', mode: 'edit'},        // mesh.select_mode :5532 (via _template_items_editmode_mesh_select_mode)
        {keys: '2', id: 'mesh.select_mode_edge', mode: 'edit'},
        {keys: '3', id: 'mesh.select_mode_face', mode: 'edit'},
        {keys: 'a', id: 'mesh.select_all', mode: 'edit'},                // mesh.select_all SELECT :5578
        {keys: 'alt+a', id: 'mesh.select_none', mode: 'edit'},           // mesh.select_all DESELECT
        {keys: 'ctrl+i', id: 'mesh.select_invert', mode: 'edit'},        // mesh.select_all INVERT
        {keys: 'l', id: 'mesh.select_linked', mode: 'edit'},             // mesh.select_linked_pick :5586
        {keys: 'ctrl+l', id: 'mesh.select_linked', mode: 'edit'},        // mesh.select_linked :5585
        {keys: 'g', id: 'mesh.move', mode: 'edit'},                      // transform.translate
        {keys: 'r', id: 'mesh.rotate', mode: 'edit'},                    // transform.rotate
        {keys: 's', id: 'mesh.scale', mode: 'edit'},                     // transform.resize
        {keys: 'e', id: 'mesh.extrude', mode: 'edit'},                   // view3d.edit_mesh_extrude_move_normal :5600
        {keys: 'i', id: 'mesh.inset', mode: 'edit'},                     // mesh.inset :5547
        {keys: 'ctrl+b', id: 'mesh.bevel', mode: 'edit'},                // mesh.bevel :5550
        {keys: 'm', id: 'mesh.merge', mode: 'edit'},                     // VIEW3D_MT_edit_mesh_merge :5618
        {keys: 'y', id: 'mesh.split', mode: 'edit'},                     // mesh.split :5624
        {keys: 'p', id: 'mesh.separate', mode: 'edit'},                  // mesh.separate :5623
        {keys: 'f', id: 'mesh.fill', mode: 'edit', repeat: true},        // mesh.edge_face_add :5620
        {keys: 'shift+d', id: 'mesh.duplicate', mode: 'edit'},           // mesh.duplicate_move :5621
        {keys: 'x', id: 'mesh.delete', mode: 'edit'},                    // VIEW3D_MT_edit_mesh_delete :5634
        {keys: 'delete', id: 'mesh.delete', mode: 'edit'},               // :5635
        {keys: 'ctrl+x', id: 'mesh.dissolve', mode: 'edit'},             // mesh.dissolve_mode :5636
        {keys: 'ctrl+delete', id: 'mesh.dissolve', mode: 'edit'},        // :5637
        {keys: 'alt+click', id: 'mesh.select_loop', mode: 'edit'},       // mesh.loop_select :5561 (click bindings are informative; S wires the pointer)
        {keys: 'ctrl+alt+click', id: 'mesh.select_ring', mode: 'edit'},  // mesh.edgering_select :5567
        {keys: 'shift+v', id: 'mesh.vert_slide', mode: 'edit'},          // transform.vert_slide :5628
        {keys: 'ctrl+r', id: 'mesh.loopcut_slide', mode: 'edit'},        // mesh.loopcut_slide :5539
    ],
}
