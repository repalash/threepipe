# HierarchyUiPlugin: parent checkbox shows fully-checked when a descendant is hidden (tri-state bug); label-click checks wrong object's visibility

**Severity:** medium
**Found:** 2026-06-13 code audit

Two defects in the hierarchy tree UI. The tri-state rollup bug is medium; the label-click visibility check is a low-severity sibling bundled here.

## Bug 1 (medium) — tri-state rollup loses "indeterminate" for ancestors of a hidden grandchild
`refreshVisible` recomputes the tri-state checkbox status (0=unchecked, 1=half, 2=full). For a node with children it sets `allVisible = false` only when a child status is falsy:
```ts
if (node.children.length) {
    let allVisible = true
    for (const child of node.children) {
        const res = refreshVisible(child, visibles, tree)
        if (!res) allVisible = false       // only true for res===0
    }
    node.status = v ? allVisible ? 2 : 1 : 0
}
```
When a child is partially visible (`status===1`, a deeper descendant hidden), `!1 === false`, so `allVisible` stays `true` and the parent becomes status `2` (fully checked) instead of `1` (indeterminate). treejs' own `walkUp` computes parent status from the *sum* of children statuses, which correctly propagates indeterminate up the tree; this custom reimplementation diverges.
**Impact:** ancestors of any hidden grandchild render as fully-checked instead of indeterminate, mis-representing visibility state in the tree.
**Fix:** treat any non-fully-checked child as breaking full visibility, e.g. `if (res !== 2) allVisible = false`, or mirror treejs' sum-based logic.

## Bug 2 (low) — `onItemLabelClick` gates on the model root's visibility, not the clicked object's
```ts
onItemLabelClick: (item: any) => {
    const obj1 = this._viewer?.scene.modelRoot.getObjectByProperty('uuid', item)
    if (!obj1 || !obj.visible) return    // `obj` is modelRoot captured at line 114; should be obj1
```
`obj` is the `modelRoot` captured earlier in `_reset`; `obj1` is the clicked object. The guard checks `obj.visible` (the root) rather than `obj1.visible`. Intent was clearly the clicked object (named `obj1` everywhere else in the callback).
**Impact:** if `modelRoot` is hidden, no labels can be selected at all; and the intended "don't select hidden objects" behaviour never fires per-object.
**Fix:** change the guard to `if (!obj1 || !obj1.visible) return` (or drop the check if selecting hidden objects is desired).

## Files
- `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:299-317` — `refreshVisible` tri-state rollup (`if (!res)` at 306)
- `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:138-140` — `onItemLabelClick` checks `obj.visible` (root) instead of `obj1.visible`
- `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:114` — `obj` captured as `modelRoot`
