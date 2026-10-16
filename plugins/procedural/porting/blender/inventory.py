"""
inventory.py - every node type a Geometry Nodes tree accepts in this Blender, with sockets, defaults,
enum properties, and the socket layout for each value of each enum property (dynamic declarations).

Usage:
  blender --background --factory-startup \
    --python plugins/procedural/porting/blender/inventory.py -- tmp/gt-5.2.2/inventory.json

Used to cross-check the declarations ported into `plugins/procedural/src/nodes/` against Blender itself.
"""

import json
import sys

import bpy


def default_of(socket):
    if not hasattr(socket, "default_value"):
        return None
    value = socket.default_value
    if isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bpy.types.ID):
        return {"_ref": type(value).__name__.upper(), "name": value.name}
    try:
        return list(value)
    except TypeError:
        return None


def sockets(collection):
    out = []
    for s in collection:
        entry = {"identifier": s.identifier, "name": s.name, "type": s.bl_idname, "enabled": s.enabled}
        d = default_of(s)
        if d is not None:
            entry["default"] = d
        if getattr(s, "is_multi_input", False):
            entry["multiInput"] = True
        if getattr(s, "hide_value", False):
            entry["hideValue"] = True
        prop = s.bl_rna.properties.get("default_value")
        if prop is not None and prop.type in ("FLOAT", "INT"):
            entry["min"] = prop.hard_min
            entry["max"] = prop.hard_max
            entry["subtype"] = prop.subtype
        out.append(entry)
    return out


def layout(node):
    return {
        "inputs": [[s.identifier, s.bl_idname] for s in node.inputs if s.enabled],
        "outputs": [[s.identifier, s.bl_idname] for s in node.outputs if s.enabled],
    }


BASE = None


def properties(node):
    global BASE
    if BASE is None:
        BASE = {p.identifier for p in bpy.types.Node.bl_rna.properties} | {"rna_type"}
    out = []
    for prop in node.bl_rna.properties:
        if prop.identifier in BASE:
            continue
        entry = {"identifier": prop.identifier, "type": prop.type}
        if prop.type == "ENUM":
            entry["items"] = [i.identifier for i in prop.enum_items]
            value = getattr(node, prop.identifier)
            entry["default"] = sorted(value) if isinstance(value, set) else value
            if not entry["items"]:
                # Dynamic enum with no items in a fresh node (menu switch items, ...): nothing to sweep.
                entry["dynamicEmpty"] = True
            elif not prop.is_readonly and not getattr(prop, "is_enum_flag", False):
                layouts = {}
                for item in entry["items"]:
                    try:
                        setattr(node, prop.identifier, item)
                    except Exception:  # noqa: BLE001 - some items are not allowed in this tree type
                        continue
                    layouts[item] = layout(node)
                try:
                    setattr(node, prop.identifier, value)
                except Exception:  # noqa: BLE001 - restore may fail for context-dependent enums
                    entry["restoreFailed"] = True
                entry["layouts"] = layouts
        elif prop.type in ("BOOLEAN", "INT", "FLOAT", "STRING") and getattr(prop, "array_length", 0) == 0:
            entry["default"] = getattr(node, prop.identifier)
        out.append(entry)
    return out


def main():
    output = sys.argv[sys.argv.index("--") + 1]
    tree = bpy.data.node_groups.new("inventory", "GeometryNodeTree")
    nodes = []
    for name in dir(bpy.types):
        cls = getattr(bpy.types, name)
        if not (isinstance(cls, type) and issubclass(cls, bpy.types.Node) and cls is not bpy.types.Node):
            continue
        try:
            node = tree.nodes.new(name)
        except RuntimeError:
            continue
        nodes.append({
            "idname": name,
            "label": node.bl_label,
            "inputs": sockets(node.inputs),
            "outputs": sockets(node.outputs),
            "properties": properties(node),
        })
        tree.nodes.remove(node)
    nodes.sort(key=lambda e: e["idname"])
    with open(output, "w", encoding="utf8") as handle:
        json.dump({"blender": bpy.app.version_string, "hash": bpy.app.build_hash.decode(), "nodes": nodes}, handle, indent=1)
    print(f"[procedural] {len(nodes)} node types, Blender {bpy.app.version_string}")


main()
