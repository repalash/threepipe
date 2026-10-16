"""
run_cases.py - evaluate @threepipe/plugin-procedural parity cases in Blender 5.2.2.

Usage:
  blender --background --factory-startup \
    --python plugins/procedural/porting/blender/run_cases.py -- <cases.json> <out dir> [--only <case id>]...

<cases.json> is a list of cases written by the package's DSL (`tests/parity/cases/*.json`):
  {
    "id": "math-pingpong-neg", "description": "...",
    "library": {"<group name>": NodeTreeJSON, ...},   // node groups, our canonical format
    "group": "<group name>",                         // the one the modifier runs
    "inputs": {"<interface socket name>": value},    // modifier inputs (IDs by name)
    "input": "empty" | "cube" | "plane" | {"positions": [x,y,z,...], "faces": [[i,j,k,...], ...]},
    "scene": [{"collection": "C", "objects": [ObjectSpec]}], "objects": [ObjectSpec]
  }
  NodeTreeJSON = {
    "interface": [{"inOut": "INPUT"|"OUTPUT", "name", "socketType", "identifier", "default"?, "min_value"?,
                   "max_value"?, "subtype"?, "attribute_domain"?, ...}],
    "nodes": [{"name", "type", "properties"?: {}, "inputs"?: {identifier: value}, "items"?: {coll: [..]},
               "pairedOutput"?: name, "group"?: name, "mute"?: bool}],
    "links": [{"from": [node, socket identifier], "to": [node, socket identifier]}]
  }
  ObjectSpec = {"name", "mesh": "cube"|"plane"|"empty"|{"positions","faces"}, "location"?, "rotation"?, "scale"?}

Multi-input sockets (Join Geometry, ...): links to one multi-input socket are listed in evaluation order;
Blender evaluates the highest `multi_input_sort_id` first (`blenkernel/intern/node_runtime.cc:141-145`) and
gives a new link the highest id (`node.cc:4642`), so links are created here in reverse order.

Writes <out dir>/<case id>.json (+ .bin when large): {"blender", "case", "input": geometry, "geometry": geometry,
"multiInputOrder": {...}} or {"error": ...}. One failing case does not stop the batch.
"""

import json
import os
import sys
import traceback

import bpy

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from geometry_dump import BinWriter, input_group, read_geometry  # noqa: E402

# Properties that change which sockets exist must be set first.
PROPERTY_ORDER = ["data_type", "input_type", "capture_type", "domain", "mode", "noise_dimensions",
                  "voronoi_dimensions", "feature", "distance", "operation", "fill_type"]

ID_POOLS = {"OBJECT": "objects", "COLLECTION": "collections", "MATERIAL": "materials", "IMAGE": "images"}


def resolve(value):
    if isinstance(value, dict) and "_ref" in value:
        pool = getattr(bpy.data, ID_POOLS[value["_ref"]])
        found = pool.get(value["name"])
        if found is None:
            raise KeyError(f"case refers to {value['_ref'].lower()} '{value['name']}' that the case does not create")
        return found
    if isinstance(value, list):
        return tuple(value)
    return value


def make_mesh(name, spec):
    if spec in (None, "empty"):
        return bpy.data.meshes.new(name)
    if spec in ("cube", "plane"):
        if spec == "cube":
            bpy.ops.mesh.primitive_cube_add()
        else:
            bpy.ops.mesh.primitive_plane_add()
        tmp = bpy.context.active_object
        mesh = tmp.data
        mesh.name = name
        bpy.data.objects.remove(tmp)
        return mesh
    mesh = bpy.data.meshes.new(name)
    p = spec["positions"]
    verts = [tuple(p[i:i + 3]) for i in range(0, len(p), 3)]
    mesh.from_pydata(verts, spec.get("edges", []), spec.get("faces", []))
    mesh.update()
    return mesh


