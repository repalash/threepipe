"""
export_assets.py — Blender Python script to export all referenced assets from geometry
nodes as individual .glb files.

Usage:
  blender --background myfile.blend --python export_assets.py -- --output ./assets/

Reads the scene, identifies all collections and objects referenced by geometry node
modifiers, and exports each as a separate .glb file with a manifest.
"""

import bpy
import json
import sys
import os


def get_args():
    """Parse arguments after '--' separator."""
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    output_dir = "./assets"
    manifest_path = "./phase3_asset_manifest.json"

    for i, arg in enumerate(argv):
        if arg == "--output" and i + 1 < len(argv):
            output_dir = argv[i + 1]
        elif arg == "--manifest" and i + 1 < len(argv):
            manifest_path = argv[i + 1]

    return output_dir, manifest_path


def find_geo_node_references():
    """Find all objects and collections referenced by geometry node modifiers."""
    referenced_objects = set()
    referenced_collections = set()
    referenced_materials = set()

    def scan_tree(tree, visited=None):
        if visited is None:
            visited = set()
        if tree.name in visited:
            return
        visited.add(tree.name)

        for node in tree.nodes:
            # Check for collection references
            if node.bl_idname == 'GeometryNodeCollectionInfo':
                for inp in node.inputs:
                    if inp.name == 'Collection' and hasattr(inp, 'default_value') and inp.default_value:
                        referenced_collections.add(inp.default_value.name)

            # Check for object references
            if node.bl_idname == 'GeometryNodeObjectInfo':
                for inp in node.inputs:
                    if inp.name == 'Object' and hasattr(inp, 'default_value') and inp.default_value:
                        referenced_objects.add(inp.default_value.name)

            # Check socket defaults for any object/collection/material
            for inp in node.inputs:
                if hasattr(inp, 'default_value'):
                    dv = inp.default_value
                    if isinstance(dv, bpy.types.Object):
                        referenced_objects.add(dv.name)
                    elif isinstance(dv, bpy.types.Collection):
                        referenced_collections.add(dv.name)
                    elif isinstance(dv, bpy.types.Material):
                        referenced_materials.add(dv.name)

            # Recurse into sub-groups
            if node.bl_idname == 'GeometryNodeGroup' and node.node_tree:
                scan_tree(node.node_tree, visited)

    for obj in bpy.data.objects:
        for mod in obj.modifiers:
            if mod.type == 'NODES' and mod.node_group:
                scan_tree(mod.node_group)

                # Also check modifier input overrides for object/collection refs
                # (ObjectInfo/CollectionInfo nodes often get their values from the modifier, not the node)
                for key in mod.keys():
                    if key.startswith("Input_") and not key.endswith(("_use_attribute", "_attribute_name")):
                        try:
                            val = mod[key]
                            if isinstance(val, bpy.types.Object):
                                referenced_objects.add(val.name)
                            elif isinstance(val, bpy.types.Collection):
                                referenced_collections.add(val.name)
                            elif isinstance(val, bpy.types.Material):
                                referenced_materials.add(val.name)
                        except Exception:
                            pass

    # Also add all objects within referenced collections
    collection_objects = set()
    for coll_name in referenced_collections:
        coll = bpy.data.collections.get(coll_name)
        if coll:
            for obj in coll.all_objects:
                collection_objects.add(obj.name)

    return referenced_objects, referenced_collections, referenced_materials, collection_objects


def sanitize_filename(name):
    """Make a safe filename from a Blender name."""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name)


