import {Object3D, PerspectiveCamera, Scene, Vector3} from 'three'
import {Box3B} from '../math/Box3B'
import {IWebGLRenderer} from '../../core'

/**
 * Returns a snapshot of the object.
 * Does a simple render, does not run the full pipeline.
 *
 * Ideally, call this from preRender and object must be in root, for usage see {@link MaterialPreviewGenerator}.
 * @param renderer
 * @param object
 * @param root
 * @param channel
 * @param camOffset
 * @param camera
 */
export function snapObject(
    renderer: IWebGLRenderer,
    object: Object3D,
    root?: Scene,
    channel = 7,
    camOffset = new Vector3(0, 0, 1.5),
    camera = new PerspectiveCamera(45, 1, 0.1, 1000)
): string {
    const oldVisible = object.visible
    object.visible = true

    const bbox = new Box3B().expandByObject(object, true, true)
    const center = bbox.getCenter(new Vector3())
    const bboxSize = bbox.getSize(new Vector3())
    camera.position.copy(center).add(camOffset.clone().multiplyScalar(Math.max(bboxSize.x, bboxSize.y, bboxSize.z)))
    camera.lookAt(center)

    if (object) {
        object.traverseVisible(obj => {
            obj.layers.enable(channel)
        })
        // console.log((object as any).material)
    }
    if (channel > 0)
        camera.layers.set(channel)
    else
        camera.layers.enableAll()

    // scene.environment = this.viewer.scene.getEnvironment() as any

    renderer.setRenderTarget(null)

    renderer.clear()
    if (typeof renderer.renderWithModes === 'function') {
        renderer.renderWithModes({
            backgroundRender: false,
            // mainRenderPass: false,
            // screenSpaceRendering: false,
            // shadowMapRender: false,
        }, ()=>{
            renderer.render(root ?? object, camera)
        })
    } else {
        renderer.render(root ?? object, camera)
    }

    // renderer.setRenderTarget(target)
    // this._renderer.render(root, camera)
    // todo use webp when possible.
    const snap = renderer.domElement.toDataURL('image/png')

    renderer.clear()

    object.visible = oldVisible
    object.traverseVisible(obj => {
        obj.layers.disable(channel)
    })
    camera.layers.enableAll()
    return snap
}
