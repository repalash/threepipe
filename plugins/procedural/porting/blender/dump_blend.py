"""
dump_blend.py - everything @threepipe/plugin-procedural needs from a .blend to evaluate its geometry nodes
and check the result against Blender 5.2.2.

Usage (Blender 5.2.2):
  blender --background --factory-startup file.blend \
    --python plugins/procedural/porting/blender/dump_blend.py -- --out tmp/gt-5.2.2/<name> \
    [--set "Object:Modifier:Input name=value"]... [--object "Object name"]...

Writes `<out>/dump.json` (+ `<out>/dump.bin` for large arrays):
  blender            version string and build hash
  node_groups        every geometry node group, flat by name (nodes, links in multi-input order, interface)
  objects            every object with a geometry nodes modifier (or each `--object`):
    matrix_world, modifiers (each: node group, input values by interface identifier, enabled),
    input_geometry   the geometry entering the first geometry-nodes modifier, in Blender's element order
    output_geometry  the evaluated geometry (instances with exact references, via evaluated_geometry())
  referenced         objects / collections / images the trees or the modifier inputs point at, with each
                     object's evaluated geometry and transform and each collection's hierarchy
  overrides          the --set values applied before evaluation

v2 of proc's extract_geo_nodes.py: adds multi-input link order (`multi_input_sort_id`), muted links,
socket availability, item collections, zone pairing and panels, and replaces the depsgraph-instance export
(which lost instance identity inside node groups) with `Object.evaluated_geometry()`.
"""

import json
import os
import sys

import bpy

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from geometry_dump import BinWriter, matrix_list, read_geometry, serialize_value  # noqa: E402

FORBIDDEN = frozenset([
    "bl_idname", "bl_label", "bl_subtype_label", "bl_static_type", "bl_description", "bl_icon",
    "bl_width_default", "bl_width_min", "bl_width_max", "bl_height_default", "bl_height_min",
    "bl_height_max", "bl_socket_idname", "rna_type", "type",
])
BASE_NODE = frozenset([
    "color", "dimensions", "height", "hide", "inputs", "internal_links", "label", "location", "mute",
    "name", "outputs", "parent", "select", "show_options", "show_preview", "show_texture",
    "use_custom_color", "width", "location_absolute", "warning_propagation", "color_tag",
    "bl_description", "is_active_output",
])
SIMPLE = frozenset(["BOOLEAN", "INT", "FLOAT", "STRING", "ENUM"])


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out, sets, objects = None, [], []
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]
            i += 2
        elif argv[i] == "--set":
            sets.append(argv[i + 1])
            i += 2
        elif argv[i] == "--object":
            objects.append(argv[i + 1])
            i += 2
        else:
            raise SystemExit(f"unknown argument {argv[i]}")
    if not out:
        raise SystemExit("--out is required")
    return out, sets, objects


def simple_props(rna_owner, exclude=frozenset()):
    props = {}
    for prop in rna_owner.bl_rna.properties:
        name = prop.identifier
        if name in FORBIDDEN or name in exclude or prop.is_readonly:
            continue
        if prop.type in SIMPLE:
            try:
                value = getattr(rna_owner, name)
            except Exception:
                continue
            if prop.type == "ENUM" and getattr(prop, "is_enum_flag", False):
                value = sorted(value)
            elif getattr(prop, "is_array", False):
                value = list(value)
            props[name] = value
        elif prop.type == "POINTER":
            try:
                value = getattr(rna_owner, name)
            except Exception:
                continue
            if isinstance(value, bpy.types.ID):
                props[name] = serialize_value(value)
    return props


def item_collections(node):
    """Dynamic socket item lists: capture_items, repeat_items, index_switch_items, enum_items, bake_items, ..."""
    out = {}
    for prop in node.bl_rna.properties:
        if prop.type != "COLLECTION" or prop.identifier in ("inputs", "outputs", "internal_links"):
            continue
        if not prop.identifier.endswith("items"):
            continue
        items = []
        for item in getattr(node, prop.identifier):
            entry = simple_props(item)
            if hasattr(item, "identifier"):
                entry["identifier"] = item.identifier
            items.append(entry)
        out[prop.identifier] = items
    return out


def socket_info(socket):
    info = {
        "identifier": socket.identifier,
        "name": socket.name,
        "type": socket.bl_idname,
        "enabled": socket.enabled,
        "linked": socket.is_linked,
    }
    if getattr(socket, "is_multi_input", False):
        info["multiInput"] = True
    if getattr(socket, "hide_value", False):
        info["hideValue"] = True
    if hasattr(socket, "default_value"):
        try:
            info["default"] = serialize_value(socket.default_value)
        except Exception:
            pass
    return info