def flatten_procedural_materials(obj):
    """Replace procedural materials with flat-color Principled BSDF for glTF export.

    The glTF exporter only understands Principled BSDF with a flat Base Color.
    Complex shader setups (MixShader, Anisotropic, custom groups) export as white.

    Strategy:
    1. If material has Principled BSDF with linked Base Color → trace the chain for a flat color
    2. If material has Principled BSDF with unlinked Base Color → already flat, skip
    3. If trace fails or no Principled BSDF → use material.diffuse_color (viewport color) as fallback
    4. For fallback: replace the entire Surface connection with a new Principled BSDF using the fallback color

    Returns restore info for undoing after export."""
    if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT'}:
        return []
    if not hasattr(obj.data, 'materials') or not obj.data.materials:
        return []

    restore_info = []

    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue

        tree = mat.node_tree

        # Find Principled BSDF (if any)
        principled = None
        for node in tree.nodes:
            if node.bl_idname == 'ShaderNodeBsdfPrincipled':
                principled = node
                break

        if principled:
            bc_input = principled.inputs.get('Base Color')
            if not bc_input or not bc_input.is_linked:
                continue  # Already flat color on Principled BSDF — glTF handles this

            # Try to trace the color chain
            color = _trace_base_color(bc_input.links[0].from_node, bc_input.links[0].from_socket)
            if color is None:
                # Trace failed — use Principled BSDF's Base Color default (the unlinked value).
                # This is more accurate than material.diffuse_color (viewport color), which is
                # often just Blender's default (0.8, 0.8, 0.8) regardless of the actual material.
                bc_default = bc_input.default_value
                color = (bc_default[0], bc_default[1], bc_default[2])
                print(f"    Trace failed for {mat.name}, using Principled Base Color default")

            # Replace linked input with flat color
            original_from = bc_input.links[0].from_socket
            tree.links.remove(bc_input.links[0])
            bc_input.default_value = (color[0], color[1], color[2], 1.0)
            restore_info.append({
                'type': 'unlink',
                'material': mat,
                'original_from_socket': original_from,
                'bc_input': bc_input,
            })
            print(f"    Flattened {mat.name}: ({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f})")
            continue

        # Fallback: no Principled BSDF, or trace failed.
        # Use material.diffuse_color (viewport display color) as the base color.
        # Replace the Surface connection on Material Output with a new Principled BSDF.
        dc = mat.diffuse_color
        color = (dc[0], dc[1], dc[2])

        # Find Material Output
        mat_output = None
        for node in tree.nodes:
            if node.bl_idname == 'ShaderNodeOutputMaterial' and node.is_active_output:
                mat_output = node
                break
        if not mat_output:
            continue

        surface_input = mat_output.inputs.get('Surface')
        if not surface_input:
            continue

        # Save original Surface connection
        original_surface_from = surface_input.links[0].from_socket if surface_input.is_linked else None

        # Remove existing Surface link
        if surface_input.is_linked:
            tree.links.remove(surface_input.links[0])

        # Create a temporary Principled BSDF with the diffuse_color
        temp_principled = tree.nodes.new('ShaderNodeBsdfPrincipled')
        temp_principled.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
        temp_principled.inputs['Roughness'].default_value = 0.5
        tree.links.new(temp_principled.outputs['BSDF'], surface_input)

        restore_info.append({
            'type': 'replace_surface',
            'material': mat,
            'tree': tree,
            'mat_output': mat_output,
            'surface_input': surface_input,
            'original_surface_from': original_surface_from,
            'temp_node': temp_principled,
        })
        print(f"    Fallback {mat.name}: diffuse_color ({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f})")

    return restore_info


def _trace_base_color(node, socket, depth=0):
    """Trace backwards through the node chain to find a flat base color.
    Handles: ShaderNodeGroup (Dirt/Grunge), ShaderNodeMix, ShaderNodeTexBrick, ShaderNodeRGB."""
    if depth > 6:
        return None

    if node.bl_idname == 'ShaderNodeRGB':
        val = node.outputs[0].default_value
        return (val[0], val[1], val[2])

    if node.bl_idname == 'ShaderNodeTexBrick':
        # Use Color1 as the dominant brick color
        val = node.inputs['Color1'].default_value
        return (val[0], val[1], val[2])

    if node.bl_idname == 'ShaderNodeGroup':
        # Check "Base Color" input to the group
        bc = node.inputs.get('Base Color')
        if bc:
            if bc.is_linked:
                return _trace_base_color(bc.links[0].from_node, bc.links[0].from_socket, depth + 1)
            val = bc.default_value
            return (val[0], val[1], val[2])
        # Check "Color" input
        for inp in node.inputs:
            if 'color' in inp.name.lower():
                if inp.is_linked:
                    return _trace_base_color(inp.links[0].from_node, inp.links[0].from_socket, depth + 1)
                if hasattr(inp, 'default_value'):
                    val = inp.default_value
                    if hasattr(val, '__len__') and len(val) >= 3:
                        return (val[0], val[1], val[2])
        return None

    if node.bl_idname in ('ShaderNodeMix', 'ShaderNodeMixRGB'):
        # Try input A first (usually the main color), then B
        for inp_name in ['A', 'B', 'Color1', 'Color2']:
            for inp in node.inputs:
                if inp.name == inp_name:
                    if inp.is_linked:
                        result = _trace_base_color(inp.links[0].from_node, inp.links[0].from_socket, depth + 1)
                        if result:
                            return result
                    elif hasattr(inp, 'default_value'):
                        val = inp.default_value
                        if hasattr(val, '__len__') and len(val) >= 3:
                            if val[0] != 0 or val[1] != 0 or val[2] != 0:
                                return (val[0], val[1], val[2])
        return None

    return None


