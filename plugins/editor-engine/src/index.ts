/**
 * `@threepipe/plugin-editor-engine` - the framework-free interaction engine of the modelling editor.
 *
 * See `issues/open/modelling-tools/11-p1-interaction-engine.md` for why this is its own package: it
 * composes `@threepipe/plugin-mesh-edit`, `@threepipe/plugin-modelling` and threepipe's picking,
 * gizmo and undo plugins into one operator surface that a React shell, another app or an agent can
 * drive the same way.
 */

export * from './registry'
export {EditorEnginePlugin, createEditorEngine} from './EditorEnginePlugin'
export type {EditorEngineOptions} from './EditorEnginePlugin'
export {EditorHistory, labelOf} from './history/EditorHistory'
export {Keymap, parseCombo, comboFromEvent, comboKey, formatCombo, keyNameFromCode} from './keymap/Keymap'
export type {KeyCombo} from './keymap/Keymap'
export {blenderPreset} from './keymap/presets/blender'
export {designPreset} from './keymap/presets/design'
export {InputRouter} from './input/InputRouter'
export type {InputRouterHost} from './input/InputRouter'
export {Navigation, defaultPointingDevice} from './input/Navigation'
export type {NavigationSpec} from './input/Navigation'
export {EditorFile, baseName, RECENT_FILES_MAX} from './files/EditorFile'
export {registerEditOperators} from './ops/editOps'
export {registerFileOperators} from './ops/fileOps'
export {registerObjectOperators} from './ops/objectOps'
export {registerMeshOperators} from './ops/meshOps'
export {registerFillOperators} from './ops/fillOps'
export {registerModellingOperators} from './ops/modellingOps'
export {registerTools} from './tools/tools'
export {PropDragModal} from './tools/PropDragModal'
export type {PropDragSpec} from './tools/PropDragModal'
