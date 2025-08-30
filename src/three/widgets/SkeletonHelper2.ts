import {Bone, Color, ColorRepresentation, Matrix4, Object3D, Vector3} from 'three'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {onChange2} from 'ts-browser-helpers'
import {AHelperWidget} from './AHelperWidget'
import {IUiConfigContainer, uiColor, uiSlider, uiToggle} from 'uiconfig.js'
import {LineMaterial2} from '../../core'

export class SkeletonHelper2 extends AHelperWidget {
    lineSegments: LineSegments2
    bones: Bone[]
    declare object: (Object3D & IUiConfigContainer) | undefined

    private _vector = new Vector3()
    private _boneMatrix = new Matrix4()
    private _matrixWorldInv = new Matrix4()

    @onChange2(SkeletonHelper2.prototype.update)
        material: LineMaterial2

    @onChange2(SkeletonHelper2.prototype.update)
    @uiSlider(undefined, [0.1, 20], 0.01)
        lineWidth = 5

    @onChange2(SkeletonHelper2.prototype.update)
    @uiColor()
        color1: Color = new Color(0, 0, 1)

    @onChange2(SkeletonHelper2.prototype.update)
    @uiColor()
        color2: Color = new Color(0, 1, 0)

    @uiToggle()
    @onChange2(SkeletonHelper2.prototype.update)
        autoUpdate = true

    constructor(object: Object3D, color1?: ColorRepresentation, color2?: ColorRepresentation) {
        super(object)

        if (color1) this.color1.set(color1)
        if (color2) this.color2.set(color2)

        this.bones = getBoneList(object)

        // Create geometry and material
        const geometry = new LineSegmentsGeometry()

        this.material = new LineMaterial2({
            vertexColors: true,
            linewidth: this.lineWidth,
            // resolution: new Vector2(1024, 1024), // Required for Line2 rendering
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

        this.matrix = object.matrixWorld
        this.matrixAutoUpdate = false

        this.update()

    }

    updateMatrixWorld(force?: boolean) {
        if (this.object) this.autoUpdate && this.update(false)
        super.updateMatrixWorld(force)
    }

    update(setDirty = true) {
        if (!this.lineSegments || !this.object) return

        // Update material properties
        this.material.linewidth = this.lineWidth

        // Update colors in geometry
        const geometry = this.lineSegments.geometry

        const vertices: number[] = []
        const colors: number[] = []

        for (const bone of this.bones) {
            if (bone.parent && (bone.parent as Bone).isBone) {
                vertices.push(0, 0, 0)
                vertices.push(0, 0, 0)
                colors.push(this.color1.r, this.color1.g, this.color1.b)
                colors.push(this.color2.r, this.color2.g, this.color2.b)
            }
        }

        this._matrixWorldInv.copy(this.object.matrixWorld).invert()

        let j = 0
        for (const bone of this.bones) {
            if (bone.parent && (bone.parent as any).isBone) {
                // Update parent position
                this._boneMatrix.multiplyMatrices(this._matrixWorldInv, bone.parent.matrixWorld)
                this._vector.setFromMatrixPosition(this._boneMatrix)
                // position.setXYZ(j, this._vector.x, this._vector.y, this._vector.z)
                vertices[3 * j] = this._vector.x
                vertices[3 * j + 1] = this._vector.y
                vertices[3 * j + 2] = this._vector.z

                // Update bone position
                this._boneMatrix.multiplyMatrices(this._matrixWorldInv, bone.matrixWorld)
                this._vector.setFromMatrixPosition(this._boneMatrix)
                // position.setXYZ(j + 1, this._vector.x, this._vector.y, this._vector.z)
                vertices[3 * j + 3] = this._vector.x
                vertices[3 * j + 4] = this._vector.y
                vertices[3 * j + 5] = this._vector.z

                j += 2
            }
        }

        if (vertices.length > 0) {
            geometry.setPositions(vertices)
            geometry.setColors(colors)
        } else {
            // Fallback: create a simple test line if no bones found
            geometry.setPositions([0, 0, 0, 1, 0, 0])
            geometry.setColors([1, 0, 0, 0, 1, 0])
        }

        super.update(setDirty)
    }

    dispose() {
        this.lineSegments.geometry.dispose()
        this.lineSegments.material.dispose()
        super.dispose()
    }

    static Check(object: Object3D): boolean {
        let parentHas = false
        object.traverseAncestors(o=>{
            if ((o as any)._hasSkeletonHelper) {
                parentHas = true
            }
        })
        if (parentHas) return false
        return getBoneList(object).length > 0
    }

    static Create(object: Object3D): SkeletonHelper2 {
        const helper = new SkeletonHelper2(object)
        ;(object as any)._hasSkeletonHelper = true
        return helper
    }
}

/**
 * Recursively collect all bones from an object hierarchy
 */
function getBoneList(object: Object3D): Bone[] {
    const boneList: Bone[] = []

    if ((object as any).isBone === true) {
        boneList.push(object as Bone)
    }

    for (const child of object.children) {
        boneList.push(...getBoneList(child))
    }

    return boneList
}
