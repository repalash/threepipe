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
    "scene": [{"collection": "C", "objects": [ObjectSpec], "instanceOffset"?: [x,y,z], "parent"?: "B"}],
    "objects": [ObjectSpec], "location"?, "rotation"?, "scale"? (the modified object's transform),
    "materials"?: ["<name>", ...]                    // materials created before the node groups ({"_ref": "MATERIAL"})
    "images"?: [{"name", "width", "height", "pixels": [r,g,b,a,...], "alphaMode"?, "isData"?}]  // float images ({"_ref": "IMAGE"})
  }
  NodeTreeJSON = {
    "interface": [{"inOut": "INPUT"|"OUTPUT", "name", "socketType", "identifier", "default"?, "min_value"?,
                   "max_value"?, "subtype"?, "attribute_domain"?, ...}],
    "nodes": [{"name", "type", "properties"?: {}, "inputs"?: {identifier: value}, "items"?: {coll: [..]},
               "pairedOutput"?: name, "group"?: name, "mute"?: bool,
               "colorRamp"?: {"interpolation", "colorMode", "hueInterpolation", "elements": [{"position", "color"}]},
               "curveMapping"?: {"clipMinX", "clipMinY", "clipMaxX", "clipMaxY", "useClip", "extend",
                                 "curves": [{"points": [{"location": [x, y], "handleType"}]}]}}],
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

from geometry_dump import BinWriter, input_group, matrix_list, read_geometry  # noqa: E402

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
    created = {}
    for entry in case.get("scene", []):
        coll = bpy.data.collections.new(entry["collection"])
        coll.instance_offset = entry.get("instanceOffset", (0, 0, 0))
        created[entry["collection"]] = coll
        for spec in entry.get("objects", []):
            coll.objects.link(make_object(spec))
    # `parent` nests a collection in another one of the case's; the rest go under the scene collection.
    for entry in case.get("scene", []):
        parent = created[entry["parent"]] if entry.get("parent") else bpy.context.scene.collection
        parent.children.link(created[entry["collection"]])
    for spec in case.get("objects", []):
        bpy.context.scene.collection.objects.link(make_object(spec))


def set_properties(node, props):
    keys = sorted(props.keys(), key=lambda k: PROPERTY_ORDER.index(k) if k in PROPERTY_ORDER else len(PROPERTY_ORDER))
    for key in keys:
        setattr(node, key, resolve(props[key]))


def keep_switch_items(node, coll_name, entries):
    """Index Switch / Menu Switch / Repeat items: their socket identifiers are `Item_<identifier>` with identifiers
    handed out by a per-node counter that `clear()` does not reset, so the node's initial items (identifiers 0, 1;
    the Repeat Output's one Geometry item, 0) are kept and renamed / retyped, and the rest appended (.., n-1).
    Cases list items with identifiers 0..n-1 in order."""
    coll = getattr(node, coll_name)
    while len(coll) > max(len(entries), 1):
        coll.remove(coll[len(coll) - 1])
    for i, entry in enumerate(entries):
        if i < len(coll):
            item = coll[i]
            if coll_name in ("enum_items", "repeat_items") and entry.get("name") is not None:
                item.name = entry["name"]
        elif coll_name == "index_switch_items":
            item = coll.new()
        elif coll_name == "repeat_items":
            item = coll.new(entry["socket_type"], entry.get("name") or "")
        else:
            item = coll.new(entry.get("name") or "")
        if "identifier" in entry and getattr(item, "identifier", entry["identifier"]) != entry["identifier"]:
            raise ValueError(f"{node.name}: {coll_name}[{i}] has identifier {item.identifier}, the case expects {entry['identifier']}")
        for key, value in entry.items():
            if key in ("name", "identifier"):
                continue
            if hasattr(item, key):
                setattr(item, key, resolve(value))


def add_items(node, items):
    for coll_name, entries in items.items():
        if coll_name in ("index_switch_items", "enum_items", "repeat_items"):
            keep_switch_items(node, coll_name, entries)
            continue
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


def set_color_ramp(node, spec):
    """`colorRamp` (the shape dump_blend.py writes). Setting an element's position does not re-sort the elements
    (rna_ColorRamp_update only tags), so after making the count match, every element is assigned in the case's
    order - the stored order Blender evaluates in."""
    ramp = node.color_ramp
    if "colorMode" in spec:
        ramp.color_mode = spec["colorMode"]
    if "interpolation" in spec:
        ramp.interpolation = spec["interpolation"]
    if "hueInterpolation" in spec:
        ramp.hue_interpolation = spec["hueInterpolation"]
    elements = spec.get("elements")
    if elements is None:
        return
    while len(ramp.elements) < len(elements):
        ramp.elements.new(0.5)
    while len(ramp.elements) > len(elements):
        ramp.elements.remove(ramp.elements[len(ramp.elements) - 1])
    for element, e in zip(ramp.elements, elements):
        element.position = e["position"]
        element.color = tuple(e["color"])


def set_curve_mapping(node, spec):
    """`curveMapping` (the shape dump_blend.py writes). Points are set in the case's order and deselected (new
    points are selected, and BKE_curvemapping_changed clamps selected points to the clip rectangle), then
    `update()` (BKE_curvemapping_changed_all) rebuilds the tables, as loading a file does."""
    mapping = node.mapping
    for k, curve_spec in enumerate(spec.get("curves", [])):
        curve = mapping.curves[k]
        points = curve_spec["points"]
        while len(curve.points) < len(points):
            curve.points.new(0.5, 0.5)
        while len(curve.points) > len(points):
            curve.points.remove(curve.points[1])
        for point, p in zip(curve.points, points):
            point.location = tuple(p["location"])
            point.handle_type = p.get("handleType", "AUTO")
            point.select = False
    # Widen the clip rectangle first: each bound's range is limited by the other (rna_color.cc:192-226).
    mapping.clip_min_x, mapping.clip_max_x, mapping.clip_min_y, mapping.clip_max_y = -100.0, 100.0, -100.0, 100.0
    for key, attr in (("clipMinX", "clip_min_x"), ("clipMaxX", "clip_max_x"), ("clipMinY", "clip_min_y"), ("clipMaxY", "clip_max_y")):
        setattr(mapping, attr, spec.get(key, {"clipMinX": 0.0, "clipMaxX": 1.0, "clipMinY": 0.0, "clipMaxY": 1.0}[key]))
    if "useClip" in spec:
        mapping.use_clip = spec["useClip"]
    if "extend" in spec:
        mapping.extend = spec["extend"]
    mapping.update()


def find_socket(sockets, identifier, where):
    for s in sockets:
        if s.identifier == identifier:
            return s
    raise KeyError(f"{where}: no socket '{identifier}' among {[s.identifier for s in sockets]}")


def build_interface(name, spec, groups):
    """The group's interface sockets; returns our identifier -> Blender's. Every group's interface is built before
    any group's nodes, so group nodes see their sockets whatever the library order."""
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
    return ident_map


def build_group(name, spec, groups, ident_maps):
    tree = groups[name]
    ident_map = ident_maps[name]
    nodes = {}
    for nspec in spec["nodes"]:
        node = tree.nodes.new(nspec["type"])
        node.name = nspec["name"]
        if nspec.get("group"):
            node.node_tree = groups[nspec["group"]]
        set_properties(node, nspec.get("properties", {}))
        if nspec.get("items"):
            add_items(node, nspec["items"])
        if nspec.get("colorRamp"):
            set_color_ramp(node, nspec["colorRamp"])
        if nspec.get("curveMapping"):
            set_curve_mapping(node, nspec["curveMapping"])
        nodes[nspec["name"]] = node

    def remap(node, ident):
        if node.bl_idname in ("NodeGroupInput", "NodeGroupOutput"):
            return ident_map.get(ident, ident)
        if node.bl_idname == "GeometryNodeGroup" and node.node_tree is not None:
            return ident_maps[node.node_tree.name].get(ident, ident)
        return ident

    for nspec in spec["nodes"]:
        if nspec.get("pairedOutput"):
            nodes[nspec["name"]].pair_with_output(nodes[nspec["pairedOutput"]])
    for nspec in spec["nodes"]:
        node = nodes[nspec["name"]]
        for ident, value in nspec.get("inputs", {}).items():
            sock = find_socket(node.inputs, remap(node, ident), f"{nspec['name']} inputs")
            sock.default_value = resolve(value)
        node.mute = bool(nspec.get("mute", False))

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


def read_scene(depsgraph, writer, self_name):
    """The scene the case built, as dump_blend.py's `referenced` block: objects (world matrix and evaluated
    geometry; the modified object itself with its matrix only), collections. Object Info / Collection Info
    cases evaluate against it."""
    objects = {}
    for o in bpy.data.objects:
        entry = {"type": o.type, "matrix_world": matrix_list(o.matrix_world),
                 "parent": o.parent.name if o.parent else None, "geometry": None,
                 "instance_collection": o.instance_collection.name if o.type == "EMPTY" and o.instance_collection else None}
        if o.name != self_name and o.type in ("MESH", "CURVES", "POINTCLOUD", "CURVE"):
            evaluated = o.evaluated_get(depsgraph)
            if evaluated.is_evaluated:
                entry["geometry"] = read_geometry(evaluated.evaluated_geometry(), writer)
        objects[o.name] = entry
    collections = {c.name: {"objects": [o.name for o in c.objects], "children": [ch.name for ch in c.children],
                            "instance_offset": list(c.instance_offset)} for c in bpy.data.collections}
    return {"objects": objects, "collections": collections, "images": {}}


def evaluate(case, writer):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name in case.get("materials", []):
        bpy.data.materials.new(name)
    for spec in case.get("images", []):
        # A float buffer holding exactly `pixels` (`rna_Image_pixels_set` copies into `ImBuf::float_buffer`).
        img = bpy.data.images.new(spec["name"], spec["width"], spec["height"], alpha=True, float_buffer=True)
        # Alpha mode and colour space first: their RNA updates signal the image (IMA_SIGNAL_COLORMANAGE), which
        # frees and regenerates a generated image's buffer.
        img.alpha_mode = spec.get("alphaMode", "STRAIGHT")
        if spec.get("isData"):
            img.colorspace_settings.is_data = True
        img.pixels.foreach_set(spec["pixels"])
    build_scene(case)
    library, main = case_tree(case)
    groups = {name: bpy.data.node_groups.new(name, "GeometryNodeTree") for name in library}
    ident_maps = {name: build_interface(name, spec, groups) for name, spec in library.items()}
    built = {name: build_group(name, spec, groups, ident_maps) for name, spec in library.items()}
    obj = bpy.data.objects.new(case["id"], make_mesh(case["id"], case.get("input", "empty")))
    obj.location = case.get("location", (0, 0, 0))
    obj.rotation_euler = case.get("rotation", (0, 0, 0))
    obj.scale = case.get("scale", (1, 1, 1))
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
        "scene": read_scene(depsgraph, writer, case["id"]),
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