def make_object(spec):
    data = None if spec.get("mesh", "empty") == "empty" else make_mesh(spec["name"], spec["mesh"])
    obj = bpy.data.objects.new(spec["name"], data)
    obj.location = spec.get("location", (0, 0, 0))
    obj.rotation_euler = spec.get("rotation", (0, 0, 0))
    obj.scale = spec.get("scale", (1, 1, 1))
    return obj


def build_scene(case):
    for entry in case.get("scene", []):
        coll = bpy.data.collections.new(entry["collection"])
        bpy.context.scene.collection.children.link(coll)
        for spec in entry.get("objects", []):
            coll.objects.link(make_object(spec))
    for spec in case.get("objects", []):
        bpy.context.scene.collection.objects.link(make_object(spec))


def set_properties(node, props):
    keys = sorted(props.keys(), key=lambda k: PROPERTY_ORDER.index(k) if k in PROPERTY_ORDER else len(PROPERTY_ORDER))
    for key in keys:
        setattr(node, key, resolve(props[key]))


def add_items(node, items):
    for coll_name, entries in items.items():
        coll = getattr(node, coll_name)
        # Start from an empty list so the case fully decides the items.
        if hasattr(coll, "clear"):
            coll.clear()
        for entry in entries:
            kind = entry.get("socket_type") or entry.get("data_type")
            name = entry.get("name")
            if coll_name == "index_switch_items":
                item = coll.new()
            elif coll_name == "enum_items":
                item = coll.new(name)
            elif kind is not None:
                item = coll.new(kind, name or "")
            else:
                item = coll.new(name or "")
            for key, value in entry.items():
                if key in ("socket_type", "data_type", "name", "identifier"):
                    continue
                if hasattr(item, key):
                    setattr(item, key, resolve(value))


def find_socket(sockets, identifier, where):
    for s in sockets:
        if s.identifier == identifier:
            return s
    raise KeyError(f"{where}: no socket '{identifier}' among {[s.identifier for s in sockets]}")


def build_group(name, spec, groups):
    tree = groups[name]
    ident_map = {}
    for item in spec.get("interface", []):
        if item.get("itemType", "SOCKET") != "SOCKET":
            continue
        sock = tree.interface.new_socket(item["name"], in_out=item["inOut"], socket_type=item["socketType"])
        ident_map[item.get("identifier", item["name"])] = sock.identifier
        for key, value in item.items():
            if key in ("inOut", "name", "socketType", "identifier", "itemType", "panel"):
                continue
            if key == "default":
                key = "default_value"
            if hasattr(sock, key):
                setattr(sock, key, resolve(value))

    nodes = {}
    for nspec in spec["nodes"]:
        node = tree.nodes.new(nspec["type"])
        node.name = nspec["name"]
        if nspec.get("group"):
            node.node_tree = groups[nspec["group"]]
        set_properties(node, nspec.get("properties", {}))
        if nspec.get("items"):
            add_items(node, nspec["items"])
        nodes[nspec["name"]] = node
    for nspec in spec["nodes"]:
        if nspec.get("pairedOutput"):
            nodes[nspec["name"]].pair_with_output(nodes[nspec["pairedOutput"]])
    for nspec in spec["nodes"]:
        node = nodes[nspec["name"]]
        for ident, value in nspec.get("inputs", {}).items():
            sock = find_socket(node.inputs, ident_map.get(ident, ident) if node.bl_idname == "NodeGroupOutput" else ident,
                               f"{nspec['name']} inputs")
            sock.default_value = resolve(value)
        node.mute = bool(nspec.get("mute", False))

    def remap(node, ident):
        if node.bl_idname in ("NodeGroupInput", "NodeGroupOutput"):
            return ident_map.get(ident, ident)
        return ident

    # Reverse order: the last link created gets the highest multi-input sort id and is evaluated first.
    for link in reversed(spec["links"]):
        a, b = nodes[link["from"][0]], nodes[link["to"][0]]
        out_sock = find_socket(a.outputs, remap(a, link["from"][1]), f"{a.name} outputs")
        in_sock = find_socket(b.inputs, remap(b, link["to"][1]), f"{b.name} inputs")
        made = tree.links.new(out_sock, in_sock)
        if link.get("muted"):
            made.is_muted = True
    return tree, ident_map


