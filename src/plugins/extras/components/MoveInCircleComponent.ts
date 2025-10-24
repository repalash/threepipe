import {Object3DComponent} from './Object3DComponent.ts'
import {IAnimationLoopEvent} from '../../../core'

/**
 * Sample component that moves the object in a circle around the origin on the XZ Plane
 */
export class MoveInCircleComponent extends Object3DComponent {
    static StateProperties = ['running', 'radius', 'timeScale']

    running = true

    radius = 2

    timeScale = 0.01

    static ComponentType = 'MoveInCircleComponent'

    update({time}: IAnimationLoopEvent) {
        if (!this.running) return
        if (!this.object) return
        this.object.position.x = Math.cos(time * this.timeScale) * this.radius
        this.object.position.z = Math.sin(time * this.timeScale) * this.radius
        // this.object.setDirty({change: 'position'}) // todo because of this its not updating the ui since it always throttles, setting last: false should disable refreshUi
        return true // to set viewer dirty
    }

}
