import {Box3B, BoxSelectionWidget, Class} from 'threepipe'
import type {ModellingEntry} from '@threepipe/plugin-modelling'

/**
 * The selection box around an object's evaluated result: its mesh and what its modifiers draw beside it (a
 * geometry-nodes modifier's instances, `ModellingEntry.evaluatedDrawing`), as Blender outlines the evaluated object.
 * Without it the box of an object whose modifier makes instances only bounds the input mesh (for Buildify, the flat
 * footprint under the building).
 */
export function evaluatedSelectionWidget(entries: () => readonly ModellingEntry[]): Class<BoxSelectionWidget> {
    return class EvaluatedSelectionWidget extends BoxSelectionWidget {
        protected _updater() {
            super._updater()
            const selected = this.object
            const drawing = selected ? entries().find(e => e.object === selected)?.evaluatedDrawing : undefined
            if (!selected || !drawing) return
            const box = new Box3B().expandByObject(selected, false).union(new Box3B().expandByObject(drawing, false))
            if (box.isEmpty()) return
            box.getCenter(this.position)
            box.getSize(this.scale).multiplyScalar(this.boundingScaleMultiplier).clampScalar(0.01, 1e8)
        }
    }
}