def restore_materials(restore_info):
    """Restore original material connections after export."""
    for info in restore_info:
        mat = info['material']
        tree = mat.node_tree

        if info.get('type') == 'replace_surface':
            # Remove temporary Principled BSDF and reconnect original Surface
            temp_node = info['temp_node']
            surface_input = info['surface_input']
            # Remove link to temp node
            if surface_input.is_linked:
                tree.links.remove(surface_input.links[0])
            # Remove temp node
            tree.nodes.remove(temp_node)
            # Reconnect original
            if info['original_surface_from']:
                tree.links.new(info['original_surface_from'], surface_input)
        else:
            # Original unlink type — reconnect Base Color
            bc_input = info['bc_input']
            tree.links.new(info['original_from_socket'], bc_input)



def export_object_as_glb(obj, filepath):
    """Select and export a single object as .glb. Bakes procedural materials if needed.
    Handles: hide_render objects, unevaluated modifiers (Screw, Solidify, Bevel, etc.)."""
    # Ensure object is in the view layer
    scene_coll = bpy.context.scene.collection
    linked = False
    if obj.name not in bpy.context.view_layer.objects:
        scene_coll.objects.link(obj)
        bpy.context.view_layer.update()
        linked = True

    # Temporarily unhide for export (geometry node refs are often hide_render=True)
    was_hidden_render = obj.hide_render
    was_hidden_viewport = obj.hide_get()
    obj.hide_render = False
    obj.hide_set(False)

    # If object has modifiers, evaluate them into the mesh so the GLB has the final shape.
    # Without this, objects like well_brick (2 verts + Screw+Solidify+Bevel) export empty.
    old_mesh = None
    new_mesh = None
    old_mods = []
    if obj.modifiers:
        dg = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(dg)
        new_mesh = bpy.data.meshes.new_from_object(eval_obj)
        if new_mesh and len(new_mesh.vertices) > 0:
            old_mesh = obj.data
            old_mods = [(m.name, m.type) for m in obj.modifiers]
            obj.data = new_mesh
            for mod in list(obj.modifiers):
                obj.modifiers.remove(mod)

    # Flatten procedural materials to flat colors for glTF export
    restore_info = flatten_procedural_materials(obj)

    # Deselect all objects without using bpy.ops (which requires viewport context)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB',
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )
    obj.select_set(False)

    # Restore original materials
    if restore_info:
        restore_materials(restore_info)

    # Restore modifiers and mesh
    if old_mesh:
        obj.data = old_mesh
        if new_mesh:
            bpy.data.meshes.remove(new_mesh)

    # Restore visibility
    obj.hide_render = was_hidden_render
    obj.hide_set(was_hidden_viewport)

    if linked:
        scene_coll.objects.unlink(obj)


