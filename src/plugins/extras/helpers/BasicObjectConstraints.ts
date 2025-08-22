import {IObject3D, IObject3DEventMap} from '../../../core'
import {Euler, Matrix4, Quaternion, Vector3} from 'three'

export interface ConstraintPropsTypes {
    // https://docs.blender.org/manual/en/latest/animation/constraints/transform/index.html
    copy_position: {
        axis?: ('x' | 'y' | 'z')[],
        invert?: ('x' | 'y' | 'z')[],
        // offset: boolean,
        // targetSpace?: 'world' | 'local',
        // ownerSpace?: 'world' | 'local',
    },

    copy_rotation: {
        axis?: ('x' | 'y' | 'z')[],
        invert?: ('x' | 'y' | 'z')[],
        order?: 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX',
        // targetSpace?: 'world' | 'local',
        // ownerSpace?: 'world' | 'local',
    }

    copy_scale: {
        axis?: ('x' | 'y' | 'z')[],
        uniform?: boolean,
    }

    copy_transforms: {
        // No additional props, only influence which is now in ObjectConstraint
    }

    follow_path: {
        offset?: number, // 0-1 value representing position along the path
        followCurve?: boolean, // Whether to orient the object along the path direction
    }

    look_at: {
        // trackAxis?: 'x' | '-x' | 'y' | '-y' | 'z' | '-z', // Which axis points toward the target
        upAxis?: 'x' | '-x' | 'y' | '-y' | 'z' | '-z', // Which axis represents "up"
        // targetSpace?: 'world' | 'local',
        // ownerSpace?: 'world' | 'local',
    }

}
export type TConstraintPropsType = keyof ConstraintPropsTypes

export type ConstraintPropsType<T extends TConstraintPropsType = TConstraintPropsType> = ConstraintPropsTypes[T] & {
    [key: string]: any // Allow additional properties
}

