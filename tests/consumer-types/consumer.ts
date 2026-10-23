// A consumer project that installs the packed threepipe and @threepipe/plugin-tweakpane tarballs.
// Type-checked by scripts/check-consumer-types.mjs (`npm run test:types`) under several TypeScript
// versions and tsconfig setups. Add a line here when a declaration fix needs a guard.
import {BoxGeometry, IScene, ISceneEventMap, lerp, LoadingScreenPlugin, Mesh, PhysicalMaterial, RootScene, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {Mesh as ThreeMesh} from 'three'

const viewer = new ThreeViewer({canvas: document.createElement('canvas'), plugins: [LoadingScreenPlugin]})
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(LoadingScreenPlugin)

viewer.scene.addObject(new Mesh(new BoxGeometry(1, 1, 1), new PhysicalMaterial({color: 0xff0000})))
viewer.scene.addObject(new ThreeMesh()) // the consumer's 'three' types are the ones threepipe uses

const scene: IScene = viewer.scene
scene.addEventListener('sceneUpdate', (e) => console.log(e.type))

// RootScene with a custom event map (https://github.com/repalash/threepipe/pull/57)
interface MyEvents extends ISceneEventMap {myEvent: {value: number}}
declare const myScene: RootScene<MyEvents>
myScene.addEventListener('myEvent', (e) => console.log(e.value.toFixed()))
export const asInterface: IScene<MyEvents> = myScene

export const t: number = lerp(0, 1, 0.5)

// A declaration import that does not resolve turns the imported names into `any`, and
// skipLibCheck hides the error. These lines fail when that happens.
// @ts-expect-error unknown member
viewer.thisMemberDoesNotExist()
// @ts-expect-error lerp takes numbers
lerp('a', 1, 0.5)
