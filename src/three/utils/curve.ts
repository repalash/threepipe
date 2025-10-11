import {CurvePath, Vector3} from 'three'
import {Serialization} from 'ts-browser-helpers'

export class CurvePath3 extends CurvePath<Vector3> {
    override readonly type: string | 'CurvePath3'
    constructor() {
        super()
        this.type = 'CurvePath3'
    }
    static {
        Serialization.SerializableClasses.set('CurvePath3', CurvePath3)
    }
}