export const basicObjectConstraints: Record<TConstraintPropsType, {
    defaultProps: ConstraintPropsType,
    update: (obj: IObject3D, target: IObject3D | undefined, props: ConstraintPropsType, influence: number) => {
        changed: boolean,
        end?: boolean,
        change?: string
    },
    setDirty?: (e: IObject3DEventMap['objectUpdate'], isTarget?: boolean) => boolean
}> = {
    copy_position: {
        defaultProps: {
            axis: ['x', 'y', 'z'],
            invert: [],
            // offset: false,
            // targetSpace: 'world',
            // ownerSpace: 'world',
        },
        update: (obj: IObject3D, target: IObject3D | undefined, props: ConstraintPropsTypes['copy_position'], influence: number) => {
            if (!target) return {changed: false}
            const {
                axis = ['x', 'y', 'z'],
                invert = [],
                // offset = false,
                // targetSpace = 'world',
                // ownerSpace = 'world',
            } = props
            const pos = target.getWorldPosition(new Vector3())
            let changed = false
            let isEnd = true
            axis.forEach((a) => {
                if (invert.includes(a)) {
                    pos[a] *= -1
                }
                const last = obj.position[a]
                obj.position[a] = pos[a] * influence + last * (1 - influence)
                changed = changed || Math.abs(obj.position[a] - last) > 0.00001
                isEnd = isEnd && Math.abs(obj.position[a] - last) < 0.00001
            })

            return {changed, end: isEnd, change: 'position'}
        },

        setDirty(e: IObject3DEventMap['objectUpdate'], _isTarget?: boolean) {
            const key = e.change || e.key
            return !key || key === 'position' || key === 'transform'
        },
    },
    copy_rotation: {
        defaultProps: {
            axis: ['x', 'y', 'z'],
            invert: [],
            order: undefined, // Use existing order if not specified
            // targetSpace: 'world',
            // ownerSpace: 'world',
        },
        update: (obj: IObject3D, target: IObject3D | undefined, props: ConstraintPropsTypes['copy_rotation'], influence: number) => {
            if (!target) return {changed: false}
            const {
                axis = ['x', 'y', 'z'],
                invert = [],
                // targetSpace = 'world',
                // ownerSpace = 'world',
            } = props

            let order = props.order

            // Store original rotation for blending
            const originalEuler = new Euler().copy(obj.rotation)
            if (!order) order = originalEuler.order // Use existing order if not specified
            originalEuler.order = order

            // Get target's world rotation as euler angles
            const targetQuaternion = new Quaternion()
            target.getWorldQuaternion(targetQuaternion)
            const targetEuler = new Euler().setFromQuaternion(targetQuaternion, order)

            let changed = false
            let isEnd = true

            // Apply rotation on specified axes with inversion and influence
            axis.forEach((a) => {
                let targetRotation = targetEuler[a]
                if (invert.includes(a)) {
                    targetRotation *= -1
                }

                const last = obj.rotation[a]
                const newRotation = targetRotation * influence + last * (1 - influence)
                originalEuler[a] = newRotation
                changed = changed || Math.abs(newRotation - last) > 0.00001
                isEnd = isEnd && Math.abs(newRotation - last) < 0.00001
            })

            obj.rotation.copy(originalEuler)

            return {changed, end: isEnd, change: 'rotation'}
        },

        setDirty(e: IObject3DEventMap['objectUpdate'], _isTarget?: boolean) {
            const key = e.change || e.key
            return !key || key === 'rotation' || key === 'quaternion' || key === 'transform'
        },

    },
    copy_scale: {
        defaultProps: {
            axis: ['x', 'y', 'z'],
        },
        update: (obj: IObject3D, target: IObject3D | undefined, props: ConstraintPropsTypes['copy_scale'], influence: number) => {
            if (!target) return {changed: false}
            const {
                axis = ['x', 'y', 'z'],
                uniform = false,
            } = props

            // Get target's world scale
            const targetScale = new Vector3()
            target.getWorldScale(targetScale)

            const last = obj.scale.clone()

            let uniformSum = 0
            // Apply scale on specified axes with influence
            axis.forEach((a) => {
                const newScale = targetScale[a] * influence + last[a] * (1 - influence)
                obj.scale[a] = newScale
                uniformSum = uniformSum + newScale
            })

            if (uniform) {
                const uniformScale = uniformSum / axis.length
                obj.scale.set(uniformScale, uniformScale, uniformScale)
            }

            const changed = !last.equals(obj.scale)
            const isEnd = last.distanceTo(obj.scale) < 0.00001

            return {changed, end: isEnd, change: 'scale'}
        },

        setDirty(e: IObject3DEventMap['objectUpdate'], _isTarget?: boolean) {
            const key = e.change || e.key
            return !key || key === 'scale' || key === 'transform'
        },
    },
    copy_transforms: {
        defaultProps: {
            // No additional props, only influence which is now in ObjectConstraint
        },
        update: (obj: IObject3D, target: IObject3D | undefined, _props: ConstraintPropsTypes['copy_transforms'], influence: number) => {
            if (!target) return {changed: false}

            // Get target's world matrix
            const targetMatrix = new Matrix4()
            target.updateMatrixWorld()
            targetMatrix.copy(target.matrixWorld)

            // Store original transform for blending
            const originalPos = new Vector3().copy(obj.position)
            const originalQuat = new Quaternion().copy(obj.quaternion)
            const originalScale = new Vector3().copy(obj.scale)

            // Decompose target matrix
            const targetPos = new Vector3()
            const targetQuat = new Quaternion()
            const targetScale = new Vector3()
            targetMatrix.decompose(targetPos, targetQuat, targetScale)

            // Blend transforms with influence
            obj.position.lerpVectors(originalPos, targetPos, influence)
            obj.quaternion.slerpQuaternions(originalQuat, targetQuat, influence)
            obj.scale.lerpVectors(originalScale, targetScale, influence)

            // Check if anything changed
            const changed = !originalPos.equals(obj.position) ||
                !originalQuat.equals(obj.quaternion) ||
                !originalScale.equals(obj.scale)
            const isEnd = originalPos.distanceTo(obj.position) < 0.00001 &&
                originalQuat.angleTo(obj.quaternion) < 0.00001 &&
                originalScale.distanceTo(obj.scale) < 0.00001

            return {changed, end: isEnd, change: 'transform'}
        },

        setDirty(e: IObject3DEventMap['objectUpdate'], _isTarget?: boolean) {
            const key = e.change || e.key
            return !key || key === 'position' || key === 'rotation' || key === 'quaternion' || key === 'scale' || key === 'transform'
        },
    },
    follow_path: {
        defaultProps: {
            offset: 0, // 0-1 value representing position along the path
            followCurve: false, // Whether to orient the object along the path direction
        },
        // target here has to be a Line or Line2 etc
        update: (obj: IObject3D, target: IObject3D | undefined, props: ConstraintPropsTypes['follow_path'], influence: number) => {
            if (!target) return {changed: false}
            const {
                offset = 0,
                followCurve = false,
            } = props

            // Check if target has geometry
            if (!target.geometry) {
                return {changed: false}
            }

            // todo use geometry.userData.generationParams.curve if available as it would be smooth

            // Support both regular Line objects and Line2/LineSegments2
            const geometry = target.geometry as any
            const positions = geometry.getPositions ? geometry.getPositions() : geometry.attributes?.position?.array

            const res = getPos(positions, offset)
            if (!res) return {changed: false}

            const {targetPos, direction} = res

            const worldTarget = target.localToWorld(targetPos.clone())
            const worldDirection = direction?.lengthSq() > 0 ? target.localToWorld(direction.clone().add(targetPos)).sub(worldTarget).normalize() : null

            const originalPos = new Vector3().copy(obj.position)
            const originalRotation = new Quaternion().copy(obj.quaternion)

            // todo set world position
            obj.position.copy(worldTarget)

            let rotationChanged = false

            // Handle curve following (orientation)
            if (followCurve) {
                // Calculate direction along the curve
                if (worldDirection) {

                    const lookAtPos = worldTarget.clone().add(worldDirection)

                    obj.lookAt(lookAtPos)

                    if (influence !== 1) {
                        const targetRotation = obj.quaternion.clone()
                        // obj.quaternion.copy(tempQuaternion)
                        obj.quaternion.slerpQuaternions(originalRotation, targetRotation, influence)
                    }

                    rotationChanged = !originalRotation.equals(obj.quaternion)
                }

            }

            // after followCurve because of lookAt
            if (influence !== 1)
                obj.position.lerpVectors(originalPos, worldTarget, influence)

            const positionChanged = !originalPos.equals(obj.position)
            const changed = positionChanged || rotationChanged
            const isEnd = originalPos.distanceTo(obj.position) < 0.00001 &&
                (!rotationChanged || originalRotation.angleTo(obj.quaternion) < 0.00001)

            return {
                changed,
                end: isEnd,
                change: rotationChanged ? 'transform' : 'position',
            }
        },

        setDirty(e: IObject3DEventMap['objectUpdate'], _isTarget?: boolean) {
            const key = e.change || e.key
            return !key || key === 'position' || key === 'transform' || key === 'geometry'
        },
    },
    // what?
    look_at: {
        defaultProps: {
            // trackAxis: 'z', // Which axis points toward the target
            upAxis: 'y', // Which axis represents "up"
            // targetSpace: 'world',
            // ownerSpace: 'world',
        },
        update: (obj: IObject3D, target: IObject3D | undefined, props: ConstraintPropsTypes['look_at'], influence: number) => {
            if (!target) return {changed: false}
            const {
                // trackAxis = 'z',
                upAxis = 'y',
                // targetSpace = 'world',
                // ownerSpace = 'world',
            } = props

            // Get target's world position
            const targetPos = target.getWorldPosition(new Vector3())

            // Calculate direction to target
            const dir = targetPos.clone().sub(obj.position).normalize()

            // Calculate up direction
            const up = new Vector3(0, 1, 0) // Default up is world up
            if (upAxis === 'x') up.set(1, 0, 0)
            else if (upAxis === '-x') up.set(-1, 0, 0)
            else if (upAxis === 'y') up.set(0, 1, 0)
            else if (upAxis === '-y') up.set(0, -1, 0)
            else if (upAxis === 'z') up.set(0, 0, 1)
            else if (upAxis === '-z') up.set(0, 0, -1)

            // Calculate right direction
            const right = new Vector3().crossVectors(up, dir).normalize()

            // Recalculate up direction as it may have changed
            up.crossVectors(dir, right).normalize()

            // Create a rotation matrix
            const m = new Matrix4()
            m.makeBasis(right, up, dir)

            // Extract the rotation from the matrix
            const q = new Quaternion().setFromRotationMatrix(m)

            // Apply the rotation to the object
            obj.quaternion.slerp(q, influence)

            const changed = !obj.quaternion.equals(q)
            const isEnd = obj.quaternion.angleTo(q) < 0.00001

            return {changed, end: isEnd, change: 'rotation'}
        },

        setDirty(e: IObject3DEventMap['objectUpdate'], _isTarget?: boolean) {
            const key = e.change || e.key
            return !key || key === 'position' || key === 'rotation' || key === 'quaternion' || key === 'scale' || key === 'transform'
        },
    },
}

