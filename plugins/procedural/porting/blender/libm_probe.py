"""Prints the platform libm's float results at boundary inputs (ctypes into the system libm). Run with plain python3
on the platform Blender runs on; src/blender/libm.ts models what it printed on the reference Mac (macOS 15.5 arm64)."""
import ctypes, ctypes.util, struct, platform
libm = ctypes.CDLL(ctypes.util.find_library("m"))
for name in ("acosf", "asinf", "atan2f", "cosf", "sinf"):
    f = getattr(libm, name)
    f.restype = ctypes.c_float
    f.argtypes = [ctypes.c_float] * (2 if name == "atan2f" else 1)
def bits(x): return "%08x" % struct.unpack("<I", struct.pack("<f", x))[0]
print("platform", platform.platform(), platform.machine())
for a in (-1.0, 1.0, -0.99999994, 0.0):
    r = libm.acosf(a); print("acosf", a, repr(r), bits(r))
for a in (-1.0, 1.0):
    r = libm.asinf(a); print("asinf", a, repr(r), bits(r))
for y, x in ((0.0, -1.0), (-0.0, -1.0), (0.0, -0.0), (-0.0, -0.0), (0.0, 0.0), (-0.0, 0.0), (1e-30, -1.0), (-1e-30, -1.0), (0.0, -8.742278e-08), (-0.0, -8.742278e-08)):
    r = libm.atan2f(y, x); print("atan2f", y, x, repr(r), bits(r))
for a in (1.5707963705062866, 1.5707962513, 3.1415927410125732, 3.1415925025939941):
    r1, r2 = libm.cosf(a), libm.sinf(a); print("cos/sin", a, repr(r1), bits(r1), repr(r2), bits(r2))
