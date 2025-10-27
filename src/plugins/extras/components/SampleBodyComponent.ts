import {Object3DComponent} from './Object3DComponent'
import {Vector3} from 'three'
import {IAnimationLoopEvent} from '../../../core'
import {uiButton} from 'uiconfig.js'
import {timeout} from 'ts-browser-helpers'

/**
 * Sample component that simulates a basic rigid body with forces, impulses, and velocity
 */
export class SampleBodyComponent extends Object3DComponent {
    static StateProperties = ['running', 'mass', 'damping']
    static ComponentType = 'SampleBodyComponent'

    running = true
    mass = 1
    damping = 0.98 // small damping to prevent infinite motion

    velocity = new Vector3()
    acceleration = new Vector3()

    update({deltaTime}: IAnimationLoopEvent) {
        if (!this.object || !this.running) return

        const dt = (deltaTime ?? 16) / 1000 // ~60fps fallback

        // Integrate acceleration -> velocity (acceleration is sum of forces / mass for this frame)
        this.velocity.x += this.acceleration.x * dt
        this.velocity.y += this.acceleration.y * dt
        this.velocity.z += this.acceleration.z * dt

        // Apply damping
        this.velocity.multiplyScalar(this.damping)

        // Reset acceleration so forces must be re-applied next frame
        this.acceleration.set(0, 0, 0)

        // Check if velocity is effectively non-zero using sum of absolute values
        const speedSum = Math.abs(this.velocity.x) + Math.abs(this.velocity.y) + Math.abs(this.velocity.z)
        if (speedSum <= 1e-6) return false

        // Integrate velocity -> position
        this.object.position.x += this.velocity.x * dt
        this.object.position.y += this.velocity.y * dt
        this.object.position.z += this.velocity.z * dt
        return true
    }

    addForce(force: {x?: number; y?: number; z?: number}) {
        // F = m * a => a = F / m
        if (force.x !== undefined) this.acceleration.x += force.x / this.mass
        if (force.y !== undefined) this.acceleration.y += force.y / this.mass
        if (force.z !== undefined) this.acceleration.z += force.z / this.mass
    }

    applyImpulse(impulse: {x?: number, y?: number, z?: number}) {
        // Impulse = Δv * m → Δv = Impulse / m
        if (impulse.x !== undefined) this.velocity.x += impulse.x / this.mass
        if (impulse.y !== undefined) this.velocity.y += impulse.y / this.mass
        if (impulse.z !== undefined) this.velocity.z += impulse.z / this.mass
    }

    setVelocity(velocity: {x: number; y: number; z: number}) {
        this.velocity.copy(velocity)
    }

    stop() {
        this.reset()
    }

    start() {
        this.reset()
    }

    reset() {
        this.velocity.set(0, 0, 0)
        this.acceleration.set(0, 0, 0)
    }

    // Sample functions

    @uiButton()
        MoveLeft = () => {
            this.applyImpulse({x: -5})
        }
    @uiButton()
        MoveRight = () => {
            this.applyImpulse({x: 5})
        }

    @uiButton()
        PushForward = async() => {
            for (let i = 0; i < 200; i++) {
                this.addForce({z: 10})
                await timeout(32)
            }
        }

    @uiButton()
        PushBackward = async() => {
            for (let i = 0; i < 200; i++) {
                this.addForce({z: -10})
                await timeout(32)
            }
        }
}
