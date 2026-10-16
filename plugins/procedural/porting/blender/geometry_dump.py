"""
Shared helpers for the Blender-side ground-truth scripts of @threepipe/plugin-procedural.

Reads a `bpy.types.GeometrySet` (Blender >= 4.4, `python/intern/bpy_geometry_set.cc`) into plain JSON with
every component, every attribute on every domain, instance transforms and instance references. Arrays
longer than `BIN_THRESHOLD` values are written to a sidecar `.bin` (little-endian) and referenced as
`{"bin": file, "dtype": "f4"|"i4", "offset": bytes, "count": values}`, so large scatters stay small and exact.

Target: Blender 5.2.2 LTS. Not a module Blender ships; imported by dump_blend.py / run_cases.py through
`sys.path`.
"""

import array
import os

import bpy

BIN_THRESHOLD = 4096

# data_type -> (foreach_get key, components, dtype)
VALUE_KEY = {
    "FLOAT": ("value", 1, "f4"),
    "INT": ("value", 1, "i4"),
    "INT8": ("value", 1, "i4"),
    "BOOLEAN": ("value", 1, "i4"),
    "FLOAT2": ("vector", 2, "f4"),
    "INT16_2D": ("value", 2, "i4"),
    "INT32_2D": ("value", 2, "i4"),
    "FLOAT_VECTOR": ("vector", 3, "f4"),
    "FLOAT_COLOR": ("color", 4, "f4"),
    "BYTE_COLOR": ("color_srgb", 4, "f4"),
    "QUATERNION": ("value", 4, "f4"),
    "FLOAT4X4": ("value", 16, "f4"),
}


class BinWriter:
    """Collects large arrays into one sidecar file per output JSON."""

    def __init__(self, path):
        self.path = path
        self.name = os.path.basename(path)
        self.handle = None
        self.offset = 0

    def put(self, values, dtype):
        if len(values) <= BIN_THRESHOLD:
            return list(values)
        if self.handle is None:
            self.handle = open(self.path, "wb")
        typecode = "f" if dtype == "f4" else "i"
        data = array.array(typecode, values)
        if data.itemsize != 4:
            raise RuntimeError("expected 4-byte array items")
        import sys
        if sys.byteorder != "little":
            data.byteswap()
        start = self.offset
        data.tofile(self.handle)
        self.offset += len(values) * 4
        return {"bin": self.name, "dtype": dtype, "offset": start, "count": len(values)}

    def close(self):
        if self.handle is not None:
            self.handle.close()


def _flat(values):
    out = []
    for v in values:
        if isinstance(v, (list, tuple)):
            out.extend(_flat(v))
        else:
            out.append(v)
    return out


def read_attribute(attribute, writer):
    entry = {"name": attribute.name, "domain": attribute.domain, "type": attribute.data_type}
    if attribute.data_type == "STRING":
        entry["values"] = [item.value for item in attribute.data]
        return entry
    spec = VALUE_KEY.get(attribute.data_type)
    if spec is None:
        entry["values"] = None
        entry["unsupported"] = True
        return entry
    key, width, dtype = spec
    count = len(attribute.data)
    values = [0] * (count * width) if dtype == "i4" else [0.0] * (count * width)
    if count:
        attribute.data.foreach_get(key, values)
    if dtype == "i4":
        values = [int(v) for v in values]
    entry["values"] = writer.put(values, dtype)
    return entry


def read_attributes(owner, writer, skip=()):
    return [read_attribute(a, writer) for a in owner.attributes if a.name not in skip]


def read_mesh(mesh, writer):
    edges = [0] * (len(mesh.edges) * 2)
    if edges:
        mesh.edges.foreach_get("vertices", edges)
    starts = [0] * len(mesh.polygons)
    if starts:
        mesh.polygons.foreach_get("loop_start", starts)
    corners = [0] * len(mesh.loops)
    if corners:
        mesh.loops.foreach_get("vertex_index", corners)
    return {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "faces": len(mesh.polygons),
        "corners": len(mesh.loops),
        "faceOffsets": writer.put(starts + [len(mesh.loops)], "i4"),
        "materials": [m.name if m else None for m in mesh.materials],
        "attributes": read_attributes(mesh, writer),
    }


def read_pointcloud(pointcloud, writer):
    return {
        "points": len(pointcloud.points),
        "materials": [m.name if m else None for m in pointcloud.materials],
        "attributes": read_attributes(pointcloud, writer),
    }


def read_curves(curves, writer):
    offsets = [0] * (len(curves.curves) + 1)
    if len(curves.curves):
        curves.curve_offset_data.foreach_get("value", offsets)
    else:
        offsets = [0]
    return {
        "curves": len(curves.curves),
        "points": len(curves.points),
        "curveOffsets": writer.put(offsets, "i4"),
        "materials": [m.name if m else None for m in curves.materials],
        "attributes": read_attributes(curves, writer),
    }


def read_reference(reference, writer, depth):
    if reference is None:
        return {"kind": "none"}
    if isinstance(reference, bpy.types.Object):
        return {"kind": "object", "name": reference.name}
    if isinstance(reference, bpy.types.Collection):
        return {"kind": "collection", "name": reference.name}
    return {"kind": "geometry", "geometry": read_geometry(reference, writer, depth + 1)}


def read_geometry(geometry, writer, depth=0):
    """`geometry` is a bpy.types.GeometrySet."""
    result = {"name": getattr(geometry, "name", "")}
    if geometry.mesh is not None:
        result["mesh"] = read_mesh(geometry.mesh, writer)
    if geometry.pointcloud is not None:
        result["pointcloud"] = read_pointcloud(geometry.pointcloud, writer)
    if geometry.curves is not None:
        result["curves"] = read_curves(geometry.curves, writer)
    if geometry.volume is not None:
        result["volume"] = {"present": True}
    if geometry.grease_pencil is not None:
        result["greasePencil"] = {"present": True}
    instances = geometry.instances_pointcloud()
    if instances is not None:
        result["instances"] = {
            "count": len(instances.points),
            # `position` is derived from instance_transform when the instances become a point cloud.
            "attributes": read_attributes(instances, writer, skip=("position",)),
            "references": [read_reference(r, writer, depth) for r in geometry.instance_references()],
        }
    return result


def matrix_list(matrix):
    """Column-major 16 floats (the order three.js and our float4x4 attributes use)."""
    return [matrix[row][col] for col in range(4) for row in range(4)]


def serialize_value(value):
    if value is None:
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bpy.types.ID):
        kind = type(value).__name__.upper()
        return {"_ref": kind, "name": value.name}
    if hasattr(value, "to_list"):
        return value.to_list()
    try:
        return [serialize_value(v) for v in value]
    except TypeError:
        return str(value)


def input_group(mod, identifier):
    """The generated property group of one modifier input (5.x: `mod.properties.inputs.<identifier>`,
    `nodes/intern/geometry_nodes_srna.cc:110`), or None (geometry sockets have none)."""
    props = getattr(mod, "properties", None)
    inputs = getattr(props, "inputs", None) if props is not None else None
    if inputs is None:
        return None
    return getattr(inputs, identifier, None)
