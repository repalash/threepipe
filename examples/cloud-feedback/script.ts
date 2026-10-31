import {_testFinish, _testStart, BoxGeometry, getUrlQueryParam, LoadingScreenPlugin, Mesh, PhysicalMaterial, ThreeViewer} from 'threepipe'
import {ThreepipeCloudPlugin} from '@threepipe/plugin-cloud'

/**
 * Report a Problem, Send Feedback and Sign in with threepipe in a plain threepipe viewer, with `@threepipe/plugin-cloud`.
 *
 * The first two buttons open the plugin's dialog: bug, question, idea or other, the text, an optional email, and what the
 * report carries (a screenshot, the page's redacted warnings and errors, the browser and graphics card, the app's own
 * context, the scene as .glb if asked). An uncaught error shows the plugin's own toast with Report. Reports go to a
 * project on threepipe cloud: `?project=<slug>` (create one at <cloud>/reports). Without a project the dialog can only
 * Download the report.
 *
 * Sign in with threepipe sends you to threepipe cloud to approve this page once; back here, Save to my drive puts the
 * scene in your drive (in this app's own folder) and shows a link anyone can open. Signed in, reports need no check.
 *
 * Locally: `npm run dev:cloud` (services/cloud on port 8787), then open this page with
 * `?cloud=http://localhost:8787&project=<slug>`. Turnstile uses Cloudflare's test site key, which always passes; the
 * local worker uses the matching test secret.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const cloud = viewer.addPluginSync(new ThreepipeCloudPlugin({
        endpoint: getUrlQueryParam('cloud') || undefined,
        project: getUrlQueryParam('project') || undefined,
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

    const signIn = document.getElementById('sign-in')!
    const save = document.getElementById('save-scene')!
    const showUser = () => {
        signIn.textContent = cloud.auth.signedIn ? `Signed in as ${cloud.auth.user}` : 'Sign in with threepipe'
        save.hidden = !cloud.auth.signedIn
    }
    signIn.onclick = () => cloud.auth.signedIn ? (cloud.auth.signOut(), showUser()) : cloud.auth.signIn()
    save.onclick = async() => {
        const glb = await viewer.exportScene({exportExt: 'glb'})
        if (!glb) return
        const item = await cloud.drive.save('cube.glb', glb)
        const link = await cloud.drive.share(item.id)
        save.textContent = 'Saved'
        save.title = link
        console.log('shared at', link)
    }
    showUser()

    Object.assign(window as never, {viewer, cloud})
}

_testStart()
init().finally(_testFinish)
