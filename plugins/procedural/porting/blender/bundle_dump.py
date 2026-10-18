"""
bundle_dump.py - make a runtime bundle from a dump_blend.py dump, for the browser examples.

Usage (plain Python 3, no Blender):
  python3 -I plugins/procedural/porting/blender/bundle_dump.py <dump dir> <bundle dir>

A bundle is the dump without what Blender evaluated (`objects[].output_geometry`): node groups, modifier
inputs, the input geometry and the referenced objects / collections / images / material colours - exactly
what an evaluation needs, so an example evaluates the graph itself and never reads a baked result.
`bundle.json` keeps the dump's shape (format `threepipe-procedural-bundle/1`) and every binary array is re-packed
into `bundle.bin`.

Images: a float buffer whose every value is `float(k) * (1.0f / 255.0f)` for a byte k (what Blender makes from an
8-bit file in a linear colour space, `rgba_uchar_to_float`) is stored as bytes with `"encoding": "unorm8"`; the
reader multiplies back in float32, giving the same bits. This is checked per image; other images stay float32.
"""

import array
import json
import os
import struct
import sys

UNORM8_SCALE = struct.unpack("<f", struct.pack("<f", 1.0 / 255.0))[0]


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def is_ref(v):
    return isinstance(v, dict) and "bin" in v and "dtype" in v and "offset" in v and "count" in v


class Packer:
    def __init__(self, source):
        self.source = source
        self.out = bytearray()

    def put_bytes(self, data, dtype, count, extra=None):
        while len(self.out) % 4:
            self.out.append(0)
        ref = {"bin": "bundle.bin", "dtype": dtype, "offset": len(self.out), "count": count}
        if extra:
            ref.update(extra)
        self.out += data
        return ref

    def copy(self, ref):
        size = {"f4": 4, "i4": 4, "u1": 1}[ref["dtype"]]
        data = self.source[ref["offset"]:ref["offset"] + ref["count"] * size]
        return self.put_bytes(data, ref["dtype"], ref["count"])

    def walk(self, v):
        if is_ref(v):
            return self.copy(v)
        if isinstance(v, dict):
            return {k: self.walk(x) for k, x in v.items()}
        if isinstance(v, list):
            return [self.walk(x) for x in v]
        return v

    def image(self, ref):
        floats = array.array("f")
        floats.frombytes(self.source[ref["offset"]:ref["offset"] + ref["count"] * 4])
        if sys.byteorder != "little":
            floats.byteswap()
        out = bytearray(len(floats))
        for i, x in enumerate(floats):
            k = round(x * 255.0)
            # float32 product of two float32 values (exact in double, then rounded once).
            if k < 0 or k > 255 or f32(float(k) * UNORM8_SCALE) != x:
                return self.copy(ref), False
            out[i] = k
        return self.put_bytes(bytes(out), "u1", len(out), {"encoding": "unorm8"}), True


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    with open(os.path.join(src, "dump.json"), encoding="utf8") as handle:
        dump = json.load(handle)
    with open(os.path.join(src, "dump.bin"), "rb") as handle:
        packer = Packer(handle.read())

    images = dump["referenced"].get("images", {})
    packed_images = {}
    for name, img in images.items():
        entry = {k: v for k, v in img.items() if k != "pixels"}
        entry["pixels"], unorm8 = packer.image(img["pixels"])
        packed_images[name] = entry
        print(f"  image {name}: {'unorm8' if unorm8 else 'float32'}")
    referenced = {k: packer.walk(v) for k, v in dump["referenced"].items() if k != "images"}
    referenced["images"] = packed_images
    objects = [{k: packer.walk(v) for k, v in o.items() if k != "output_geometry"} for o in dump["objects"]]

    bundle = {
        "format": "threepipe-procedural-bundle/1",
        "blender": dump["blender"],
        "hash": dump["hash"],
        "blend_file": os.path.basename(dump.get("blend_file", "")),
        "scene_time": dump.get("scene_time"),
        "node_groups": dump["node_groups"],
        "objects": objects,
        "referenced": referenced,
        "unevaluated_objects": dump.get("unevaluated_objects", []),
    }
    os.makedirs(dst, exist_ok=True)
    with open(os.path.join(dst, "bundle.json"), "w", encoding="utf8") as handle:
        json.dump(bundle, handle, separators=(",", ":"), allow_nan=True)
    with open(os.path.join(dst, "bundle.bin"), "wb") as handle:
        handle.write(packer.out)
    print(f"[procedural] {dst}: bundle.json {os.path.getsize(os.path.join(dst, 'bundle.json')) / 1e6:.2f} MB, "
          f"bundle.bin {len(packer.out) / 1e6:.2f} MB")


main()
