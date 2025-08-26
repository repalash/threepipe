import {_testFinish, _testStart, CanvasSnapshotPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, CanvasSnapshotPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    // setup css alignment of canvas inside container
    viewer.container.style.position = 'relative'
    viewer.canvas.style.position = 'absolute'
    viewer.canvas.style.top = '50%'
    viewer.canvas.style.left = '50%'
    viewer.canvas.style.transform = 'translate(-50%, -50%)'

    const state = {
        width: 1280,
        height: 768,
        mode: 'contain' as 'contain' | 'cover' | 'fill' | 'scale-down' | 'none',
        dpr: 1,
        alignX: 0,
        alignY: 0,
    }

    viewer.setRenderSize({width: state.width, height: state.height}, state.mode, state.dpr)

    ui.appendChild({
        type: 'folder',
        label: 'Render Size',
        value: state,
        expanded: true,
        onChange: ()=>{
            viewer.setRenderSize({width: state.width, height: state.height}, state.mode, state.dpr)
            viewer.canvas.style.transform = `translate(${state.alignX * 100 - 50}%, ${state.alignY * 100 - 50}%)`
        },
        children: [{
            type: 'slider',
            label: 'Width',
            path: 'width',
            bounds: [10, 2048],
            stepSize: 10,
        }, {
            type: 'slider',
            label: 'Height',
            path: 'height',
            bounds: [10, 2048],
            stepSize: 10,
        }, {
            type: 'dropdown',
            label: 'Mode',
            children: ['contain', 'cover', 'fill', 'scale-down', 'none'].map((v) => ({label: v})),
            path: 'mode',
        }, {
            type: 'slider',
            label: 'DPR',
            path: 'dpr',
            bounds: [0.1, 4],
            stepSize: 0.1,
        }, {
            type: 'slider',
            label: 'AlignX',
            path: 'alignX',
            bounds: [-1, 1],
            stepSize: 0.01,
        }, {
            type: 'slider',
            label: 'AlignY',
            path: 'alignY',
            bounds: [-1, 1],
            stepSize: 0.01,
        }],
    })
    ui.setupPluginUi(CanvasSnapshotPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
