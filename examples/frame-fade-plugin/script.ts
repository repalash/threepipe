import {
    _testFinish, _testStart,
    BoxGeometry,
    FrameFadePlugin,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })
    viewer.addPluginSync(FrameFadePlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const cube = viewer.scene.addObject(new Mesh(
        new BoxGeometry(1, 1, 1),
        new PhysicalMaterial({color: 0xff0000})
    ))

    createSimpleButtons({
        ['Change Color']: ()=>{
            cube.material.color.setHSL(Math.random(), 1, 0.5)
            cube.material.setDirty() // this will trigger frame fade
        },
        ['Change Size']: ()=>{
            cube.scale.setScalar(Math.random() * 1.5 + 0.5)
            cube.setDirty({fadeDuration: 1000}) // duration can be controlled by an option like this.
        },
        ['Change Color (no fade)']: ()=>{
            cube.material.color.setHSL(Math.random(), 1, 0.5)
            cube.material.setDirty({frameFade: false}) // disable frame fade for this update but re-render the scene.
        },
    })

}

_testStart()
init().finally(_testFinish)
