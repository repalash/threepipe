# assimpjs-plugin example: Missing OBJ textures (404)

**Created:** 2026-03-27
**Status:** Open
**Severity:** Low — model renders without textures, not a crash

## Problem

The `assimpjs-plugin` example loads `male02.obj` + `male02.mtl` from `threejs.org/examples/models/obj/male02/`. The MTL file references 3 texture files that return 404:

- `01_-_Default1noCulling.JPG`
- `male-02-1noCulling.JPG`
- `orig_02_-_Defaul1noCulling.JPG`

These textures don't exist at the threejs.org URL. The model renders but without textures.

## Fix Options

1. Host the model with textures on `samples.threepipe.org`
2. Use a different model that has all assets available
3. Accept as-is (model renders, just untextured)