function getPos(positions: number[], offset: number) {

    if (!positions) {
        return null
    }

    const vertexCount = positions.length / 3

    if (vertexCount < 2) return null

    // Calculate total path length and segment lengths
    const segmentLengths: number[] = []
    let totalLength = 0

    for (let i = 0; i < vertexCount - 1; i++) {
        const x1 = positions[i * 3]
        const y1 = positions[i * 3 + 1]
        const z1 = positions[i * 3 + 2]
        const x2 = positions[(i + 1) * 3]
        const y2 = positions[(i + 1) * 3 + 1]
        const z2 = positions[(i + 1) * 3 + 2]

        const segmentLength = Math.sqrt(
            (x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2
        )
        segmentLengths.push(segmentLength)
        totalLength += segmentLength
    }

    if (totalLength === 0) return null

    // Clamp offset to 0-1 range
    const clampedOffset = Math.max(0, Math.min(1, offset))
    const targetDistance = clampedOffset * totalLength

    // Find which segment contains the target distance
    let currentDistance = 0
    let segmentIndex = 0
    let segmentT = 0

    for (let i = 0; i < segmentLengths.length; i++) {
        if (currentDistance + segmentLengths[i] >= targetDistance) {
            segmentIndex = i
            segmentT = (targetDistance - currentDistance) / segmentLengths[i]
            break
        }
        currentDistance += segmentLengths[i]
    }

    // Interpolate position along the segment
    const i1 = segmentIndex * 3
    const i2 = (segmentIndex + 1) * 3

    const x1 = positions[i1]
    const y1 = positions[i1 + 1]
    const z1 = positions[i1 + 2]
    const x2 = positions[i2]
    const y2 = positions[i2 + 1]
    const z2 = positions[i2 + 2]

    // Linear interpolation
    const targetPos = new Vector3(
        x1 + (x2 - x1) * segmentT,
        y1 + (y2 - y1) * segmentT,
        z1 + (z2 - z1) * segmentT
    )
    const direction = new Vector3(x2 - x1, y2 - y1, z2 - z1)
    direction.normalize()
    return {targetPos, direction}
}
