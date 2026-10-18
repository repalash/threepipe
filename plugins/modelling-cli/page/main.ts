/**
 * The page a headless modelling session runs in: a viewer, `ModellingPlugin`, and `AgentSocketPlugin`
 * connected to the relay named in the URL (`?agent=ws://…&agentToken=…`). The CLI and the MCP server
 * launch it in headless Chromium when they need pixels (`look`, `capture`) or when no editor is open.
 *
 * No network: the lighting is a hemisphere and a key light outside the model root (so neither is
 * exported), not an environment map. `?env=<url>` loads one when there is network.
 */

import {CameraViewPlugin, DirectionalLight2, HemisphereLight2, ThreeViewer} from 'threepipe'
import {AgentSocketPlugin, ModellingPlugin} from '@threepipe/plugin-modelling'

const params = new URLSearchParams(location.search)
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas') as HTMLCanvasElement,
    msaa: true,
    dropzone: false,
})
viewer.getOrAddPluginSync(CameraViewPlugin)
viewer.scene.setBackgroundColor('#2a2d33')
const sky = new HemisphereLight2(0xdde6f0, 0x3a3530, 1.6)
viewer.scene.addObject(sky, {addToRoot: true})
const key = new DirectionalLight2(0xffffff, 2.2)
key.position.set(3, 5, 4)
viewer.scene.addObject(key, {addToRoot: true})
const env = params.get('env')
if (env) void viewer.setEnvironmentMap(env)

const modelling = viewer.addPluginSync(new ModellingPlugin({documentId: params.get('documentId') ?? undefined}))
const socket = viewer.addPluginSync(AgentSocketPlugin)
Object.assign(window as never, {viewer, modelling, agentSocket: socket})