def node_info(node):
    info = {
        "name": node.name,
        "type": node.bl_idname,
        "label": node.label,
        "mute": node.mute,
        "location": list(node.location),
        "properties": simple_props(node, BASE_NODE),
        "inputs": [socket_info(s) for s in node.inputs],
        "outputs": [socket_info(s) for s in node.outputs],
    }
    if node.parent:
        info["parent"] = node.parent.name
    items = item_collections(node)
    if items:
        info["items"] = items
    paired = getattr(node, "paired_output", None)
    if paired is not None:
        info["pairedOutput"] = paired.name
    if getattr(node, "node_tree", None) is not None:
        info["group"] = node.node_tree.name
    if hasattr(node, "color_ramp") and node.color_ramp is not None:
        ramp = node.color_ramp
        info["colorRamp"] = {
            "interpolation": ramp.interpolation,
            "colorMode": ramp.color_mode,
            "hueInterpolation": ramp.hue_interpolation,
            "elements": [{"position": e.position, "color": list(e.color)} for e in ramp.elements],
        }
    if hasattr(node, "mapping") and node.mapping is not None and hasattr(node.mapping, "curves"):
        m = node.mapping
        info["curveMapping"] = {
            "clipMinX": m.clip_min_x, "clipMinY": m.clip_min_y,
            "clipMaxX": m.clip_max_x, "clipMaxY": m.clip_max_y,
            "useClip": m.use_clip, "extend": m.extend, "tone": getattr(m, "tone", None),
            "blackLevel": list(m.black_level), "whiteLevel": list(m.white_level),
            "curves": [{"points": [{"location": list(p.location), "handleType": p.handle_type}
                                   for p in c.points]} for c in m.curves],
        }
    return info


def interface_info(tree):
    items = []
    for item in tree.interface.items_tree:
        entry = {"itemType": item.item_type, "name": item.name}
        if item.item_type == "SOCKET":
            entry["inOut"] = item.in_out
            entry["identifier"] = item.identifier
            entry["socketType"] = item.bl_socket_idname
            entry.update(simple_props(item))
            if hasattr(item, "default_value"):
                try:
                    entry["default"] = serialize_value(item.default_value)
                except Exception:
                    pass
        else:
            entry.update(simple_props(item))
        parent = getattr(item, "parent", None)
        if parent is not None and parent.name:
            entry["panel"] = parent.name
        items.append(entry)
    return items


def tree_info(tree):
    links = []
    for link in tree.links:
        links.append({
            "from": [link.from_node.name, link.from_socket.identifier],
            "to": [link.to_node.name, link.to_socket.identifier],
            "muted": link.is_muted,
            "valid": link.is_valid,
            "sortId": link.multi_input_sort_id,
        })
    return {
        "name": tree.name,
        "description": tree.description,
        "interface": interface_info(tree),
        "nodes": [node_info(n) for n in tree.nodes],
        "links": links,
    }


def collect_groups(tree, out):
    if tree.name in out:
        return
    out[tree.name] = tree_info(tree)
    for node in tree.nodes:
        sub = getattr(node, "node_tree", None)
        if sub is not None and sub.bl_idname == "GeometryNodeTree":
            collect_groups(sub, out)


def modifier_inputs(mod):
    values = {}
    for item in mod.node_group.interface.items_tree:
        if item.item_type != "SOCKET" or item.in_out != "INPUT":
            continue
        key = item.identifier
        entry = {"name": item.name}
        if key in mod.keys():
            entry["value"] = serialize_value(mod[key])
        for suffix in ("_use_attribute", "_attribute_name"):
            if key + suffix in mod.keys():
                entry[suffix[1:]] = serialize_value(mod[key + suffix])
        values[key] = entry
    return values


def apply_sets(sets):
    applied = []
    for spec in sets:
        target, value = spec.split("=", 1)
        obj_name, mod_name, input_name = target.split(":", 2)
        mod = bpy.data.objects[obj_name].modifiers[mod_name]
        item = next(i for i in mod.node_group.interface.items_tree
                    if i.item_type == "SOCKET" and i.in_out == "INPUT" and i.name == input_name)
        current = mod[item.identifier]
        parsed = json.loads(value) if value[:1] in "[{0123456789-tf" else value
        if isinstance(current, bpy.types.ID):
            pool = {"Object": bpy.data.objects, "Collection": bpy.data.collections,
                    "Material": bpy.data.materials, "Image": bpy.data.images}[type(current).__name__]
            parsed = pool[value]
        mod[item.identifier] = parsed
        applied.append({"object": obj_name, "modifier": mod_name, "input": input_name,
                        "identifier": item.identifier, "value": serialize_value(mod[item.identifier])})
    return applied


def geometry_of(obj, writer):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    return read_geometry(obj.evaluated_get(depsgraph).evaluated_geometry(), writer)


