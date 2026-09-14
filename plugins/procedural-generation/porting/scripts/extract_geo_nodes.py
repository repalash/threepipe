"""
extract_geo_nodes.py — Blender Python script to introspect and dump geometry node trees.

Usage:
  blender --background myfile.blend --python extract_geo_nodes.py -- --output node_graph.json

Property discovery uses bl_rna introspection (approach learned from tree_clipper by
Algebraic-UG, https://github.com/Algebraic-UG/tree_clipper) so new node types are
handled automatically without code changes.

Tested on Blender 4.0.2 against: synthetic test file, buildify_1_0.blend (410 nodes,
51 node types, 11 sub-trees, 11 collections).
"""

import bpy
import json
import sys
import os
from mathutils import Vector, Euler, Color

# ─── Constants ────────────────────────────────────────────────────────────────

# Properties that should never be exported — they are internal identifiers
# that are read-only in practice or dangerous to set.
# Ref: https://github.com/Algebraic-UG/tree_clipper/issues/39
FORBIDDEN_PROPERTIES = frozenset([
    "bl_idname", "bl_label", "bl_subtype_label", "bl_static_type",
    "bl_description", "bl_icon", "bl_width_default", "bl_width_min",
    "bl_width_max", "bl_height_default", "bl_height_min", "bl_height_max",
    "bl_socket_idname", "rna_type", "type",
])

# Base Node properties that we extract separately at the top level of the node
# dict (location, mute, label, etc). Skip these in per-node-type property
# discovery so we don't duplicate them.
BASE_NODE_PROPERTIES = frozenset([
    "color", "dimensions", "height", "hide", "inputs", "internal_links",
    "label", "location", "mute", "name", "outputs", "parent", "select",
    "show_options", "show_preview", "show_texture", "use_custom_color", "width",
])

# Simple property types we can serialize directly to JSON.
SIMPLE_PROP_TYPES = frozenset(["BOOLEAN", "INT", "FLOAT", "STRING", "ENUM"])


# ─── Argument parsing ─────────────────────────────────────────────────────────

def get_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    output_path = "node_graph.json"
    summary_path = "phase1_summary.json"

    for i, arg in enumerate(argv):
        if arg == "--output" and i + 1 < len(argv):
            output_path = argv[i + 1]
        elif arg == "--summary" and i + 1 < len(argv):
            summary_path = argv[i + 1]

    return output_path, summary_path


# ─── Value serialization ─────────────────────────────────────────────────────

def serialize_value(value):
    """Convert Blender types to JSON-serializable Python types."""
    if value is None:
        return None
    if isinstance(value, (int, float, bool, str)):
        return value
    if isinstance(value, (Vector, Euler, Color)):
        return list(value)
    if isinstance(value, bpy.types.Object):
        return {"_ref": "OBJECT", "name": value.name}
    if isinstance(value, bpy.types.Collection):
        return {"_ref": "COLLECTION", "name": value.name}
    if isinstance(value, bpy.types.Material):
        return {"_ref": "MATERIAL", "name": value.name}
    if isinstance(value, bpy.types.Image):
        return {"_ref": "IMAGE", "name": value.name, "filepath": value.filepath}
    if isinstance(value, bpy.types.NodeTree):
        return {"_ref": "NODE_TREE", "name": value.name}
    try:
        return list(value)
    except (TypeError, AttributeError):
        return str(value)


# ─── bl_rna property extraction ──────────────────────────────────────────────