def export_collection_members(collection, output_dir):
    """Export each member of a collection as an individual .glb.
    Returns list of {name, filename} for the manifest.

    Handles two types of collection members:
    1. MESH/CURVE objects: exported directly as individual GLBs
    2. EMPTY objects with instance_collection: exports all mesh children of
       the instanced sub-collection as a single GLB (joins them).
       This handles the common Blender pattern where a collection member
       is an EMPTY that instances a sub-collection of parts (e.g. flower petals + stem + leaves).
    """
    scene_coll = bpy.context.scene.collection
    linked = False
    if collection.name not in [c.name for c in scene_coll.children]:
        scene_coll.children.link(collection)
        bpy.context.view_layer.update()
        linked = True

    members = []
    # Only iterate direct objects of the collection (not nested sub-collections)
    for obj in collection.objects:
        safe_name = sanitize_filename(obj.name)
        filename = f"object_{safe_name}.glb"
        filepath = os.path.join(output_dir, filename)

        if os.path.exists(filepath):
            members.append({"name": obj.name, "filename": filename})
            print(f"    Already exported: {obj.name} → {filename}")
            continue

        if obj.type in {'MESH', 'CURVE', 'SURFACE', 'FONT'}:
            # Direct mesh/curve — export as-is
            try:
                export_object_as_glb(obj, filepath)
                members.append({"name": obj.name, "filename": filename})
                print(f"    Exported: {obj.name} → {filename}")
            except Exception as e:
                print(f"    [WARN] Failed to export '{obj.name}': {e}")

        elif obj.type == 'EMPTY' and obj.instance_collection:
            # Collection-instancing EMPTY — export all mesh children of the
            # instanced sub-collection as a single GLB.
            sub_coll = obj.instance_collection
            try:
                _export_sub_collection_as_glb(sub_coll, filepath, obj.name)
                members.append({"name": obj.name, "filename": filename})
                print(f"    Exported: {obj.name} (sub-collection '{sub_coll.name}') → {filename}")
            except Exception as e:
                print(f"    [WARN] Failed to export sub-collection for '{obj.name}': {e}")

    if linked:
        scene_coll.children.unlink(collection)

    return members


def _export_sub_collection_as_glb(sub_coll, filepath, display_name=""):
    """Export all mesh/curve objects in a sub-collection as a single GLB.
    Handles: curves (convert to mesh), flatten materials, multi-object selection export."""
    scene_coll = bpy.context.scene.collection

    # Link sub-collection to scene if needed
    sub_linked = False
    if sub_coll.name not in [c.name for c in scene_coll.children]:
        scene_coll.children.link(sub_coll)
        bpy.context.view_layer.update()
        sub_linked = True

    # Deselect all
    for o in bpy.context.view_layer.objects:
        o.select_set(False)

    # Unhide, evaluate modifiers, flatten materials, and select exportable objects
    all_restore_info = []
    visibility_restore = []  # (child, was_hidden_render, was_hidden_viewport)
    mesh_restore = []  # (child, old_mesh, new_mesh)
    selected_count = 0
    active_obj = None
    for child in sub_coll.all_objects:
        if child.type in {'MESH', 'CURVE', 'SURFACE', 'FONT'}:
            # Unhide (same as export_object_as_glb)
            was_hidden_render = child.hide_render
            was_hidden_viewport = child.hide_get()
            child.hide_render = False
            child.hide_set(False)
            visibility_restore.append((child, was_hidden_render, was_hidden_viewport))

            # Evaluate modifiers (same as export_object_as_glb)
            if child.modifiers:
                dg = bpy.context.evaluated_depsgraph_get()
                eval_child = child.evaluated_get(dg)
                new_mesh = bpy.data.meshes.new_from_object(eval_child)
                if new_mesh and len(new_mesh.vertices) > 0:
                    old_mesh = child.data
                    child.data = new_mesh
                    for mod in list(child.modifiers):
                        child.modifiers.remove(mod)
                    mesh_restore.append((child, old_mesh, new_mesh))

            restore_info = flatten_procedural_materials(child)
            all_restore_info.extend(restore_info)
            child.select_set(True)
            active_obj = child
            selected_count += 1

    if selected_count == 0:
        if sub_linked:
            scene_coll.children.unlink(sub_coll)
        raise ValueError(f"No exportable objects in sub-collection '{sub_coll.name}'")

    bpy.context.view_layer.objects.active = active_obj

    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB',
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )

    # Deselect
    for child in sub_coll.all_objects:
        try:
            child.select_set(False)
        except RuntimeError:
            pass

    # Restore materials
    if all_restore_info:
        restore_materials(all_restore_info)

    # Restore modifiers and mesh
    for child, old_mesh, new_mesh in mesh_restore:
        child.data = old_mesh
        if new_mesh:
            bpy.data.meshes.remove(new_mesh)

    # Restore visibility
    for child, was_hidden_render, was_hidden_viewport in visibility_restore:
        child.hide_render = was_hidden_render
        child.hide_set(was_hidden_viewport)

    if sub_linked:
        scene_coll.children.unlink(sub_coll)


