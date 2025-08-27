import {
    _testFinish, _testStart,
    BaseGroundPlugin,
    BasicShadowMap,
    Color,
    DataUtils,
    DirectionalLight, DirectionalLight2,
    IObject3D,
    LoadingScreenPlugin,
    MaterialExtension,
    ProgressivePlugin,
    ShaderChunk,
    shaderReplaceString,
    SSAAPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const hdris = [
    'https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr',
    'https://threejs.org/examples/textures/equirectangular/spot1Lux.hdr',
    'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr',
    'https://dist.pixotronics.com/webgi/assets/hdr/gem_2.hdr',
    'https://samples.threepipe.org/minimal/studio_small_04_1k.hdr',
    'https://samples.threepipe.org/minimal/studio_small_03_1k.hdr',
    'https://threejs.org/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
    'https://threejs.org/examples/textures/equirectangular/blouberg_sunrise_2_1k.hdr',
    'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr',
    'https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr',
    'https://threejs.org/examples/textures/equirectangular/san_giuseppe_bridge_2k.hdr',
    'https://samples.threepipe.org/minimal/studio_small_06_1k.hdr',
    'https://samples.threepipe.org/minimal/studio_small_05_1k.hdr',
    'https://samples.threepipe.org/minimal/studio_small_02_1k.hdr',
    'https://samples.threepipe.org/minimal/studio_small_01_1k.hdr',
    'https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr',
]

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        plugins: [new ProgressivePlugin((window as any).TESTING ? 20 : 200), SSAAPlugin, LoadingScreenPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true,
                autoSetBackground: true,
            },
        },
    })

    const directionalLight = createDirLight(viewer)

    viewer.materialManager.registerMaterialExtension(extension)
    viewer.renderManager.renderer.shadowMap.type = BasicShadowMap

    // extra check to ignore the sampling of shadow if intensity is 0
    ShaderChunk.lights_fragment_begin = shaderReplaceString(
        ShaderChunk.lights_fragment_begin,
        'directLight.color *= ( directLight.visible && receiveShadow )',
        'directLight.color *= ( directLight.visible && receiveShadow && length(directLight.color) > 0.001)',
        {replaceAll: true})

    const ground = viewer.addPluginSync(BaseGroundPlugin)
    ground.mesh!.castShadow = false
    ground.material!.roughness = 1
    ground.material!.metalness = 0

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(false))

    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.scene.envMapIntensity = 1

    await viewer.setEnvironmentMap(hdris[0], {
        setBackground: true,
    })

    ui.appendChild({
        type: 'dropdown',
        label: 'Environment Map',
        children: hdris.map((url)=>({
            label: url.split('/').pop()!.split('.').shift()!,
            value: url,
        })),
        value: hdris[0],
        onChange: async(ev)=>{
            console.log(ev.value)
            await viewer.setEnvironmentMap(ev.value, {
                setBackground: true,
            })
            refreshHist()
        },
    })

    let histogram2 = createHistogramFromImage(viewer.scene.environment?.image)
    function refreshHist() {
        histogram2 = createHistogramFromImage(viewer.scene.environment?.image)
    }

    viewer.addEventListener('postFrame', ()=>updateLight(viewer, directionalLight, histogram2))

    ui.setupPluginUi(BaseGroundPlugin)
    // const targetPreview = viewer.addPluginSync(new RenderTargetPreviewPlugin())
    // targetPreview.addTarget(()=>directionalLight.shadow.map, 'shadow')

}

