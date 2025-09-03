import * as THREE from 'threepipe'
import {
    _testFinish,
    _testStart,
    LoadingScreenPlugin,
    PickingPlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'
import {CSM, type CSMParameters} from 'three/examples/jsm/csm/CSM.js'
import {CSMHelper} from 'three/examples/jsm/csm/CSMHelper.js'

// Note - This examples ports the basic CSM Demo from Three.js examples.
// check out the CSMShadowsPlugin example for integrated use with complete UI and other features - https://threepipe.org/examples/#csm-shadows-plugin/

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: false,
        debug: true,
        tonemap: false,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, SSAAPlugin, BloomPlugin, SSReflectionPlugin, SSAOPlugin, TemporalAAPlugin, PickingPlugin],
    })

    viewer.renderManager.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap
    viewer.renderManager.stableNoise = true
    viewer.scene.mainCamera.autoNearFar = false
    viewer.scene.mainCamera.far = 5000
    viewer.scene.mainCamera.position.set(160, 120, 0)
    viewer.scene.mainCamera.target.set(-120, 40, 20)

    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    // await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    //     autoCenter: true,
    //     autoScale: true,
    // })
    viewer.scene.backgroundColor?.set('#454e61')

    const params = {
        orthographic: false,
        fade: false,
        far: 5000,
        mode: 'practical' as CSMParameters['mode'],
        lightX: -1,
        lightY: -1,
        lightZ: -1,
        lightMargin: 100,
        lightFar: 5000,
        lightNear: 1,
        autoUpdateHelper: true,
    }

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    viewer.scene.modelRoot.add(ambientLight)

    const additionalDirectionalLight = new THREE.DirectionalLight(0x000020, 1.5)
    additionalDirectionalLight.position.set(params.lightX, params.lightY, params.lightZ).normalize().multiplyScalar(-200)
    viewer.scene.modelRoot.add(additionalDirectionalLight)

    const csm = new CSM({
        maxFar: params.far,
        cascades: 4,
        mode: params.mode,
        parent: viewer.scene.modelRoot,
        shadowMapSize: 1024,
        lightDirection: new THREE.Vector3(params.lightX, params.lightY, params.lightZ).normalize(),
        camera: viewer.scene.mainCamera,
        lightMargin: params.lightMargin,
        lightNear: params.lightNear,
        lightFar: params.lightFar,
    })

    const csmHelper = new CSMHelper(csm)
    csmHelper.visible = false
    csmHelper.traverse(o=>{o.userData.__keepShadowDef = true})
    viewer.scene.modelRoot.add(csmHelper)

    const floorMaterial = new THREE.PhysicalMaterial({
        color: '#252a34',
        roughness: 0.1,
        metalness: 0.5,
    })
    setupMaterial(floorMaterial, csm)

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
    setupMaterial(material1, csm)

    const material2 = new THREE.PhysicalMaterial({
        color: '#ff2e63',
        roughness: 0.1,
        metalness: 0.5,
        emissive: '#ff0000',
        emissiveIntensity: 1,
    })
    setupMaterial(material2, csm)

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

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    // ui.appendChild(obj.uiConfig)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(SSReflectionPlugin)
    ui.setupPluginUi(SSAOPlugin)
    ui.setupPluginUi(BloomPlugin)

    viewer.addEventListener('preRender', ()=>{
        csm.update()
        if (params.orthographic) {
            // updateOrthoCamera()
            csm.updateFrustums()
            if (params.autoUpdateHelper && csmHelper.visible) {
                csmHelper.update()
            }
        } else {
            if (params.autoUpdateHelper && csmHelper.visible) {
                csmHelper.update()
            }
        }
    })

    viewer.renderManager.addEventListener('resize', ()=>{
        // updateOrthoCamera()
        csm.updateFrustums()
    })

    // const getNormalDepth = ()=>({texture: gbufferPlugin?.normalDepthTexture})
    // const getFlags = ()=>({texture: gbufferPlugin?.flagsTexture})
    // const getDepthTexture = ()=>({texture: viewer.getPlugin(DepthBufferPlugin)?.texture})

    // const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    // targetPreview.addTarget(getNormalDepth, 'normalDepth')
    // targetPreview.addTarget(getFlags, 'gBufferFlags')
    // targetPreview.addTarget(getDepthTexture, 'depthTexture')
}

_testStart()
init().finally(_testFinish)


function setupMaterial(material: THREE.Material, csm: CSM) {

    material.defines = material.defines || {}
    material.defines.USE_CSM = 1
    material.defines.CSM_CASCADES = csm.cascades

    if (csm.fade) {

        material.defines.CSM_FADE = ''

    }

    const breaksVec2: THREE.Vector2[] = []
    const scope = csm
    const shaders = csm.shaders

    const currentOnBeforeCompile = material.onBeforeCompile
    material.onBeforeCompile = function(shader, ...rest) {

        const far = Math.min((scope.camera as THREE.PerspectiveCamera).far, scope.maxFar)
        scope.getExtendedBreaks(breaksVec2)

        shader.uniforms.CSM_cascades = {value: breaksVec2}
        shader.uniforms.cameraNear = {value: (scope.camera as THREE.PerspectiveCamera).near}
        shader.uniforms.shadowFar = {value: far}

        shaders.set(material, shader as any)

        if (currentOnBeforeCompile) currentOnBeforeCompile.call(material, shader, ...rest)

    }

    shaders.set(material, null as any)

}
