import {IObject3D} from 'threepipe'

/**
 * The selection rules of {@link SelectionUxPlugin} as functions of the model root and the current selection, like in
 * Figma: a click selects the outermost group under the pointer, a group with a single child is one level with that
 * child, and a top-level object that holds a whole file (a frame) passes a click to its parts.
 * Each function only reads the scene graph; the plugin applies the result.
 */

/** A level of the hierarchy: a chain of objects that select as one, outermost first (see {@link selectionLevels}) */
export type SelectionLevel = IObject3D[]

/**
 * Objects that are not part of the content: widgets and their roots, the dummy of a multi selection, and the target
 * child of a light.
 */
export function isHelperObject(o: IObject3D): boolean {
    return o.assetType === 'widget' || !!o.userData.isWidgetRoot || !!o.userData.isMultiSelectDummy ||
        (o.parent as any)?.target === o // the target child of a directional or spot light
}

/**
 * Whether the `PickingPlugin` leaves `o` out of the selection: it is hidden (`visible = false`), cannot be selected
 * (`userData.userSelectable === false`) or has no box (`userData.bboxVisible === false`). As in the `PickingPlugin`,
 * nothing inside it is selected either.
 */
export function isExcluded(o: IObject3D): boolean {
    return !o.visible || o.userData.userSelectable === false || o.userData.bboxVisible === false
}

/** A child that is not a helper ({@link isHelperObject}) and not excluded ({@link isExcluded}) */
const isContentChild = (c: IObject3D) => !isHelperObject(c) && !isExcluded(c)

/** The children of `o` that are not helpers ({@link isHelperObject}) and not excluded ({@link isExcluded}) */
export function contentChildren(o: IObject3D): IObject3D[] {
    return (o.children as IObject3D[]).filter(isContentChild)
}

/** Whether `o` or an object inside it passes `test`; it stops at the first one (`traverse` visits the whole tree) */
function someInTree(o: IObject3D, test: (o: IObject3D) => boolean): boolean {
    if (test(o)) return true
    for (const c of o.children as IObject3D[]) if (someInTree(c, test)) return true
    return false
}

const isContent = (o: IObject3D) => !!(o.geometry || o.isLight || o.isCamera)
const isMesh = (o: IObject3D) => !!(o as any).isMesh

/** Whether `o` or an object inside it has a geometry, or is a light or a camera */
export function hasContent(o: IObject3D): boolean {
    return someInTree(o, isContent)
}

/** The content children of `o` with content: what a click, Enter or Ctrl+A can select inside `o` */
export function selectableChildren(o: IObject3D): IObject3D[] {
    return contentChildren(o).filter(hasContent)
}

/** The object that a level selects: the outermost of its chain */
export function levelTarget(level: SelectionLevel): IObject3D {
    return level[0]
}

/** The only child of a wrapper (a group with a single content child, merged with it into one level), else undefined */
function wrappedChild(o: IObject3D): IObject3D | undefined {
    if (o.geometry) return undefined
    // stops at the second content child, so a wide group costs no more than a small one
    let only: IObject3D | undefined
    for (const c of o.children as IObject3D[]) {
        if (!isContentChild(c)) continue
        if (only) return undefined
        only = c
    }
    return only
}

/** The innermost object of the level that `o` starts: `o`, or the end of its chain of single children */
function chainEnd(o: IObject3D): IObject3D {
    for (let c = wrappedChild(o); c; c = wrappedChild(o)) o = c
    return o
}

/** `o` and the chain of single children below it that select as one with it (a wrapper chain), outermost first */
export function wrappedChain(o: IObject3D): IObject3D[] {
    const chain = [o]
    for (let c = wrappedChild(o); c; c = wrappedChild(c)) chain.push(c)
    return chain
}

/** The index of the level that holds `o`, -1 when no level holds it */
function levelIndex(levels: SelectionLevel[], o: IObject3D): number {
    return levels.findIndex(l => l.includes(o))
}

/**
 * The levels of the hierarchy from the model root down to `node` (the root is not in them).
 * Each level is a chain: a group with a single content child is merged with that child (glTF wrappers like "Scene" >
 * "root"), so one click never selects a wrapper that looks the same as its only child. A helper ({@link isHelperObject})
 * is not in the levels.
 * The last level ends at `node`. Returns an empty array when `node` is not inside `root`, or when `node` or a parent
 * of it is excluded ({@link isExcluded}: hidden, or left out by the `PickingPlugin`).
 */
export function selectionLevels(root: IObject3D, node: IObject3D): SelectionLevel[] {
    const path: IObject3D[] = []
    let o: IObject3D | null = node
    while (o && o !== root) {
        path.unshift(o)
        o = o.parent as IObject3D | null
    }
    if (o !== root || path.some(isExcluded)) return []
    const levels: SelectionLevel[] = []
    let chain: IObject3D[] = []
    for (const n of path) {
        // a helper (a widget) is not a level: its parts are
        if (isHelperObject(n)) continue
        chain.push(n)
        if (!wrappedChild(n)) {
            levels.push(chain)
            chain = []
        }
    }
    if (chain.length) levels.push(chain)
    return levels
}