const extension: MaterialExtension = {
    isCompatible: ()=> true,
    computeCacheKey: ()=> 'aomap1',
    shaderExtender(shader) {
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <aomap_fragment>', `
#ifdef USE_AOMAP
    // reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
#else 
const int ii = 0;
DirectionalLightShadow edls = directionalLightShadows[ ii ];
float ambientOcclusion = getShadow( directionalShadowMap[ ii ], edls.shadowMapSize, edls.shadowBias, edls.shadowRadius, vDirectionalShadowCoord[ ii ] );
#endif

	reflectedLight.indirectDiffuse *= ambientOcclusion;

	#if defined( USE_ENVMAP ) && defined( STANDARD )

		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );

		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );

	#endif
            `)
        // shader.defines.USE_UV = ''
    },
}

function createDirLight(viewer: ThreeViewer) {
    const directionalLight = new DirectionalLight2(0xffffff, 4)
    directionalLight.position.set(-2, -2, 2)
    directionalLight.lookAt(0, 0, 0)
    directionalLight.color.set(0xffffff)
    directionalLight.intensity = 0
    directionalLight.castShadow = true
    directionalLight.shadowMapSize.setScalar(1024)
    directionalLight.shadowNear = 0.1
    directionalLight.shadowFar = 10
    directionalLight.shadowFrustum = 4
    directionalLight.userData.autoUpdateParent = false // so that viewer.setDirty is not called when we change any property.
    viewer.scene.addObject(directionalLight, {addToRoot: true})
    // move to index 0 in parent.children, so that directionalLight always has index 0 in shader. required for material extension
    const parent = directionalLight.parent!
    const index = parent.children.indexOf(directionalLight)
    if (index > 0) {
        parent.children.splice(index, 1)
        parent.children.unshift(directionalLight)
    }

    return directionalLight
}

function updateLight(viewer: ThreeViewer, directionalLight: DirectionalLight, histogram: ReturnType<typeof createHistogramFromImage>) {
    if (viewer.renderManager.frameCount < 1) return
    // if (viewer.renderManager.frameCount > 2) return
    const bounds = viewer.scene.getBounds(false)
    const size = bounds.getSize(new Vector3()).length()
    const center = bounds.getCenter(new Vector3())

    const i = viewer.renderManager.frameCount <= 1 ? histogram.brightestI : histogram.sampleIndex()
    histogram.indexToColor(i, directionalLight)
    directionalLight.intensity = 0 // so it doesnt show in the scene. Note that setDirty is disabled for this light (autoUpdateParent)
    histogram.indexToPosition(i, directionalLight.position).multiplyScalar(0.5 + size).add(center)
    directionalLight.lookAt(center)
    directionalLight.shadow.camera.near = Math.max(size / 100, 0.1)
    directionalLight.shadow.camera.far = size * 2.5
    directionalLight.shadow.camera.updateProjectionMatrix()
    viewer.renderManager.resetShadows()
}

function sampleRandom2(pow = 2) {
    return Math.max(0, Math.pow(Math.random(), pow) - 0.001)
}
function sampleRandom() {
    return Math.max(0, Math.random() - 0.001)
}

const maxIntensityClamp = 50
const ignoreBottomBins = 1 // should be at-least 1 to ignore black pixels.
const numBins = 100 // Number of bins in the histogram (configurable)
const sampleRandPower = 1.25 // increase this to give more focus to higher intensity pixels. between 1 and 2
const topHalf = true // todo if this is true, half the shadow in shader?

function createHistogramFromImage(image: {data: Uint16Array, width: number, height: number}) {
    const histogram: number[][] = []

    let maxIntensity = -1
    let brightestI = 0
    // const maxIntensity1 = 65504
    for (let i = 0; i < image.data.length / 4; i++) {
        const r = DataUtils.fromHalfFloat(image.data[i * 4])
        const g = DataUtils.fromHalfFloat(image.data[i * 4 + 1])
        const b = DataUtils.fromHalfFloat(image.data[i * 4 + 2])
        const a = DataUtils.fromHalfFloat(image.data[i * 4 + 3])
        const intensity = a * Math.max(r, g, b) // Calculate intensity
        const binIndex = Math.floor(numBins * Math.max(0, Math.min(1 - 0.001, intensity / maxIntensityClamp))) // Calculate the bin index
        histogram[binIndex] ||= []
        histogram[binIndex].push(i)
        if (maxIntensity < intensity) {
            maxIntensity = intensity
            brightestI = i
        }
        if (topHalf && i > image.data.length / 8) break
    }
    histogram.reverse()
    const cdf = histogram.map((bin) => bin ? bin.length : 0)
    const maxW = numBins - 1 - ignoreBottomBins + 1
    cdf[0] = cdf[0] * maxW
    for (let i = 1; i < numBins; i++) {
        cdf[i] = cdf[i - 1] + (cdf[i] || 0) * (maxW - i) // *i for intensity of that bin
    }
    console.log(cdf)
    return {
        histogram, cdf,
        brightestI,
        maxIntensity,
        sampleIndex: ()=>{
            const max = cdf[cdf.length - 1]
            const r = sampleRandom2(sampleRandPower) * max
            const binIndex = cdf.findIndex((value) => value >= r)
            const bin = histogram[binIndex]
            const index = Math.floor(bin.length * sampleRandom())
            return bin[index]
        },
        indexToPosition: (i: number, position: Vector3)=>{
            // todo handle envMapRotation
            const {width, height} = image
            const x = i % width / width
            const y = 1 - Math.floor(i / width) / height
            const phi = Math.PI * (x * 2 - 1)
            const theta = Math.PI * 0.5 * (y * 2 - 1)
            return position.set(
                Math.cos(theta) * Math.cos(phi),
                Math.sin(theta),
                Math.cos(theta) * Math.sin(phi),
            )
        },
        indexToColor: (i: number, light: {color: Color, intensity: number})=>{
            // todo handle envMapIntensity
            const r = DataUtils.fromHalfFloat(image.data[i * 4])
            const g = DataUtils.fromHalfFloat(image.data[i * 4 + 1])
            const b = DataUtils.fromHalfFloat(image.data[i * 4 + 2])
            const a = DataUtils.fromHalfFloat(image.data[i * 4 + 3])
            light.color.setRGB(Math.min(1, r * a), Math.min(1, g * a), Math.min(1, b * a))
            light.intensity = Math.min(a * Math.max(r, g, b), maxIntensityClamp)
        },
    }
}

_testStart()
init().finally(_testFinish)