def extract_simple_properties(obj, exclude=frozenset()):
    """
    Extract all writable simple properties from a Blender object via bl_rna.
    This handles new node types automatically — no hardcoded property lists.

    Approach learned from tree_clipper's export_all_simple_writable_properties.
    """
    props = {}
    for prop in obj.bl_rna.properties:
        if prop.identifier in FORBIDDEN_PROPERTIES:
            continue
        if prop.identifier in exclude:
            continue
        if prop.is_readonly:
            continue
        if prop.type not in SIMPLE_PROP_TYPES:
            continue

        # Skip empty enum strings — they cause issues on import.
        # Ref: tree_clipper export_nodes.py line 140
        if prop.type == "ENUM":
            val = getattr(obj, prop.identifier, "")
            if val == "":
                continue

        try:
            val = getattr(obj, prop.identifier)
        except Exception:
            continue

        # Handle array properties (bool arrays, float arrays, etc.)
        if hasattr(prop, 'is_array') and prop.is_array:
            # Fix dimension mismatch on default_value sockets.
            # Ref: https://github.com/Algebraic-UG/tree_clipper/issues/112
            if prop.identifier == "default_value" and hasattr(obj, "dimensions"):
                dims = obj.dimensions
                val_list = list(val)
                if len(val_list) > dims:
                    val_list = val_list[:dims]
                props[prop.identifier] = val_list
            else:
                props[prop.identifier] = list(val)
        elif prop.type == "ENUM" and hasattr(prop, 'is_enum_flag') and prop.is_enum_flag:
            # Enum flags are sets, convert to list
            props[prop.identifier] = list(val) if isinstance(val, set) else val
        else:
            props[prop.identifier] = val

    return props


def extract_pointer_refs(obj):
    """Extract pointer properties (objects, collections, materials, etc.)."""
    refs = {}
    for prop in obj.bl_rna.properties:
        if prop.type != "POINTER":
            continue
        if prop.identifier in FORBIDDEN_PROPERTIES:
            continue
        try:
            val = getattr(obj, prop.identifier)
        except Exception:
            continue
        if val is None:
            continue
        # Only serialize ID-type pointers that are meaningful references
        if isinstance(val, (bpy.types.Object, bpy.types.Collection,
                            bpy.types.Material, bpy.types.Image,
                            bpy.types.NodeTree)):
            refs[prop.identifier] = serialize_value(val)
    return refs


# ─── Socket extraction ────────────────────────────────────────────────────────

def extract_socket(socket, is_output=False):
    """Extract socket info using bl_rna for default values and metadata."""
    info = {
        "name": socket.name,
        "identifier": socket.identifier,
        "bl_socket_idname": socket.bl_idname if hasattr(socket, 'bl_idname') else "",
        "is_linked": socket.is_linked,
        "is_output": is_output,
    }

    # Use bl_rna type string — more reliable than socket.type which can have
    # enum mismatches on certain socket subtypes in Blender 4.0.
    info["socket_type"] = socket.bl_idname if hasattr(socket, 'bl_idname') else ""

    # Extract default value via bl_rna
    if hasattr(socket, 'default_value') and socket.default_value is not None:
        info["default_value"] = serialize_value(socket.default_value)

    # Min/max if available
    dv_prop = socket.bl_rna.properties.get("default_value")
    if dv_prop and hasattr(dv_prop, 'hard_min'):
        info["min_value"] = dv_prop.hard_min
        info["max_value"] = dv_prop.hard_max
    if dv_prop and hasattr(dv_prop, 'soft_min'):
        info["soft_min"] = dv_prop.soft_min
        info["soft_max"] = dv_prop.soft_max

    return info


# ─── Node extraction ─────────────────────────────────────────────────────────

