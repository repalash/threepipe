import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PhysicalMaterial,
    shaderReplaceString,
    ThreeViewer,
    Vector2,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// todo make tutorial for this in docs?
async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    const testMat = await viewer.load<PhysicalMaterial>('https://packs.ijewel3d.com/files/metal_whitegold_brush_3_08d4d2ad61.pmat?tp')
    const model = result?.getObjectByName('node_damagedHelmet_-6514')

    if (!model || !testMat) {
        alert('Model or material not found')
        return
    }
    testMat.color.set(0x00ff00)

    const model2 = model.clone()
    model2.material = testMat
    model.parent!.add(model2)

    const clipVec = new Vector2(0.3, 0.5)

    ui.appendChild({
        type: 'slider',
        bounds: [0, 1],
        label: 'Clip UV X',
        property: [clipVec, 'x'],
        onChange: ()=>{
            model.materials![0].setDirty()
            testMat.setDirty()
        },
    })

    model.materials![0].registerMaterialExtensions([{
        extraUniforms: {
            clipVec: {value: clipVec},
        },
        parsFragmentSnippet: 'uniform vec2 clipVec;',
        shaderExtender: (shader)=>{
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'void main() {', `
            if(vUv.x > clipVec.x) discard;
            `, {append: true})
            shader.defines && (shader.defines.USE_UV = '')
        },
        isCompatible: (mat)=>(mat as any).isMeshStandardMaterial,
        computeCacheKey: ()=>clipVec.x + ' ' + clipVec.y,
    }])
    testMat.registerMaterialExtensions([{
        extraUniforms: {
            clipVec: {value: clipVec},
        },
        parsFragmentSnippet: 'uniform vec2 clipVec;',
        shaderExtender: (shader)=>{
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'void main() {', `
            if(vUv.x < clipVec.x) discard;
            `, {append: true})
            shader.defines && (shader.defines.USE_UV = '')
        },
        isCompatible: (mat)=>(mat as any).isMeshStandardMaterial,
        computeCacheKey: ()=>clipVec.x + ' ' + clipVec.y,
    }])

}

_testStart()
init().finally(_testFinish)
