import {
    _testFinish,
    _testStart,
    EntityComponentPlugin, IAnimationLoopEvent,
    IObject3D,
    LoadingScreenPlugin, Object3DComponent,
    SampleBodyComponent,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Sample test of EntityComponentPlugin with a sample component that moves the object in a cirle and exposes some state properties for UI and serialization.
// The components can be added and edited from the UI under every object.
// Change the options in the Components->MoveInCircleComponent section to see it in action.

// See also example - https://threepipe.org/examples/#entity-component-plugin

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, EntityComponentPlugin],
    })
    viewer.scene.disableAutoNearFar()
    viewer.scene.mainCamera.position.z = 10

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
    ecs.componentTypes.set(MoveInCircleComponent.ComponentType, MoveInCircleComponent)

    ecs.addComponent(helmet, {
        type: MoveInCircleComponent.ComponentType,
        // any existing state
        state: {
            running: true,
            radius: 3,
            timeScale: 0.2,
        },
    })

    // Setup a basic UI for development
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(EntityComponentPlugin, {expanded: true})
    ui.appendChild(helmet.uiConfig)

}

/**
 * Sample component that moves the object in a circle around the origin on the XZ Plane
 */
export class MoveInCircleComponent extends Object3DComponent {
    // These properties will be serialized and shown in the UI
    static StateProperties = ['running', 'radius', 'timeScale']

    running = true

    radius = 2

    timeScale = 0.1

    static ComponentType = 'MoveInCircleComponent'

    update({time}: IAnimationLoopEvent) {
        if (!this.running) return
        if (!this.object) return
        this.object.position.x = Math.cos(time * this.timeScale / 100) * this.radius
        this.object.position.z = Math.sin(time * this.timeScale / 100) * this.radius
        // this.object.setDirty({change: 'position'}) // todo because of this its not updating the ui since it always throttles, setting last: false should disable refreshUi
        return true // to set viewer dirty
    }

}

_testStart()
init().finally(_testFinish)