def extract_node(node):
    """Extract a single node's data using bl_rna property discovery."""
    node_info = {
        "id": node.name,
        "bl_idname": node.bl_idname,
        "label": node.label or node.name,
        "location": list(node.location),
        "mute": node.mute,
    }

    # All writable simple properties (operation, data_type, domain, mode, etc.)
    # Discovered automatically via bl_rna — no hardcoded property names.
    # Excludes base Node properties (location, mute, etc.) that we already
    # extract explicitly above.
    node_info["properties"] = extract_simple_properties(node, exclude=BASE_NODE_PROPERTIES)

    # Pointer references (node_tree for groups, object/collection refs)
    pointer_refs = extract_pointer_refs(node)
    if pointer_refs:
        node_info["pointer_refs"] = pointer_refs

    # Input sockets
    node_info["inputs"] = {}
    for inp in node.inputs:
        node_info["inputs"][inp.identifier] = extract_socket(inp, is_output=False)

    # Output sockets
    node_info["outputs"] = {}
    for out in node.outputs:
        node_info["outputs"][out.identifier] = extract_socket(out, is_output=True)

    # Parent frame
    if node.parent:
        node_info["parent"] = node.parent.name

    # ─── Special node data that bl_rna can't auto-extract ────────────

    # ColorRamp (ShaderNodeValToRGB) — extract element stops
    if hasattr(node, 'color_ramp'):
        ramp = node.color_ramp
        node_info["color_ramp"] = {
            "interpolation": ramp.interpolation,  # LINEAR, EASE, CARDINAL, etc.
            "color_mode": ramp.color_mode,  # RGB, HSV, HSL
            "elements": [
                {
                    "position": elem.position,
                    "color": list(elem.color),  # [r, g, b, a]
                }
                for elem in ramp.elements
            ],
        }

    # FloatCurve / CurveMapping (ShaderNodeFloatCurve, ShaderNodeVectorCurve, etc.)
    if hasattr(node, 'mapping'):
        mapping = node.mapping
        curves_data = []
        for curve in mapping.curves:
            points = [
                {
                    "x": pt.location[0],
                    "y": pt.location[1],
                    "handle_type": pt.handle_type,  # AUTO, VECTOR, AUTO_CLAMPED, etc.
                }
                for pt in curve.points
            ]
            curves_data.append({"points": points})
        node_info["curve_mapping"] = {
            "clip_min_x": mapping.clip_min_x,
            "clip_min_y": mapping.clip_min_y,
            "clip_max_x": mapping.clip_max_x,
            "clip_max_y": mapping.clip_max_y,
            "use_clip": mapping.use_clip,
            "curves": curves_data,
        }

    return node_info


# ─── Node tree extraction ────────────────────────────────────────────────────

def extract_node_tree(tree, visited=None):
    """Recursively extract a full node tree to a dict."""
    if visited is None:
        visited = set()

    if tree.name in visited:
        return {"name": tree.name, "_deduped": True}
    visited.add(tree.name)

    nodes_data = []
    for node in tree.nodes:
        node_info = extract_node(node)

        # If this is a Group node, recurse into the sub-tree
        if hasattr(node, 'node_tree') and node.node_tree:
            node_info["sub_tree"] = extract_node_tree(node.node_tree, visited)

        nodes_data.append(node_info)

    # Extract links
    links_data = []
    for link in tree.links:
        if not link.is_valid:
            continue
        links_data.append({
            "from_node": link.from_node.name,
            "from_socket": link.from_socket.identifier,
            "to_node": link.to_node.name,
            "to_socket": link.to_socket.identifier,
        })

    # Extract group interface (inputs/outputs exposed to the modifier)
    group_inputs = []
    group_outputs = []

    if hasattr(tree, 'interface') and hasattr(tree.interface, 'items_tree'):
        # Blender 4.0+ interface API
        for item in tree.interface.items_tree:
            if not hasattr(item, 'in_out'):
                continue

            socket_info = {
                "name": item.name,
                "identifier": item.identifier if hasattr(item, 'identifier') else item.name,
                "bl_socket_idname": item.bl_socket_idname if hasattr(item, 'bl_socket_idname') else "",
            }

            # Use bl_rna for all simple writable properties on the interface item
            item_props = extract_simple_properties(item)
            socket_info.update(item_props)

            # Ensure we have default_value even if extract_simple_properties missed it
            if "default_value" not in socket_info:
                if hasattr(item, 'default_value'):
                    try:
                        socket_info["default_value"] = serialize_value(item.default_value)
                    except Exception:
                        pass

            # Extract min/max from bl_rna
            dv_prop = item.bl_rna.properties.get("default_value")
            if dv_prop and hasattr(dv_prop, 'hard_min'):
                socket_info["min_value"] = dv_prop.hard_min
                socket_info["max_value"] = dv_prop.hard_max
            if dv_prop and hasattr(dv_prop, 'soft_min'):
                socket_info["soft_min"] = dv_prop.soft_min
                socket_info["soft_max"] = dv_prop.soft_max

            if hasattr(item, 'description') and item.description:
                socket_info["description"] = item.description
            if hasattr(item, 'subtype'):
                socket_info["subtype"] = item.subtype

            if item.in_out == 'INPUT':
                group_inputs.append(socket_info)
            elif item.in_out == 'OUTPUT':
                group_outputs.append(socket_info)
    else:
        # Blender 3.x fallback (UNTESTED — the 3.x API uses tree.inputs/outputs)
        if hasattr(tree, 'inputs'):
            for inp in tree.inputs:
                socket_info = {
                    "name": inp.name,
                    "bl_socket_idname": inp.bl_socket_idname if hasattr(inp, 'bl_socket_idname') else "",
                }
                item_props = extract_simple_properties(inp)
                socket_info.update(item_props)
                if hasattr(inp, 'default_value'):
                    try:
                        socket_info["default_value"] = serialize_value(inp.default_value)
                    except Exception:
                        pass
                group_inputs.append(socket_info)

        if hasattr(tree, 'outputs'):
            for out in tree.outputs:
                socket_info = {
                    "name": out.name,
                    "bl_socket_idname": out.bl_socket_idname if hasattr(out, 'bl_socket_idname') else "",
                }
                group_outputs.append(socket_info)

    return {
        "name": tree.name,
        "nodes": nodes_data,
        "links": links_data,
        "group_inputs": group_inputs,
        "group_outputs": group_outputs,
    }


