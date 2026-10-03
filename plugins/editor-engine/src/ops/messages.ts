/**
 * Messages shared by the operator modules. Every poll reason and error says what to do next, with the
 * key the active keymap actually binds (it changes with the preset).
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'

/** Why an edit-mode operator cannot run in object mode, and how to get into edit mode. */
export function onlyInEditMessage(engine: EditorEnginePlugin): string {
    return `Only in Edit mode: select a mesh and press ${engine.keymap.shortcutFor('object.enter_edit', 'object') ?? 'the Edit button'}, or double-click it`
}
