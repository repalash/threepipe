import {
    _testFinish,
    _testStart,
    AlwaysStencilFunc,
    BufferGeometry2,
    DecrementStencilOp,
    EqualStencilFunc,
    IObject3D,
    LoadingScreenPlugin,
    Mesh2,
    PickingPlugin,
    ReplaceStencilOp,
    shaderReplaceString,
    ThreeViewer,
    TransformControlsPlugin,
    UnlitMaterial,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Custom outline for picking plugin by duplicating the model and using stencil buffer
async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, new TransformControlsPlugin(false)],
        stencil: true,
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPlugins(TransformControlsPlugin, PickingPlugin)

    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
            setBackground: false,
        }),
        viewer.load<IObject3D>('https://samples.threepipe.org/demos/kira.glb', {
            autoCenter: true,
            autoScale: true,
            autoScaleRadius: 6,
        }),
    ])

    const selectionMaterial = new UnlitMaterial({
        color: 0xe98a65,
        stencilRef: 1,
        depthWrite: false,
        stencilWrite: true,
        depthTest: true,
        stencilFunc: AlwaysStencilFunc,
        stencilZPass: ReplaceStencilOp,
        colorWrite: true,
    })
    selectionMaterial.registerMaterialExtensions([{
        shaderExtender:(shader, _material, _renderer) => {
            shader.vertexShader = shaderReplaceString(
                shader.vertexShader,
                '#include <begin_vertex>',
                '\ntransformed += normal * 0.02;',
                {append: true}
            )
        },
        isCompatible: ()=>true,
        computeCacheKey: ()=> 'selectionMaterial',
    }])
    const selectionMesh = new Mesh2(new BufferGeometry2(), selectionMaterial)
    const selectedObjectUpdateListener = (ev: {object: IObject3D})=>{
        if (ev.object !== selected) return
        selected.updateMatrixWorld()
        selected.matrixWorld.decompose(
            selectionMesh.position,
            selectionMesh.quaternion,
            selectionMesh.scale,
        )
        selectionMesh.updateMatrixWorld()
        // const selectionScale = 1.1
        // const center = new Box3B().expandByObject(selectionMesh).getCenter(new Vector3()).sub(selectionMesh.position)
        // const m = new Matrix4().makeTranslation(new Vector3().copy(center).negate())
        //     .multiply(new Matrix4().makeScale(selectionScale, selectionScale, selectionScale))
        //     .multiply(new Matrix4().makeTranslation(new Vector3().copy(center).multiplyScalar(1 / selectionScale)))
        // selectionMesh.matrix.premultiply(m).decompose(selectionMesh.position, selectionMesh.quaternion, selectionMesh.scale)
    }
    let selected = undefined as IObject3D | undefined
    let lastState = null as any
    viewer.getPlugin(PickingPlugin)!.addEventListener('selectedObjectChanged', ()=>{
        const model = viewer.getPlugin(PickingPlugin)?.getSelectedObject<IObject3D>()
        const geometry = model?.geometry
        if (selected === model) return
        if (selected) {
            // remove selection mesh from previous selected object
            selected.removeEventListener('objectUpdate', selectedObjectUpdateListener)
            const lastMaterial = selected.materials?.[0]
            if (lastMaterial && lastState) {
                lastMaterial.stencilWrite = lastState.stencilWrite
                lastMaterial.stencilRef = lastState.stencilRef
                lastMaterial.stencilFunc = lastState.stencilFunc
                lastMaterial.stencilZPass = lastState.stencilZPass
                lastMaterial.needsUpdate = true
                selected.renderOrder = lastState.renderOrder
            }
            lastState = null
        }
        const material = model?.materials?.[0]
        if (!model?.isObject3D || !geometry || !material) { // it can also be a selected material
            selectionMesh.geometry = undefined as any
            selectionMesh.removeFromParent()
            return
        }
        if (!geometry) return

        // Set selected object's material to use stencil buffer
        lastState = {
            stencilWrite: material.stencilWrite,
            stencilRef: material.stencilRef,
            stencilFunc: material.stencilFunc,
            stencilZPass: material.stencilZPass,
            renderOrder: model.renderOrder,
        }
        material.stencilWrite = true
        material.stencilRef = 1
        material.stencilFunc = EqualStencilFunc
        material.stencilZPass = DecrementStencilOp
        material.needsUpdate = true
        model.renderOrder = 2

        // Set selection mesh to match selected object
        selected = model
        selectionMesh.geometry = geometry
        // add listeners to update selection mesh position when its moved
        selected.addEventListener('objectUpdate', selectedObjectUpdateListener)
        selectedObjectUpdateListener({object: selected})

        if (!selectionMesh.parent) viewer.scene.addObject(selectionMesh, {addToRoot: true}) // add to root so it is not saved
    })
    viewer.getPlugin(PickingPlugin)!.widgetEnabled = false

    const chair = viewer.scene.getObjectByName('Node-Mesh003_1')
    viewer.getPlugin(PickingPlugin)!.setSelectedObject(chair, true)
}

_testStart()
init().finally(_testFinish)