# ─── Asset reference discovery ────────────────────────────────────────────────

def find_referenced_assets(tree_data, found=None):
    """Walk the extracted tree data to find all referenced objects, collections, etc."""
    if found is None:
        found = {"objects": set(), "collections": set(), "materials": set(), "images": set()}

    for node in tree_data.get("nodes", []):
        # Check pointer_refs for object/collection/material references
        for key, ref in node.get("pointer_refs", {}).items():
            if isinstance(ref, dict) and "_ref" in ref:
                ref_type = ref["_ref"]
                ref_name = ref.get("name")
                if ref_type == "OBJECT" and ref_name:
                    found["objects"].add(ref_name)
                elif ref_type == "COLLECTION" and ref_name:
                    found["collections"].add(ref_name)
                elif ref_type == "MATERIAL" and ref_name:
                    found["materials"].add(ref_name)
                elif ref_type == "IMAGE" and ref_name:
                    found["images"].add(ref_name)

        # Also check socket default values for references
        for socket_id, socket in node.get("inputs", {}).items():
            dv = socket.get("default_value")
            if isinstance(dv, dict) and "_ref" in dv:
                ref_type = dv["_ref"]
                ref_name = dv.get("name")
                if ref_type == "OBJECT" and ref_name:
                    found["objects"].add(ref_name)
                elif ref_type == "COLLECTION" and ref_name:
                    found["collections"].add(ref_name)
                elif ref_type == "MATERIAL" and ref_name:
                    found["materials"].add(ref_name)
                elif ref_type == "IMAGE" and ref_name:
                    found["images"].add(ref_name)

        # Recurse into sub-trees
        if "sub_tree" in node and not node["sub_tree"].get("_deduped"):
            find_referenced_assets(node["sub_tree"], found)

    return found


# ─── Summary builder ──────────────────────────────────────────────────────────

