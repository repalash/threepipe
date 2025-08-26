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
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

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

    createSimpleButtons({
        ['Move Up/Down']: async(btn) => {
            btn.disabled = true
            await popmotion.animateTargetAsync(cube, 'position', {
                to: cube.position.clone().add(new Vector3(0, isMovedUp ? -1 : 1, 0)),
                duration: 500, // ms
                onComplete: () => isMovedUp = !isMovedUp,
                onUpdate: () => cube.setDirty(),
            })
            btn.disabled = false
        },
        ['Rotate +90deg']: async(btn) => {
            btn.disabled = true
            await popmotion.animateAsync({
                from: cube.rotation.y,
                to: cube.rotation.y + Math.PI / 2,
                duration: 500,
                onUpdate: (v) => {
                    cube.rotation.y = v
                    cube.setDirty()
                },
            })
            btn.disabled = false
        },
        ['Change Color']: async(btn)=>{
            btn.disabled = true
            await popmotion.animateAsync({
                from: '#' + cube.material.color.getHexString(),
                to: '#' + new Color().setHSL(Math.random(), 1, 0.5).getHexString(),
                duration: 500,
                onUpdate: (v) => {
                    cube.material.color.set(v)
                    cube.material.setDirty()
                },
            })
            btn.disabled = false
        },
    })

}

_testStart()
init().finally(_testFinish)
