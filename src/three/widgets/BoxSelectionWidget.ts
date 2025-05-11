import {LineMaterial2} from '../../core/material/LineMaterial2'
import {Vector2} from 'three'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {Box3B} from '../math/Box3B'
import {SelectionWidget} from './SelectionWidget'

export class BoxSelectionWidget extends SelectionWidget {
    constructor() {
        super()
        const matLine = new LineMaterial2({
            color: '#ff2222' as any, transparent: true, opacity: 0.9,
            linewidth: 5, // in pixels
            resolution: new Vector2(1024, 1024), // to be set by renderer, eventually
            worldUnits: false,
            dashed: false,
            toneMapped: false,
        })
        matLine.userData.renderToGBuffer = false
        matLine.userData.renderToDepth = false
        this.lineMaterial = matLine

        const ls = new LineSegmentsGeometry()
        ls.setPositions([1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1].map(v => v - 0.5))

        const wireframe = new LineSegments2(ls, matLine as any)
        wireframe.computeLineDistances()
        wireframe.scale.set(1, 1, 1)
        wireframe.visible = true
        this.add(wireframe)
    }

    protected _updater() {
        super._updater()
        const selected = this.object
        if (selected) {
            const bbox = new Box3B().expandByObject(selected, false)
            // const scale = bbox.getBoundingSphere(new Sphere()).radius
            bbox.getSize(this.scale).multiplyScalar(this.boundingScaleMultiplier).clampScalar(0.1, 1e8)
            this.setVisible(true)
        }
    }
}
