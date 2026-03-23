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


def export_object_as_glb(obj, filepath):
    """Select and export a single object as .glb."""
    # Ensure object is in the view layer
    scene_coll = bpy.context.scene.collection
    linked = False
    if obj.name not in bpy.context.view_layer.objects:
        scene_coll.objects.link(obj)
        bpy.context.view_layer.update()
        linked = True

    bpy.ops.object.select_all(action='DESELECT')
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
    )
    obj.select_set(False)

    if linked:
        scene_coll.objects.unlink(obj)


def export_collection_as_glb(collection, filepath):
    """Select all objects in a collection and export as .glb."""
    bpy.ops.object.select_all(action='DESELECT')

    # Ensure collection is linked to the scene so objects are in the view layer
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

    # Export collections
    for coll_name in sorted(ref_collections):
        coll = bpy.data.collections.get(coll_name)
        if not coll:
            print(f"  [WARN] Collection '{coll_name}' not found, skipping.")
            continue

        safe_name = sanitize_filename(coll_name)
        filepath = os.path.join(output_dir, f"collection_{safe_name}.glb")

        print(f"  Exporting collection '{coll_name}' -> {filepath}")
        success = export_collection_as_glb(coll, filepath)

        manifest["collections"].append({
            "name": coll_name,
            "filename": f"collection_{safe_name}.glb",
            "object_count": len(list(coll.all_objects)),
            "objects": [obj.name for obj in coll.all_objects],
            "exported": success,
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
