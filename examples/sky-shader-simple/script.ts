import * as THREE from 'threepipe'
import {
    _testFinish,
    _testStart,
    LoadingScreenPlugin,
    SSAAPlugin,
    ThreeViewer,
    TonemapPlugin,
    UiObjectConfig,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {Sky} from 'three/examples/jsm/objects/Sky.js'

// See also sky-shader-simple-ts example for a sample usage with decorators and reusable implementation.

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        zPrepass: false,
        renderScale: 1,
        maxHDRIntensity: 100,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, SSAAPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await Promise.allSettled([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
            autoCenter: true,
            autoScale: true,
        }),
    ])

    // Add Sky
    const sky = new Sky()
    sky.scale.setScalar(450000)
    viewer.scene.addObject(sky, {addToRoot: true})

    // Create UI
    const elevation: UiObjectConfig = {
        type: 'slider',
        bounds: [0, 90],
        stepSize: 0.1,
        label: 'elevation',
        value: 2,
        onChange: updateSun,
    }
    const azimuth: UiObjectConfig = {
        type: 'slider',
        bounds: [-180, 180],
        stepSize: 0.1,
        label: 'azimuth',
        value: 180,
        onChange: updateSun,
    }

    function updateSun() {

        const phi = THREE.MathUtils.degToRad(90 - elevation.value)
        const theta = THREE.MathUtils.degToRad(azimuth.value)
        sky.material.uniforms.sunPosition.value.setFromSphericalCoords(1, phi, theta)

    }

    const tonemap = viewer.getPlugin(TonemapPlugin)

    const skyUi: UiObjectConfig = {
        type: 'folder',
        label: 'Sky',
        expanded: true,
        onChange: ()=>{
            sky.material.needsUpdate = true
            ;(sky.material as any).setDirty()
        },
        children: [{
            type: 'slider',
            bounds: [0, 20],
            stepSize: 0.1,
            label: 'turbidity',
            property: [sky.material.uniforms.turbidity, 'value'],
        }, {
            type: 'slider',
            bounds: [0, 4],
            stepSize: 0.001,
            label: 'rayleigh',
            property: [sky.material.uniforms.rayleigh, 'value'],
        }, {
            type: 'slider',
            bounds: [0, 0.1],
            stepSize: 0.001,
            label: 'mieCoefficient',
            property: [sky.material.uniforms.mieCoefficient, 'value'],
        }, {
            type: 'slider',
            bounds: [0, 1],
            stepSize: 0.001,
            label: 'mieDirectionalG',
            property: [sky.material.uniforms.mieDirectionalG, 'value'],
        },
        elevation,
        azimuth,
        {
            type: 'slider',
            bounds: [0, 3],
            stepSize: 0.0001,
            label: 'exposure',
            property: [tonemap, 'exposure'],
        }],
    }

    ui.appendChild(skyUi)

    // Set initial values
    sky.material.uniforms.turbidity.value = 10
    sky.material.uniforms.rayleigh.value = 3
    sky.material.uniforms.mieCoefficient.value = 0.005
    sky.material.uniforms.mieDirectionalG.value = 0.7
    updateSun()
}

_testStart()
init().then(_testFinish)
