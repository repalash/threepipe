import {Bone, Color, ColorRepresentation, Matrix4, Object3D, Vector3} from 'three'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {onChange2} from 'ts-browser-helpers'
import {AHelperWidget} from './AHelperWidget'
import {IUiConfigContainer, uiColor, uiSlider, uiToggle} from 'uiconfig.js'
import {LineMaterial2} from '../../core'

export class BoneHelper extends AHelperWidget {
    lineSegments: LineSegments2
    declare object: (Bone & IUiConfigContainer) | undefined

    private _vector = new Vector3()
    private _boneMatrix = new Matrix4()
    private _matrixWorldInv = new Matrix4()

    @onChange2(BoneHelper.prototype.update)
        material: LineMaterial2

    @onChange2(BoneHelper.prototype.update)
    @uiSlider(undefined, [0.1, 20], 0.01)
        lineWidth = 5

    @onChange2(BoneHelper.prototype.update)
    @uiColor()
        color1: Color = new Color(0, 0, 1)

    @onChange2(BoneHelper.prototype.update)
    @uiColor()
        color2: Color = new Color(0, 1, 0)

    @uiToggle()
    @onChange2(BoneHelper.prototype.update)
        autoUpdate = true // todo this shoudn't be needed, always update on before render

    constructor(bone: Bone, color1?: ColorRepresentation, color2?: ColorRepresentation) {
        super(bone)

        if (color1) this.color1.set(color1)
        if (color2) this.color2.set(color2)

        // Create geometry and material
        const geometry = new LineSegmentsGeometry()

        this.material = new LineMaterial2({
            vertexColors: true,
            linewidth: this.lineWidth,
            worldUnits: false,
            dashed: false,
            alphaToCoverage: true,
            toneMapped: false,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
        this.material.userData.renderToGBuffer = false
        this.material.userData.renderToDepth = false

        this.lineSegments = new LineSegments2(geometry, this.material)
        this.lineSegments.frustumCulled = false
        this.add(this.lineSegments)

        this.matrix = bone.matrixWorld
        this.matrixAutoUpdate = false

        this.update()
    }

    updateMatrixWorld(force?: boolean) {
        if (this.object) this.autoUpdate && this.update(false)
        super.updateMatrixWorld(force)
    }

    update(setDirty = true) {
        if (!this.lineSegments || !this.object) return

        const bone = this.object as Bone

        // Update material properties
        this.material.linewidth = this.lineWidth

        const vertices: number[] = []
        const colors: number[] = []

        this._matrixWorldInv.copy(bone.matrixWorld).invert()

        // Only render line if bone has a parent bone
        if (bone.parent && (bone.parent as any).isBone) {
            // Parent position
            this._boneMatrix.multiplyMatrices(this._matrixWorldInv, bone.parent.matrixWorld)
            this._vector.setFromMatrixPosition(this._boneMatrix)
            vertices.push(this._vector.x, this._vector.y, this._vector.z)
            colors.push(this.color1.r, this.color1.g, this.color1.b)

            // Current bone position
            this._boneMatrix.multiplyMatrices(this._matrixWorldInv, bone.matrixWorld)
            this._vector.setFromMatrixPosition(this._boneMatrix)
            vertices.push(this._vector.x, this._vector.y, this._vector.z)
            colors.push(this.color2.r, this.color2.g, this.color2.b)
        }

        const geometry = this.lineSegments.geometry
        if (vertices.length > 0) {
            geometry.setPositions(vertices)
            geometry.setColors(colors)
        } else {
            // Clear geometry properly when no line to show
            geometry.setPositions([0, 0, 0, 0, 0, 0])
            geometry.setColors([0, 0, 0, 0, 0, 0])
        }

        super.update(setDirty)
    }

    dispose() {
        this.lineSegments.geometry.dispose()
        this.lineSegments.material.dispose()
        super.dispose()
    }

    static Check(object: Object3D): boolean {
        return (object as any).isBone
    }

    static Create(bone: Bone): BoneHelper {
        return new BoneHelper(bone)
    }
}
