import {
    _testFinish, _testStart,
    BoxGeometry,
    Color,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PopmotionPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {createExampleBar} from '../examples-utils/example-bar.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })
    const popmotion = viewer.addPluginSync(PopmotionPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const cube = viewer.scene.addObject(new Mesh(
        new BoxGeometry(1, 1, 1),
        new PhysicalMaterial({color: 0xff0000})
    ))

    let isMovedUp = false

    createExampleBar(viewer, [
        {type: 'button', label: 'Move Up/Down', icon: 'move-vertical', value: async() => {
            await popmotion.animateTargetAsync(cube, 'position', {
                to: cube.position.clone().add(new Vector3(0, isMovedUp ? -1 : 1, 0)),
                duration: 500, // ms
                onComplete: () => isMovedUp = !isMovedUp,
                onUpdate: () => cube.setDirty?.(),
            })
        }},
        {type: 'button', label: 'Rotate +90deg', icon: 'rotate-cw', value: async() => {
            await popmotion.animateAsync({
                from: cube.rotation.y,
                to: cube.rotation.y + Math.PI / 2,
                duration: 500,
                onUpdate: (v) => {
                    cube.rotation.y = v
                    cube.setDirty?.()
                },
            })
        }},
        {type: 'button', label: 'Change Color', icon: 'palette', value: async()=>{
            await popmotion.animateAsync({
                from: '#' + cube.material.color.getHexString(),
                to: '#' + new Color().setHSL(Math.random(), 1, 0.5).getHexString(),
                duration: 500,
                onUpdate: (v) => {
                    cube.material.color.set(v)
                    cube.material.setDirty()
                },
            })
        }},
    ])

}

_testStart()
init().finally(_testFinish)
