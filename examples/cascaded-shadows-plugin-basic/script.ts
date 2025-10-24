import * as THREE from 'threepipe'
import {
    _testFinish,
    _testStart,
    CascadedShadowsPlugin, DirectionalLight2,
    LoadingScreenPlugin,
    PickingPlugin, RenderTargetPreviewPlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'
import {CSMHelper} from 'three/examples/jsm/csm/CSMHelper.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: false,
        debug: true,
        tonemap: false,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, new CascadedShadowsPlugin(), SSAAPlugin, BloomPlugin, SSReflectionPlugin, SSAOPlugin, TemporalAAPlugin, PickingPlugin],
    })

    // viewer.renderManager.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap
    viewer.renderManager.stableNoise = true
    viewer.scene.mainCamera.autoNearFar = false
    viewer.scene.mainCamera.far = 5000
    viewer.scene.mainCamera.position.set(160, 120, 0)
    viewer.scene.mainCamera.target.set(-120, 40, 20)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    // await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    //     autoCenter: true,
    //     autoScale: true,
    // })
    viewer.scene.backgroundColor?.set('#454e61')
    viewer.scene.environmentIntensity = 0.15

    const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
    viewer.scene.modelRoot.add(ambientLight)

    const light = new DirectionalLight2(0xffffff, 1.5)
    light.position.set(-1, -1, -1).normalize().multiplyScalar(-200)
    light.lookAt(0, 0, 0)
    light.castShadow = true
    light.shadowFrustum = 200
    light.shadow.bias = 0.000001
    light.shadow.camera.far = 5000
    light.shadow.camera.near = 1
    light.shadowRadius = 1
    light.name = 'main light'
    viewer.scene.addObject(light) // light will be picked automatically by the plugin

    const csmPlugin = viewer.getPlugin(CascadedShadowsPlugin)!
    csmPlugin.fade = false
    csmPlugin.maxFar = 5000
    csmPlugin.mode = 'practical'
    csmPlugin.setLightParams({
        // lightFar: 5000, // optional override
        // lightNear: 1,
        lightMargin: 100,
        cascades: 4,
        shadowMapSize: 1024,
    }, light)

    console.log(csmPlugin)

    const floorMaterial = new THREE.PhysicalMaterial({
        color: '#42495f',
        roughness: 0.1,
        metalness: 0.5,
    })

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10000, 10000, 8, 8), floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.castShadow = true
    floor.receiveShadow = true
    viewer.scene.modelRoot.add(floor)

    const material1 = new THREE.PhysicalMaterial({
        color: '#08d9d6',
        roughness: 0.1,
        metalness: 0.5,
        emissive: '#0000ff',
        emissiveIntensity: 1,
    })

    const material2 = new THREE.PhysicalMaterial({
        color: '#ff2e63',
        roughness: 0.1,
        metalness: 0.5,
        emissive: '#ff0000',
        emissiveIntensity: 1,
    })

    const geometry = new THREE.BoxGeometry(10, 10, 10)

    for (let i = 0; i < 40; i++) {

        const cube1 = new THREE.Mesh(geometry, i % 2 === 0 ? material1 : material2)
        cube1.castShadow = true
        cube1.receiveShadow = true
        viewer.scene.modelRoot.add(cube1)
        cube1.position.set(-i * 25, 20, 30)
        cube1.scale.y = Math.random() * 2 + 6

        const cube2 = new THREE.Mesh(geometry, i % 2 === 0 ? material2 : material1)
        cube2.castShadow = true
        cube2.receiveShadow = true
        viewer.scene.modelRoot.add(cube2)
        cube2.position.set(-i * 25, 20, -30)
        cube2.scale.y = Math.random() * 2 + 6

    }

    // Default CSMHelper from three.js not fully supported but works. Set visible to true to see
    const csmHelper = new CSMHelper(viewer.getPlugin(CascadedShadowsPlugin) as any)
    csmHelper.traverse(o=>{o.userData.__keepShadowDef = true})
    csmHelper.visible = false
    viewer.scene.modelRoot.add(csmHelper)
    viewer.addEventListener('preRender', ()=>{
        if (csmHelper.visible) csmHelper.update()
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(light.uiConfig)
    ui.setupPluginUi(CascadedShadowsPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(SSReflectionPlugin)
    ui.setupPluginUi(SSAOPlugin)
    ui.setupPluginUi(BloomPlugin)

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>csmPlugin.lights[0].shadow.map, 'csmShadowMap0', false, true, false)
    targetPreview.addTarget(()=>csmPlugin.lights[1].shadow.map, 'csmShadowMap1', false, true, false)
    targetPreview.addTarget(()=>csmPlugin.lights[2].shadow.map, 'csmShadowMap2', false, true, false)
    targetPreview.addTarget(()=>csmPlugin.lights[3].shadow.map, 'csmShadowMap3', false, true, false)
}

_testStart()
init().finally(_testFinish)

