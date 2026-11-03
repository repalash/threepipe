import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TheatreJsPlugin} from './TheatreJsPlugin.js'

// An example of using the incomplete Theatre.js plugin with ThreeViewer.
// Note - it's possible to use theatre.js with threepipe without an integration in your projects as theatre.js is a standalone library.
// The plugin is a test to include the full editor within the threepipe editor. The basic poc works, but not very useful at the moment since it's not possible to programmatically manage keyframes in theatre.js (https://github.com/theatre-js/theatre/issues/506)

// To try out the example -
// 1. Open the Root Scene menu in the Tweakpane UI
// 2. Click the diamond icon to add the property in theatre.js
// 3. Select RootScene from the left in theatre.js UI
// 3. Select the property on the right in the theatre.js UI and press yellow button to add a keyframe
// 4. Manage keyframes in the theatre.js UI
// 5. Only 3 properties supported at the moment as a test - background intensity, environment rotation and environment intensity.

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, TheatreJsPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    ui.appendChild(viewer.scene.uiConfig, {expanded: true})

}

_testStart()
init().finally(_testFinish)
