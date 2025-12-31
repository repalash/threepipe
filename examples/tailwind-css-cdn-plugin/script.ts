import {
    _testFinish, _testStart,
    TailwindCSSCDNPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
    })

    // Add the bTailwindCSS CDN Plugin
    viewer.addPluginSync(new TailwindCSSCDNPlugin())

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    // Create a simple UI panel with Tailwind CSS classes
    const panel = document.createElement('div')
    panel.className = 'absolute top-5 left-5'
    panel.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl p-6 max-w-sm backdrop-blur-sm bg-opacity-90">
            <h2 class="text-2xl font-bold mb-2 text-gray-800">Tailwind CSS</h2>
            <p class="text-gray-600 mb-4">This UI is styled with Tailwind CSS loaded from CDN!</p>
            <button class="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded transition duration-200">
                Styled Button
            </button>
        </div>
    `
    viewer.container.appendChild(panel)

    // Add Tweakpane UI for plugin settings
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TailwindCSSCDNPlugin)

}

_testStart()
init().finally(_testFinish)

