import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

/**
 * The modelling editor driven through its interaction engine (`@threepipe/plugin-editor-engine`):
 * the keymap presets (Blender, Design), the one undo history across object and edit mode, redo-last,
 * popup menus from keys (X, M, Shift+A, Ctrl+A) and the context menus.
 *
 * Same shell as `modelling-editor`; the keymap preference is not persisted here so the page always
 * starts on the Blender preset, which the real-input test relies on. Switch presets from
 * Edit > Keymap, or `engine.keymap.setPreset('design')`.
 */

async function init() {
    const editor = createModellingEditor({
        container: document.getElementById('editor')!,
        title: 'threepipe',
        viewer: {plugins: [LoadingScreenPlugin]},
        engine: {keymap: 'blender', storageKey: null},
    })
    const {viewer, engine} = editor

    // A cube to start with, selected, as in the editor example.
    await engine.run('add.cube')

    Object.assign(window as never, {viewer, editor, engine, modelling: viewer.getPlugin(ModellingPlugin)})
    console.log('Try: engine.keymap.setPreset("design"); engine.operators.list().map(o => [o.id, o.shortcut])')
}

_testStart()
init().finally(_testFinish)
