/**
 * The Design preset: for someone who knows Figma, Photoshop or a trackpad better than Blender.
 *
 * Built on Blender's Industry Compatible keymap
 * (`scripts/presets/keyconfig/keymap_data/industry_compatible_data.py`, Blender main e4e6c79a), whose
 * design task T54963 surveyed Maya, Max, C4D, Modo, Houdini, Unreal and Unity and took the majority
 * answer for each: Q/W/E/R tool keys, Ctrl+A select all, Ctrl+D duplicate, Delete/Backspace delete,
 * F frame, 1/2/3 component modes, Ctrl+E extrude. On top of that, the 2D-tool conventions from the
 * editor research (`ux-patterns.md` §10): Enter drills into edit mode and Esc backs out one level
 * (Figma/Vectary), Ctrl+K opens the palette, Space+drag pans and Alt+drag orbits (Spline/Figma).
 * Line numbers below are into the IC keymap file.
 *
 * Deliberately fewer keys than the Blender preset: T54963 calls the IC keymap "minimal, maintainable.
 * Not every command needs to be mapped" - the menus, context menus and palette carry the rest.
 */

import type {KeymapPreset} from '../../registry'

export const designPreset: KeymapPreset = {
    id: 'design',
    label: 'Design (Figma / trackpad)',
    description: 'Q/W/E/R tools, Enter to edit, Esc to back out, Ctrl+D duplicate. Space+drag pans, Alt+drag or right-drag orbits.',
    // Left drag selects (Figma's marquee); Space+drag pans and Alt+drag orbits (Spline, research §5.2);
    // right drag orbits (Shapr3D, Tinkercad) and the middle button pans (Maya, IC :691).
    navigation: {orbit: 'right', pan: 'middle', zoom: 'wheel', leftDrag: 'select', spacePan: true, altOrbit: true, trackpad: 'pan'},
    bindings: [
        // ── screen / window (km_screen :223, km_window :180) ─────────────────────────────────
        {keys: 'ctrl+z', id: 'edit.undo', repeat: true},                 // ed.undo :254
        {keys: 'ctrl+shift+z', id: 'edit.redo', repeat: true},           // ed.redo :255
        {keys: 'ctrl+alt+z', id: 'edit.history'},                        // ed.undo_history :256
        {keys: 'f9', id: 'edit.repeat_last'},                            // screen.redo_last (shared)
        {keys: 'ctrl+k', id: 'ui.command_palette'},                      // Figma ⌘/ quick actions; IC uses Tab
        {keys: 'f2', id: 'edit.rename'},                                 // Figma: Ctrl+R; F2 is the desktop norm
        {keys: 'ctrl+n', id: 'file.new'},                                // wm.read_homefile :193
        {keys: 'ctrl+o', id: 'file.open'},                               // wm.open_mainfile :195
        {keys: 'ctrl+s', id: 'file.save'},                               // wm.save_mainfile :196
        // ── 3D view (km_view3d :666) ─────────────────────────────────────────────────────────
        {keys: 'f', id: 'view.frame_selected'},                          // view3d.view_selected :693
        {keys: 'a', id: 'view.frame_all'},                               // view3d.view_all :720
        {keys: 'f1', id: 'view.front'},                                  // view3d.view_axis FRONT :726
        {keys: 'ctrl+f1', id: 'view.back'},                              // :732
        {keys: 'f2', id: 'view.right', mode: 'edit'},                    // :728 (F2 renames in object mode)
        {keys: 'f3', id: 'view.top'},                                    // :730
        {keys: 'ctrl+f3', id: 'view.bottom'},                            // :736
        {keys: 'alt+x', id: 'mesh.toggle_xray'},                         // view3d.toggle_xray :791
        {keys: 'shift+a', id: 'add.menu'},                               // VIEW3D_MT_add (shared with Blender)
        {keys: 'q', id: 'select', tool: true},                           // builtin.select_box :117
        {keys: 'w', id: 'object.move', mode: 'object', tool: true},      // builtin.move :118
        {keys: 'e', id: 'object.rotate', mode: 'object', tool: true},    // builtin.rotate :119
        {keys: 'r', id: 'object.scale', mode: 'object', tool: true},     // builtin.scale :120
        {keys: 'w', id: 'mesh.move', mode: 'edit', tool: true},
        {keys: 'e', id: 'mesh.rotate', mode: 'edit', tool: true},
        {keys: 'r', id: 'mesh.scale', mode: 'edit', tool: true},
        // ── object mode (km_object_mode :2525, km_object_non_modal :3494) ────────────────────
        {keys: 'enter', id: 'object.enter_edit', mode: 'object'},        // Figma/Vectary: Enter drills in
        {keys: 'escape', id: 'edit.escape'},                             // Esc backs out one level (research §10)
        {keys: '1', id: 'mesh.select_mode_vertex'},                      // object.mode_set_with_submode :2595 (enters edit mode)
        {keys: '2', id: 'mesh.select_mode_edge'},                        // :2597
        {keys: '3', id: 'mesh.select_mode_face'},                        // :2599
        {keys: '4', id: 'mesh.exit_edit', mode: 'edit'},                 // object.mode_set OBJECT :3504
        {keys: 'ctrl+a', id: 'object.select_all', mode: 'object'},       // object.select_all SELECT :2536
        {keys: 'ctrl+shift+a', id: 'object.select_none', mode: 'object'}, // DESELECT :2537
        {keys: 'ctrl+i', id: 'object.select_invert', mode: 'object'},    // INVERT :2539
        {keys: 'delete', id: 'object.delete', mode: 'object'},           // object.delete :2566
        {keys: 'backspace', id: 'object.delete', mode: 'object'},        // :2562
        {keys: 'ctrl+d', id: 'object.duplicate', mode: 'object'},        // object.duplicate_move :2570
        {keys: 'ctrl+j', id: 'object.join', mode: 'object'},             // object.join :2571
        {keys: 'ctrl+shift+j', id: 'object.separate', mode: 'object'},   // (Figma Ctrl+Shift+G ungroup)
        {keys: 'p', id: 'object.parent', mode: 'object'},                // object.parent_set :2551
        {keys: 'shift+p', id: 'object.clear_parent', mode: 'object'},    // object.parent_clear :2555
        {keys: 'alt+w', id: 'object.reset_position', mode: 'object'},    // object.location_clear :2556
        {keys: 'alt+e', id: 'object.reset_rotation', mode: 'object'},    // object.rotation_clear :2558
        {keys: 'alt+r', id: 'object.reset_scale', mode: 'object'},       // object.scale_clear :2560
        {keys: 'ctrl+h', id: 'object.hide', mode: 'object'},             // object.hide_view_set :2587
        {keys: 'alt+h', id: 'object.unhide_all', mode: 'object'},        // object.hide_view_clear :2586
        // ── edit mode (km_mesh :3060) ────────────────────────────────────────────────────────
        {keys: 'ctrl+a', id: 'mesh.select_all', mode: 'edit'},           // mesh.select_all SELECT :3089
        {keys: 'ctrl+shift+a', id: 'mesh.select_none', mode: 'edit'},    // DESELECT :3090
        {keys: 'ctrl+i', id: 'mesh.select_invert', mode: 'edit'},        // INVERT :3092
        {keys: 'ctrl+l', id: 'mesh.select_linked', mode: 'edit'},        // mesh.select_linked :3095
        {keys: 'ctrl+e', id: 'mesh.extrude', mode: 'edit'},              // view3d.edit_mesh_extrude_move_normal (IC Ctrl+E)
        {keys: 'i', id: 'mesh.inset', mode: 'edit'},                     // mesh.inset (IC I)
        {keys: 'ctrl+b', id: 'mesh.bevel', mode: 'edit'},                // mesh.bevel (IC Ctrl+B)
        {keys: 'm', id: 'mesh.merge', mode: 'edit'},
        {keys: 'ctrl+d', id: 'mesh.duplicate', mode: 'edit'},            // mesh.duplicate_move :3106
        {keys: 'delete', id: 'mesh.delete', mode: 'edit'},               // VIEW3D_MT_edit_mesh_delete :3108
        {keys: 'backspace', id: 'mesh.delete', mode: 'edit'},
        {keys: 'ctrl+backspace', id: 'mesh.dissolve', mode: 'edit'},     // mesh.dissolve_mode :3109
        {keys: 'ctrl+delete', id: 'mesh.dissolve', mode: 'edit'},        // :3110
        {keys: 'ctrl+shift+j', id: 'mesh.separate', mode: 'edit'},
        // The IC keymap binds no key for these (its right-click context menu carries them, as ours does);
        // J is Blender's and free here, P is Modo's "Make Polygon" (free in edit mode: P parents in object mode).
        {keys: 'j', id: 'mesh.vert_connect_path', mode: 'edit'},
        {keys: 'p', id: 'mesh.fill', mode: 'edit', repeat: true},
        {keys: 'dblclick', id: 'mesh.select_loop', mode: 'edit'},        // mesh.loop_select DOUBLE_CLICK :3070 (informative; S wires the pointer)
        {keys: 'alt+dblclick', id: 'mesh.select_ring', mode: 'edit'},    // mesh.edgering_select :3077
    ],
}