def build_summary(all_trees, all_modifiers, all_assets):
    summary = {
        "blend_file": bpy.data.filepath,
        "blender_version": list(bpy.app.version),
        "tree_count": len(all_trees),
        "trees": [],
        "modifiers": all_modifiers,
        "referenced_assets": {
            "objects": sorted(list(all_assets["objects"])),
            "collections": sorted(list(all_assets["collections"])),
            "materials": sorted(list(all_assets["materials"])),
            "images": sorted(list(all_assets["images"])),
        },
        "total_node_count": 0,
    }

    for tree in all_trees:
        node_count = len(tree.get("nodes", []))
        summary["total_node_count"] += node_count

        node_types = set()
        for node in tree.get("nodes", []):
            node_types.add(node["bl_idname"])

        summary["trees"].append({
            "name": tree["name"],
            "node_count": node_count,
            "link_count": len(tree.get("links", [])),
            "input_count": len(tree.get("group_inputs", [])),
            "output_count": len(tree.get("group_outputs", [])),
            "unique_node_types": sorted(list(node_types)),
            "group_inputs": tree.get("group_inputs", []),
        })

    return summary


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    output_path, summary_path = get_args()

    all_trees = []
    all_modifiers = []
    all_assets = {"objects": set(), "collections": set(), "materials": set(), "images": set()}
    visited = set()

    # Find all geometry node modifiers across all objects
    for obj in bpy.data.objects:
        for mod in obj.modifiers:
            if mod.type == 'NODES' and mod.node_group:
                mod_info = {
                    "object_name": obj.name,
                    "modifier_name": mod.name,
                    "node_group": mod.node_group.name,
                }

                # Extract modifier input overrides
                overrides = {}
                for key in mod.keys():
                    if key.startswith("Input_") or key.startswith("Socket_"):
                        try:
                            val = mod[key]
                            # Convert IDPropertyArray to list
                            if hasattr(val, 'to_list'):
                                val = val.to_list()
                            overrides[key] = serialize_value(val)
                        except Exception:
                            pass
                mod_info["input_overrides"] = overrides
                all_modifiers.append(mod_info)

                tree_data = extract_node_tree(mod.node_group, visited)
                all_trees.append(tree_data)
                find_referenced_assets(tree_data, all_assets)

    # Also check for unattached geometry node trees
    for tree in bpy.data.node_groups:
        if tree.type == 'GeometryNodeTree' and tree.name not in visited:
            tree_data = extract_node_tree(tree, visited)
            all_trees.append(tree_data)
            find_referenced_assets(tree_data, all_assets)

    # Build output
    output = {
        "blend_file": bpy.data.filepath,
        "blender_version": list(bpy.app.version),
        "trees": all_trees,
        "modifiers": all_modifiers,
        "referenced_assets": {
            "objects": sorted(list(all_assets["objects"])),
            "collections": sorted(list(all_assets["collections"])),
            "materials": sorted(list(all_assets["materials"])),
            "images": sorted(list(all_assets["images"])),
        },
    }

    # Write
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    print(f"[extract_geo_nodes] Wrote node graph to: {output_path}")

    summary = build_summary(all_trees, all_modifiers, all_assets)
    os.makedirs(os.path.dirname(os.path.abspath(summary_path)), exist_ok=True)
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"[extract_geo_nodes] Wrote summary to: {summary_path}")

    # Console overview
    print(f"\n=== Geometry Nodes Summary ===")
    print(f"Trees: {len(all_trees)}")
    print(f"Total nodes: {summary['total_node_count']}")
    print(f"Referenced objects: {sorted(list(all_assets['objects']))}")
    print(f"Referenced collections: {sorted(list(all_assets['collections']))}")
    print(f"Referenced materials: {sorted(list(all_assets['materials']))}")
    for tree_info in summary['trees']:
        print(f"\n  Tree: {tree_info['name']}")
        print(f"    Nodes: {tree_info['node_count']}, Links: {tree_info['link_count']}")
        print(f"    Inputs: {[gi['name'] for gi in tree_info['group_inputs']]}")
        print(f"    Node types: {tree_info['unique_node_types']}")


if __name__ == "__main__":
    main()
