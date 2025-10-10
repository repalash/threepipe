import * as THREE from 'threepipe'
import {
    _testFinish,
    _testStart,
    bindToValue,
    IMaterial,
    LoadingScreenPlugin,
    onChange,
    SSAAPlugin,
    ThreeViewer,
    TonemapPlugin,
    uiFolderContainer,
    UiObjectConfig,
    uiSlider,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {Sky} from 'three/examples/jsm/objects/Sky.js'

@uiFolderContainer('Sky')
class Sky2 extends Sky {
    @uiSlider('turbidity', [0, 20], 0.1)
    @bindToValue({obj: 'material', key: ['uniforms', 'turbidity', 'value'], onChange: 'matUpdate'})
        turbidity = 10

    @uiSlider('rayleigh', [0, 4], 0.001)
    @bindToValue({obj: 'material', key: ['uniforms', 'rayleigh', 'value'], onChange: 'matUpdate'})
        rayleigh = 3

    @uiSlider('mieCoefficient', [0, 0.1], 0.001)
    @bindToValue({obj: 'material', key: ['uniforms', 'mieCoefficient', 'value'], onChange: 'matUpdate'})
        mieCoefficient = 0.005

    @uiSlider('mieDirectionalG', [0, 1], 0.001)
    @bindToValue({obj: 'material', key: ['uniforms', 'mieDirectionalG', 'value'], onChange: 'matUpdate'})
        mieDirectionalG = 0.7

    @uiSlider('elevation', [0, 90], 0.1)
    @onChange('updateSun')
        elevation = 2

    @uiSlider('azimuth', [-180, 180], 0.1)
    @onChange('updateSun')
        azimuth = 180

    declare material: THREE.ShaderMaterial & IMaterial
    declare uiConfig: UiObjectConfig

    constructor() {
        super()
    }
    updateSun() {
        const phi = THREE.MathUtils.degToRad(90 - this.elevation)
        const theta = THREE.MathUtils.degToRad(this.azimuth)
        this.material.uniforms.sunPosition.value.setFromSphericalCoords(1, phi, theta)
        this.matUpdate()
    }
    matUpdate() {
        this.material.needsUpdate = true
        this.material.setDirty && this.material.setDirty()
    }
}

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
    const sky = new Sky2()
    sky.scale.setScalar(450000)
    viewer.scene.addObject(sky, {addToRoot: true})

    const tonemap = viewer.getPlugin(TonemapPlugin)

    const skyUi: UiObjectConfig = {
        type: 'folder',
        label: 'Sky',
        expanded: true,
        children: [
            ...sky.uiConfig.children || [],
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
    sky.turbidity = 10
    sky.rayleigh = 3
    sky.mieCoefficient = 0.005
    sky.mieDirectionalG = 0.7
    sky.elevation = 2
    sky.azimuth = 180

}

_testStart()
init().then(_testFinish)
