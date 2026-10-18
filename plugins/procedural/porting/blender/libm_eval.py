"""
libm_eval.py - the reference platform's results for the float trig arguments a parity case recorded
(`tests/parity/libmProof.test.ts`).

Usage: "$BLENDER" --background --factory-startup --python libm_eval.py -- <inputs.json> <apple.json>
(any Python on the reference machine works; Blender's is the one the worker has). Calls libSystem through ctypes:
acosf, asinf, atan2f and __sincosf_stret (clang's combination of sinf/cosf of one value on Darwin).
Output: {name: {argument key: [result, ...]}}, keys as recorded (`String(x)` / `"y,x"`).
"""
import ctypes
import ctypes.util
import json
import sys

args = sys.argv[sys.argv.index("--") + 1:]
libm = ctypes.CDLL(ctypes.util.find_library("m"))
for name in ("acosf", "asinf"):
    getattr(libm, name).restype = ctypes.c_float
    getattr(libm, name).argtypes = [ctypes.c_float]
libm.atan2f.restype = ctypes.c_float
libm.atan2f.argtypes = [ctypes.c_float, ctypes.c_float]


class SinCos(ctypes.Structure):
    _fields_ = [("s", ctypes.c_float), ("c", ctypes.c_float)]


sincos = libm.__sincosf_stret
sincos.restype = SinCos
sincos.argtypes = [ctypes.c_float]

with open(args[0], encoding="utf8") as handle:
    inputs = json.load(handle)
out = {
    "acosf": {k: [libm.acosf(float(k))] for k in inputs.get("acosf", [])},
    "asinf": {k: [libm.asinf(float(k))] for k in inputs.get("asinf", [])},
    "atan2f": {k: [libm.atan2f(*map(float, k.split(",")))] for k in inputs.get("atan2f", [])},
    "sincosf": {k: [sincos(float(k)).s, sincos(float(k)).c] for k in inputs.get("sincosf", [])},
}
with open(args[1], "w", encoding="utf8") as handle:
    json.dump(out, handle)
print("libm_eval", {k: len(v) for k, v in out.items()})
