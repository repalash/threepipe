import {
    _testFinish, _testStart,
    BoxGeometry,
    FrameFadePlugin,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    ThreeViewer,
} from 'threepipe'
import {createExampleBar} from '../examples-utils/example-bar.js'

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

    createExampleBar(viewer, [
        {type: 'button', label: 'Change Color', icon: 'palette', value: ()=>{
            cube.material.color.setHSL(Math.random(), 1, 0.5)
            cube.material.setDirty() // this will trigger frame fade
        }},
        {type: 'button', label: 'Change Size', icon: 'scaling', value: ()=>{
            cube.scale.setScalar(Math.random() * 1.5 + 0.5)
            cube.setDirty && cube.setDirty({fadeDuration: 1000}) // duration can be controlled by an option like this.
        }},
        {type: 'button', label: 'Change Color (no fade)', icon: 'paintbrush', value: ()=>{
            cube.material.color.setHSL(Math.random(), 1, 0.5)
            cube.material.setDirty({frameFade: false}) // disable frame fade for this update but re-render the scene.
        }},
    ])

}

_testStart()
init().finally(_testFinish)
