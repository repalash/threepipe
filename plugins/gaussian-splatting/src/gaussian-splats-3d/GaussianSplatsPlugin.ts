// import {AViewerPluginSync, createStyles, IViewerEvent, ThreeViewer} from 'threepipe'
// import styles from './SamplePlugin.css'
// import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
//
// // import * as GaussianSplats3D from 'gle-gs3d'
//
// export class GaussianSplatsPlugin extends AViewerPluginSync {
//     public static readonly PluginType: string = 'GaussianSplatsPlugin'
//     enabled = true
//     dependencies = []
//     toJSON: any = null
//
//     constructor() {
//         super()
//     }
//
//     splats: any
//     private _ready = false
//     onAdded(viewer: ThreeViewer) {
//         super.onAdded(viewer)
//         createStyles(styles)
//         this.splats = new GaussianSplats3D.Viewer({
//             'selfDrivenMode': false,
//             'renderer': viewer.renderManager.webglRenderer,
//             'camera': viewer.scene.mainCamera,
//             'useBuiltInControls': false,
//             // 'ignoreDevicePixelRatio': false,
//             // 'gpuAcceleratedSort': true,
//             // 'halfPrecisionCovariancesOnGPU': true,
//             'sharedMemoryForWorkers': false,
//             // 'integerBasedSort': false,
//             // 'dynamicScene': false,
//             // 'webXRMode': GaussianSplats3D.WebXRMode.None,
//         })
//         this.splats.init()
//         // this.splats.loadFile('https://generic-cors-proxy.repalash.workers.dev/https://zappar-xr.github.io/three-gaussian-splat-example/bonsai.5148b146.splat').then(()=>{
//         this.splats.addSplatScene('https://generic-cors-proxy.repalash.workers.dev/https://projects.markkellogg.org/threejs/assets/data/garden/garden_high.ksplat').then(()=>{
//             this._ready = true
//         })
//     }
//
//     protected _viewerListeners = {
//         postFrame: (_: IViewerEvent) => {
//             if (!this._ready) return
//             console.log('postframe')
//             this.splats.update()
//             this.splats.render()
//         },
//     }
// }