/**
 * Whether `o` is a frame: a top-level object that holds a whole file, like a top-level frame in Figma. A click selects
 * its parts, not all of it (select it in a layers panel, or with Esc from a part).
 * It is an imported file root (glTF scene), or the only top-level object with meshes, and it has two or more parts.
 */
export function isFrame(root: IObject3D, o: IObject3D): boolean {
    // the counts stop at 2, so a frame check does not walk a whole wide group or a whole scene
    if (o.parent !== root || countChildren(chainEnd(o), hasContent) < 2) return false
    const ud = o.userData
    if (ud.rootPath || ud.gltfAsset || ud.glTF2ExportSettings) return true
    // the only top-level object with meshes: `o` is that object
    return someInTree(o, isMesh) && countChildren(root, c => someInTree(c, isMesh)) === 1
}

/** How many content children ({@link contentChildren}) of `o` pass `test`, counted up to 2 */
function countChildren(o: IObject3D, test: (c: IObject3D) => boolean): number {
    let n = 0
    for (const c of o.children as IObject3D[]) if (isContentChild(c) && test(c) && ++n >= 2) break
    return n
}

/**
 * The objects at the level of the primary selection (`selected[0]`): its parent's selectable children.
 * With nothing selected: the top-level objects, where a frame stands for its parts.
 */
export function scopeObjects(root: IObject3D, selected: IObject3D[]): IObject3D[] {
    const primary = selected[0]
    let parent = root
    if (primary) {
        const levels = selectionLevels(root, primary)
        const i = levelIndex(levels, primary)
        if (i > 0) parent = chainEnd(levelTarget(levels[i - 1]))
    } else {
        const top = selectableChildren(root)
        const frames = top.filter(o => isFrame(root, o))
        if (frames.length) return [...top.filter(o => !frames.includes(o)), ...frames.flatMap(f => selectableChildren(chainEnd(f)))]
    }
    return selectableChildren(parent)
}

/**
 * The object that a click on `leaf` selects (Figma rules), or null when `leaf` is not inside `root`:
 * - `deep` (Ctrl/Cmd+click): the leaf's own level.
 * - When a level of the leaf is selected: that object, or with `drill` (double click) the next level inside it.
 * - When the leaf is in the same parent group as the primary selection: the sibling under the pointer.
 * - Else the top-level object; a frame ({@link isFrame}) passes the click to its part.
 */
export function resolveTarget(root: IObject3D, selected: IObject3D[], leaf: IObject3D, deep: boolean, drill: boolean): IObject3D | null {
    const levels = selectionLevels(root, leaf)
    if (!levels.length) return null
    if (deep) return levelTarget(levels[levels.length - 1])
    for (let i = levels.length - 1; i >= 0; i--) {
        const s = levels[i].find(n => selected.includes(n))
        if (s) return drill ? levelTarget(levels[Math.min(i + 1, levels.length - 1)]) : s
    }
    const primary = selected[0]
    if (primary) {
        const pl = selectionLevels(root, primary)
        const pi = levelIndex(pl, primary)
        // same parent group as the primary selection: the sibling under the pointer
        if (pi > 0 && levels[pi - 1] && levelTarget(levels[pi - 1]) === levelTarget(pl[pi - 1]) && levels[pi]) return levelTarget(levels[pi])
    }
    if (levels.length > 1 && isFrame(root, levelTarget(levels[0]))) return levelTarget(levels[1])
    return levelTarget(levels[0])
}

/** The parent level of the primary selection (Esc), null at the top level or with nothing selected */
export function parentTarget(root: IObject3D, selected: IObject3D[]): IObject3D | null {
    const primary = selected[0]
    if (!primary) return null
    const levels = selectionLevels(root, primary)
    const i = levelIndex(levels, primary)
    return i > 0 ? levelTarget(levels[i - 1]) : null
}

/** The selectable children of each selected object (Enter) */
export function childTargets(root: IObject3D, selected: IObject3D[]): IObject3D[] {
    return selected.flatMap(s => selectionLevels(root, s).length ? selectableChildren(chainEnd(s)) : [])
}

/**
 * The next (`dir` 1) or previous (-1) object in {@link scopeObjects} after the primary selection, with wrap around (Tab).
 * A primary selection inside a chain (selected in a layers panel) counts as its level's target.
 */
export function siblingTarget(root: IObject3D, selected: IObject3D[], dir: 1 | -1): IObject3D | null {
    const scope = scopeObjects(root, selected)
    if (!scope.length) return null
    const primary = selected[0]
    const level = primary ? selectionLevels(root, primary).find(l => l.includes(primary)) : undefined
    const i = primary ? scope.indexOf(level ? levelTarget(level) : primary) : -1
    const from = i >= 0 ? i : dir > 0 ? -1 : 0
    return scope[(from + dir + scope.length) % scope.length]
}

/** The selection after a Shift+click on `target`: removed when selected, else added in front (it becomes the primary) */
export function toggleSelected(selected: IObject3D[], target: IObject3D): IObject3D[] {
    return selected.includes(target) ? selected.filter(o => o !== target) : [target, ...selected]
}
