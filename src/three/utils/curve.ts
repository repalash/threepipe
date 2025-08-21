import {CurvePath, Vector3} from 'three'

export class CurvePath3 extends CurvePath<Vector3> {
    override readonly type: string | 'CurvePath3'
    constructor() {
        super()
        this.type = 'CurvePath3'
    }
}