def input_geometry(obj, writer):
    """Geometry entering the first enabled nodes modifier: disable it and everything after, evaluate."""
    mods = list(obj.modifiers)
    first = next((i for i, m in enumerate(mods) if m.type == "NODES" and m.show_viewport), None)
    if first is None:
        return None
    saved = [m.show_viewport for m in mods]
    for m in mods[first:]:
        m.show_viewport = False
    try:
        return geometry_of(obj, writer)
    finally:
        for m, s in zip(mods, saved):
            m.show_viewport = s


def referenced_ids(groups, objects):
    found = {"OBJECT": set(), "COLLECTION": set(), "IMAGE": set(), "MATERIAL": set()}

    def visit(value):
        if isinstance(value, dict) and "_ref" in value and value["_ref"] in found:
            found[value["_ref"]].add(value["name"])
        elif isinstance(value, dict):
            for v in value.values():
                visit(v)
        elif isinstance(value, list):
            for v in value:
                visit(v)

    visit(groups)
    visit([o["modifiers"] for o in objects])
    # Collections pull in their objects and children.
    pending = list(found["COLLECTION"])
    while pending:
        coll = bpy.data.collections[pending.pop()]
        for o in coll.objects:
            found["OBJECT"].add(o.name)
        for c in coll.children:
            if c.name not in found["COLLECTION"]:
                found["COLLECTION"].add(c.name)
                pending.append(c.name)
    return found


def main():
    out, sets, only = args()
    os.makedirs(out, exist_ok=True)
    writer = BinWriter(os.path.join(out, "dump.bin"))
    applied = apply_sets(sets)

    groups = {}
    objects = []
    for obj in bpy.data.objects:
        if only and obj.name not in only:
            continue
        mods = [m for m in obj.modifiers if m.type == "NODES" and m.node_group]
        if not mods:
            continue
        for m in mods:
            collect_groups(m.node_group, groups)
        objects.append({
            "name": obj.name,
            "type": obj.type,
            "matrix_world": matrix_list(obj.matrix_world),
            "modifiers": [{
                "name": m.name,
                "type": m.type,
                "enabled": m.show_viewport,
                "nodeGroup": m.node_group.name if m.type == "NODES" and m.node_group else None,
                "inputs": modifier_inputs(m) if m.type == "NODES" and m.node_group else None,
            } for m in obj.modifiers],
            "input_geometry": input_geometry(obj, writer),
            "output_geometry": geometry_of(obj, writer),
        })
    for tree in bpy.data.node_groups:
        if tree.bl_idname == "GeometryNodeTree":
            collect_groups(tree, groups)

    refs = referenced_ids(groups, objects)
    referenced = {"objects": {}, "collections": {}, "images": {}}
    for name in sorted(refs["OBJECT"]):
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        referenced["objects"][name] = {
            "type": obj.type,
            "matrix_world": matrix_list(obj.matrix_world),
            "parent": obj.parent.name if obj.parent else None,
            "geometry": geometry_of(obj, writer) if obj.type in ("MESH", "CURVES", "POINTCLOUD", "CURVE", "EMPTY") else None,
        }
    for name in sorted(refs["COLLECTION"]):
        coll = bpy.data.collections.get(name)
        if coll is None:
            continue
        referenced["collections"][name] = {
            "objects": [o.name for o in coll.objects],
            "children": [c.name for c in coll.children],
            "instance_offset": list(coll.instance_offset),
        }
    for name in sorted(refs["IMAGE"]):
        img = bpy.data.images.get(name)
        if img is None:
            continue
        pixels = [0.0] * (img.size[0] * img.size[1] * img.channels)
        if pixels:
            img.pixels.foreach_get(pixels)
        referenced["images"][name] = {
            "filepath": img.filepath,
            "size": list(img.size),
            "channels": img.channels,
            "isFloat": img.is_float,
            "colorspace": img.colorspace_settings.name,
            "alphaMode": img.alpha_mode,
            "pixels": writer.put(pixels, "f4"),
        }

    result = {
        "format": "threepipe-procedural-dump/2",
        "blender": bpy.app.version_string,
        "hash": bpy.app.build_hash.decode(),
        "blend_file": bpy.data.filepath,
        "overrides": applied,
        "node_groups": groups,
        "objects": objects,
        "referenced": referenced,
    }
    writer.close()
    with open(os.path.join(out, "dump.json"), "w", encoding="utf8") as handle:
        json.dump(result, handle, indent=1, allow_nan=True)
    print(f"[procedural] {out}: {len(groups)} groups, {len(objects)} objects, "
          f"{len(referenced['objects'])} referenced objects, Blender {bpy.app.version_string}")
    for o in objects:
        for m in o["modifiers"]:
            if m["inputs"]:
                names = ", ".join(f"{v['name']}={v.get('value')!r}" for v in m["inputs"].values())
                print(f"  {o['name']}:{m['name']} inputs: {names}")


main()
