import {_testFinish, _testStart, BoxGeometry, getUrlQueryParam, LoadingScreenPlugin, Mesh, PhysicalMaterial, ThreeViewer} from 'threepipe'
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'

/**
 * Report a Problem and Send Feedback in a plain threepipe viewer, with `@threepipe/plugin-cloud`.
 *
 * The buttons open the plugin's dialog: bug, question or idea, the text, an optional email, and what the report
 * carries (a screenshot, the page's redacted warnings and errors, the browser and graphics card, the app's own
 * context, the scene as .glb if asked). An uncaught error shows the plugin's own toast with Report.
 *
 * Reports go to a threepipe-cloud worker (services/cloud): run one locally with `npm run dev:cloud` (port 9389)
 * and open this page with `?cloud=http://localhost:9389`. Without `?cloud=` the dialog can only Download the
 * report. Turnstile uses Cloudflare's test site key, which always passes; the local worker uses the matching
 * test secret.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({
        endpoint: getUrlQueryParam('cloud') || undefined,
        surface: 'cloud-feedback-example',
        turnstileSiteKey: '1x00000000000000000000AA',
        versions: {app: '0.1.0'},
    }))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    viewer.scene.mainCamera.position.set(2.5, 2, 3)

    // The app's own state goes into every report, next to what the plugin collects.
    const cube = new Mesh(new BoxGeometry(1, 1, 1), new PhysicalMaterial({color: '#5577ff', roughness: 0.4}))
    cube.name = 'Cube'
    viewer.scene.addObject(cube)
    cloud.feedback.addContext('app', () => ({objects: viewer.scene.modelRoot.children.length, selected: cube.name}))

    document.getElementById('report-problem')!.onclick = () => cloud.feedback.open({type: 'bug'})
    document.getElementById('send-feedback')!.onclick = () => cloud.feedback.open({type: 'idea'})

    Object.assign(window as never, {viewer, cloud})
}

_testStart()
init().finally(_testFinish)
