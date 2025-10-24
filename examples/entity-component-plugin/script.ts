import {
    _testFinish,
    _testStart,
    EntityComponentPlugin,
    IObject3D,
    LoadingScreenPlugin,
    SampleBodyComponent,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Sample test of EntityComponentPlugin with a simple physics body component.
// The components can be added and edited from the UI under every object.
// Click the buttons Move left/right/up/down in the Components->SampleBodyComponent section to see it in action.

// See also example - https://threepipe.org/examples/#entity-component-custom for sample of a custom component

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, EntityComponentPlugin],
    })
    viewer.scene.disableAutoNearFar()

    viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const helmet = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!helmet) {
        console.error('Unable to load model')
        return
    }

    // Check the source of SampleBodyComponent - https://github.com/repalash/threepipe/blob/dev/src/plugins/extras/components/SampleBodyComponent.ts#L10
    const ecs = viewer.getPlugin(EntityComponentPlugin)!
    ecs.componentTypes.set(SampleBodyComponent.ComponentType, SampleBodyComponent)

    ecs.addComponent(helmet, SampleBodyComponent.ComponentType)

    // Setup a basic UI for development
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(EntityComponentPlugin, {expanded: true})
    ui.appendChild(helmet.uiConfig)

}

_testStart()
init().finally(_testFinish)
