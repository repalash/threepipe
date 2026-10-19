import {_testFinish, _testStart, IScene, ISceneEventMap, lerp, PerspectiveCamera2, RootScene, Scene, ThreeViewer} from 'threepipe'

interface ProgressEvents extends ISceneEventMap {
    progress: {value: number}
    sceneUpdate: ISceneEventMap['sceneUpdate'] & {label: string}
}

/** Register built-in callbacks while preserving the scene's custom event map. */
function registerRefresh<TE extends ISceneEventMap>(scene: RootScene<TE>) {
    scene.addEventListener('objectUpdate', scene.refreshScene)
    scene.addEventListener('geometryUpdate', scene.refreshScene)
    scene.addEventListener('geometryChanged', scene.refreshScene)
}

_testStart()

console.log(ThreeViewer)

const scene = new RootScene<ProgressEvents>(new PerspectiveCamera2())
const asInterface: IScene<ProgressEvents> = scene
const asBase: Scene<ProgressEvents> = scene
registerRefresh(scene)
scene.addEventListener('progress', event => {
    const type: 'progress' = event.type
    const target: RootScene<ProgressEvents> = event.target
    console.log(type, target === scene, event.value.toFixed(2))
    // @ts-expect-error Custom event values retain their numeric type.
    const invalidValue: string = event.value
    void invalidValue
})
scene.addEventListener('sceneUpdate', event => console.log(event.label.toUpperCase()))

const midpoint: number = lerp(0, 10, 0.5)
scene.dispatchEvent({type: 'progress', value: midpoint})
console.log(asInterface === scene, asBase === scene, midpoint.toFixed(2))

// build-examples checks dist declarations. These must still reject invalid types
// when skipLibCheck hides a broken declaration import that would make lerp any.
// @ts-expect-error lerp accepts numeric arguments only.
const invalidArguments: (x: string, y: number, t: number) => number = lerp
// @ts-expect-error lerp returns a number, not a string.
const invalidResult: (x: number, y: number, t: number) => string = lerp
void invalidArguments
void invalidResult

_testFinish()
