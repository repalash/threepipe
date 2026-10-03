/**
 * Blender's selection operations for region tools: how an element's current selection and whether it
 * is inside the region combine into "select it", "deselect it" or "leave it".
 *
 * Port of `eSelectOp` (`editors/include/ED_select_utils.hh:38`) and `ED_select_op_action` /
 * `ED_select_op_action_deselected` (`editors/util/select_utils.cc:27`, `:44`).
 */

/**
 * - `set`: replace the selection with what is inside (operators call this "new").
 * - `add`: extend - `Shift`.
 * - `sub`: subtract - `Ctrl`.
 * - `and`: intersect - keep only what was selected and is inside.
 * - `xor`: difference - toggle what is inside.
 */
export type SelectOp = 'set' | 'add' | 'sub' | 'and' | 'xor'

/** `SEL_OP_USE_PRE_DESELECT`: the whole selection is cleared before the region is applied. */
export function selectOpUsePreDeselect(op: SelectOp): boolean {
    return op === 'set'
}

/** `SEL_OP_USE_OUTSIDE`: elements outside the region are also affected. */
export function selectOpUseOutside(op: SelectOp): boolean {
    return op === 'and'
}

/** `SEL_OP_CAN_DESELECT`. */
export function selectOpCanDeselect(op: SelectOp): boolean {
    return op !== 'add'
}

/**
 * `ED_select_op_action`: returns 1 to select, 0 to deselect, -1 to leave alone.
 */
export function selectOpAction(op: SelectOp, isSelect: boolean, isInside: boolean): -1 | 0 | 1 {
    switch (op) {
    case 'add':
        return !isSelect && isInside ? 1 : -1
    case 'sub':
        return isSelect && isInside ? 0 : -1
    case 'set':
        return isInside ? 1 : 0
    case 'and':
        return isSelect && isInside ? -1 : isSelect ? 0 : -1
    case 'xor':
        return isSelect && isInside ? 0 : !isSelect && isInside ? 1 : -1
    }
}

/**
 * `ED_select_op_action_deselected`: as {@link selectOpAction}, for use when everything was already
 * deselected for `set` - the only difference is that `set` then leaves outside elements alone.
 */
export function selectOpActionDeselected(op: SelectOp, isSelect: boolean, isInside: boolean): -1 | 0 | 1 {
    switch (op) {
    case 'add':
        return !isSelect && isInside ? 1 : -1
    case 'sub':
        return isSelect && isInside ? 0 : -1
    case 'set':
        return isInside ? 1 : -1
    case 'and':
        return isSelect && isInside ? -1 : isSelect ? 0 : -1
    case 'xor':
        return isSelect && isInside ? 0 : !isSelect && isInside ? 1 : -1
    }
}

/**
 * `ED_select_op_modal`: a modal `set` becomes `add` after its first application, so a circle-select
 * stroke keeps accumulating instead of replacing itself each step.
 */
export function selectOpModal(op: SelectOp, isFirst: boolean): SelectOp {
    if (op === 'set' && !isFirst) return 'add'
    return op
}

/**
 * The operation Blender's select-box / select-lasso tools map the modifier keys to
 * (`blender_default.py`, `_template_items_tool_select_actions`): plain is set, `Shift` extends, `Ctrl`
 * subtracts, both together intersect.
 */
export function selectOpFromModifiers(shift: boolean, ctrl: boolean): SelectOp {
    if (shift && ctrl) return 'and'
    if (shift) return 'add'
    if (ctrl) return 'sub'
    return 'set'
}