def multi_input_order(tree):
    order = {}
    for node in tree.nodes:
        for sock in node.inputs:
            if getattr(sock, "is_multi_input", False) and sock.is_linked:
                links = sorted(sock.links, key=lambda l: -l.multi_input_sort_id)
                order[f"{node.name}:{sock.identifier}"] = [[l.from_node.name, l.from_socket.identifier] for l in links]
    return order


def case_tree(case):
    """Single-tree shorthand {"tree": {nodes, links, output: [node, socket]}} becomes a library."""
    if "library" in case:
        return case["library"], case["group"]
    tree = dict(case["tree"])
    nodes = list(tree["nodes"]) + [{"name": "__out", "type": "NodeGroupOutput"}]
    links = list(tree["links"]) + [{"from": tree["output"], "to": ["__out", "Geometry"]}]
    return {case["id"]: {
        "interface": [{"inOut": "OUTPUT", "name": "Geometry", "socketType": "NodeSocketGeometry", "identifier": "Geometry"}],
        "nodes": nodes, "links": links}}, case["id"]


def evaluate(case, writer):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_scene(case)
    library, main = case_tree(case)
    groups = {name: bpy.data.node_groups.new(name, "GeometryNodeTree") for name in library}
    built = {name: build_group(name, spec, groups) for name, spec in library.items()}
    obj = bpy.data.objects.new(case["id"], make_mesh(case["id"], case.get("input", "empty")))
    bpy.context.scene.collection.objects.link(obj)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    input_geometry = read_geometry(obj.evaluated_get(depsgraph).evaluated_geometry(), writer)

    mod = obj.modifiers.new("case", "NODES")
    mod.node_group = groups[main]
    ident_map = built[main][1]
    for item in groups[main].interface.items_tree:
        if item.item_type == "SOCKET" and item.in_out == "INPUT" and item.name in case.get("inputs", {}):
            group = input_group(mod, item.identifier)
            if group is None:
                raise KeyError(f"modifier input '{item.name}' has no value to set")
            group.value = resolve(case["inputs"][item.name])
    obj.update_tag()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    geometry = read_geometry(obj.evaluated_get(depsgraph).evaluated_geometry(), writer)
    return {
        "input": input_geometry,
        "geometry": geometry,
        "interfaceIdentifiers": ident_map,
        "multiInputOrder": {name: multi_input_order(groups[name]) for name in library},
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    cases_file, out_dir = argv[0], argv[1]
    only = [argv[i + 1] for i, a in enumerate(argv) if a == "--only"]
    with open(cases_file, encoding="utf8") as handle:
        cases = json.load(handle)
    os.makedirs(out_dir, exist_ok=True)
    failures = 0
    for case in cases:
        if only and case["id"] not in only:
            continue
        writer = BinWriter(os.path.join(out_dir, case["id"] + ".bin"))
        try:
            result = evaluate(case, writer)
        except Exception as error:  # noqa: BLE001 - report and continue the batch
            failures += 1
            result = {"error": f"{type(error).__name__}: {error}", "trace": traceback.format_exc()}
            print(f"[procedural] FAILED {case['id']}: {result['error']}")
        writer.close()
        with open(os.path.join(out_dir, case["id"] + ".json"), "w", encoding="utf8") as handle:
            json.dump({"blender": bpy.app.version_string, "hash": bpy.app.build_hash.decode(), "case": case, **result},
                      handle, indent=1, allow_nan=True)
    print(f"[procedural] {len(cases) - failures} captured, {failures} failed, Blender {bpy.app.version_string}")


main()
