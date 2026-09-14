# blend-importer js-blend parser.js: `_length` struct-array stride omits pointer-to-array (`Type **field`) members

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
In `getSDNAStructureConstructor`, the `PointerToArray` branch (the `Type **field`
double-pointer DNA members, e.g. `Material **mat`) advances the local field
`offset` but never increments `blen_struct.prototype._length`. Every other field
path increments `_length`. Since `_length` is the per-element stride used to walk
multi-element struct-array blocks, a struct containing a `**` member gets a stride
that is `pointer_size` (8 bytes) too small per such member, so every array element
after the first is read at a progressively wrong offset and decodes garbage.

## Root Cause
```js
// parser.js:536-538 — PointerToArray branch advances local offset but not _length
if (PointerToArray) {
    Object.defineProperty(blen_struct.prototype, _name, pointerProp2(offset));
    offset += pointer_size;          // local offset advances...
}                                    // ...but blen_struct.prototype._length is NOT incremented
```
Every OTHER branch routes through `compileProp`, which increments `obj._length`:
```js
// parser.js:446 — inline fields
obj._length += length;
// parser.js:450 — plain pointers
obj._length += pointer_size * array_size;
```
(`Suparray_match > 1` reaches `compileProp` via `:547`, the plain `else` via `:564`.)

`_length` is read as the per-element stride for multi-element blocks:
```js
// parser.js:1012
const length = constructor.prototype._length;
// parser.js:1026 — element u's data window
obj.setData(address, data_start + length * u, data_start + (length * u) + length, FILE);
```
With `length` short by `pointer_size`, elements `2..n` are read at too-small
offsets → all of their fields decode garbage. This is the only case where `_length`
diverges from the true SDNA struct size (DNA structs are otherwise packed with no
implicit padding, so the field-length sum equals TLEN).

## Impact
Latent today: most `**`-bearing structs (Mesh, Material) appear as singleton
`nr == 1` blocks (`:1030`), where the stride is unused and the field's own offset
(correct via the local `offset`) still resolves. But any struct with a `**` member
that Blender writes as an `nr > 1` array block silently corrupts elements 2..n.

## Fix
Add the missing increment inside the `PointerToArray` branch, mirroring the
plain-pointer increment at `:450`:
```js
if (PointerToArray) {
    Object.defineProperty(blen_struct.prototype, _name, pointerProp2(offset));
    blen_struct.prototype._length += pointer_size;
    offset += pointer_size;
}
```
Better still, stride struct arrays by the SDNA-declared TLEN rather than the
recomputed `_length`.

## Files
- `plugins/blend-importer/src/js-blend/parser/parser.js:536-538` — PointerToArray branch (defect)
- `plugins/blend-importer/src/js-blend/parser/parser.js:446,450` — compileProp increments `_length` for every other field (reference)
- `plugins/blend-importer/src/js-blend/parser/parser.js:1012,1026` — `_length` read as per-element stride (impact)