def export_collection_as_glb(collection, filepath):
    """LEGACY: Select all objects in a collection and export as one .glb.
    Prefer export_collection_members() for Pick Instance support."""
    bpy.ops.object.select_all(action='DESELECT')

    scene_coll = bpy.context.scene.collection
    linked = False
    if collection.name not in [c.name for c in scene_coll.children]:
        scene_coll.children.link(collection)
        bpy.context.view_layer.update()
        linked = True

    exported_names = []
    for obj in collection.all_objects:
        if obj.type in {'MESH', 'CURVE', 'SURFACE', 'FONT'}:
            try:
                obj.select_set(True)
                exported_names.append(obj.name)
            except RuntimeError:
                print(f"  [WARN] Cannot select '{obj.name}', skipping.")

    if not exported_names:
        if linked:
            scene_coll.children.unlink(collection)
        return False

    bpy.context.view_layer.objects.active = bpy.data.objects[exported_names[0]]

    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB',
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=True,
    )

    bpy.ops.object.select_all(action='DESELECT')
    # Unlink collection if we linked it temporarily
    if linked:
        scene_coll.children.unlink(collection)
    return True


def export_textures(output_dir):
    """Export all images used by referenced materials."""
    exported = []
    for img in bpy.data.images:
        if img.name in ('Viewer Node', 'Render Result'):
            continue
        if img.packed_file or img.filepath:
            safe_name = sanitize_filename(img.name)
            ext = os.path.splitext(img.filepath)[1] if img.filepath else ".png"
            if not ext:
                ext = ".png"
            out_path = os.path.join(output_dir, f"texture_{safe_name}{ext}")

            if img.packed_file:
                # Unpack to the output directory
                img.filepath_raw = out_path
                img.save()
            elif img.filepath and os.path.exists(bpy.path.abspath(img.filepath)):
                import shutil
                shutil.copy2(bpy.path.abspath(img.filepath), out_path)

            exported.append({
                "name": img.name,
                "filename": f"texture_{safe_name}{ext}",
                "size": [img.size[0], img.size[1]] if img.size[0] > 0 else None,
            })

    return exported


def main():
    output_dir, manifest_path = get_args()
    os.makedirs(output_dir, exist_ok=True)

    ref_objects, ref_collections, ref_materials, coll_objects = find_geo_node_references()

    manifest = {
        "blend_file": bpy.data.filepath,
        "collections": [],
        "objects": [],
        "textures": [],
    }

    print(f"\n=== Exporting Assets ===")
    print(f"Referenced collections: {sorted(ref_collections)}")
    print(f"Referenced objects: {sorted(ref_objects)}")
    print(f"Objects in collections: {sorted(coll_objects)}")

    # Export collections — each member as a separate GLB for Pick Instance support
    for coll_name in sorted(ref_collections):
        coll = bpy.data.collections.get(coll_name)
        if not coll:
            print(f"  [WARN] Collection '{coll_name}' not found, skipping.")
            continue

        print(f"  Exporting collection '{coll_name}' members individually:")
        members = export_collection_members(coll, output_dir)

        manifest["collections"].append({
            "name": coll_name,
            "object_count": len(members),
            "members": members,  # [{name, filename}, ...]
        })

    # Export individual objects (not already in a collection export)
    for obj_name in sorted(ref_objects):
        if obj_name in coll_objects:
            continue  # Already exported as part of a collection

        obj = bpy.data.objects.get(obj_name)
        if not obj:
            print(f"  [WARN] Object '{obj_name}' not found, skipping.")
            continue
        if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT'}:
            print(f"  [SKIP] Object '{obj_name}' is type {obj.type}, skipping.")
            continue

        safe_name = sanitize_filename(obj_name)
        filepath = os.path.join(output_dir, f"object_{safe_name}.glb")

        print(f"  Exporting object '{obj_name}' -> {filepath}")
        export_object_as_glb(obj, filepath)

        manifest["objects"].append({
            "name": obj_name,
            "filename": f"object_{safe_name}.glb",
            "type": obj.type,
            "vertex_count": len(obj.data.vertices) if hasattr(obj.data, 'vertices') else None,
        })

    # Export textures
    manifest["textures"] = export_textures(output_dir)

    # Write manifest
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"\n[export_assets] Wrote manifest to: {manifest_path}")
    print(f"[export_assets] Exported {len(manifest['collections'])} collections, "
          f"{len(manifest['objects'])} objects, {len(manifest['textures'])} textures")


if __name__ == "__main__":
    main()
