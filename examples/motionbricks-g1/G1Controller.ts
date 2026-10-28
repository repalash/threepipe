// Point-to-point locomotion for the G1 on top of MotionBricksG1.
// It plays generated motion at 30 Hz and generates the next segment ahead of time, from frames
// that are already planned, so the new motion takes over without a jump.
// The targets follow the reference Scene Preview: a gait target placed one second of travel ahead
// while far from the goal, then a standing target at the goal so the robot stops there.

import {G1Pose, heading, lerpPose, MotionGenerator, placePoses, SAMPLE_RATE, withSpeed} from './MotionBricksG1'

export interface G1Bricks {
    /** Standing pose, one frame, at the ground origin facing +X. */
    rest: number[][]
    /** Four consecutive frames of each gait, starting at the ground origin, travelling along +X. */
    walk: number[][]
    run: number[][]
}

export type G1Gait = 'walk' | 'run'

// Target speeds in m/s, those of the clips the bricks were seeded with.
export const GAIT_SPEEDS: Record<G1Gait, number> = {walk: 1.13, run: 3.43}

interface Segment {
    poses: G1Pose[]
    /** The three frames played before poses[0], for the context of an early regeneration. */
    prefix: G1Pose[]
    /** Frames before the end where the next segment takes over. */
    transitionEarly: number
    stopping: boolean
}

interface Request {
    id: number
    /** Frame of the current segment where the new motion starts. -1 when starting from rest. */
    startFrame: number
    stopping: boolean
}

export interface G1ControllerStats {
    generations: number
    lastInferenceMs: number
    averageInferenceMs: number
    lastTokenCount: number
}

export class G1Controller {
    readonly engine: MotionGenerator
    readonly bricks: G1Bricks
    /** The pose to show this frame, in G1 space. */
    readonly pose: G1Pose
    goal: [number, number] | null = null
    gait: G1Gait = 'walk'
    /** Seconds of travel between the robot and its gait target. */
    lead = 1.0
    stats: G1ControllerStats = {generations: 0, lastInferenceMs: 0, averageInferenceMs: 0, lastTokenCount: 0}
    onGenerated?: (motion: G1Pose[], targets: G1Pose[]) => void
    onError?: (e: unknown) => void

    private _segment: Segment | null = null
    private _frame = 0
    private _request: Request | null = null
    private _requestId = 0
    private _dirty = false
    private _pending: {request: Request, poses: G1Pose[]} | null = null

    constructor(engine: MotionGenerator, bricks: G1Bricks, x = 0, y = 0, angle = 0) {
        this.engine = engine
        this.bricks = bricks
        this.pose = placePoses(bricks.rest, x, y, angle)[0]
    }

    get moving() {
        return this._segment !== null
    }

    get generating() {
        return this._request !== null
    }

    /** The segment being played: its length and transition point in frames, and the playhead. */
    get playback() {
        const seg = this._segment
        if (!seg) return null
        const frames = seg.poses.length
        return {frames, frame: Math.min(this._frame, frames - 1), transition: frames - 1 - seg.transitionEarly, stopping: seg.stopping}
    }

    /** Walk or run to a ground point in G1 space, then stop there. */
    moveTo(x: number, y: number, gait: G1Gait = this.gait) {
        this.goal = [x, y]
        this.gait = gait
        if (this._request) this._dirty = true
        else this._generate(true)
    }

    /** Come to a stop a short way ahead. */
    stop() {
        if (!this._segment) return
        const a = heading([this.pose[3], this.pose[4], this.pose[5], this.pose[6]])
        const ahead = 0.5 * GAIT_SPEEDS[this.gait]
        this.goal = [this.pose[0] + Math.cos(a) * ahead, this.pose[1] + Math.sin(a) * ahead]
        if (this._request) this._dirty = true
        else this._generate(true)
    }

    /** Advance playback by dt seconds and update pose. */
    update(dt: number) {
        const seg = this._segment
        if (seg) {
            this._frame += dt * SAMPLE_RATE
            if (this._pending && this._frame >= this._pending.request.startFrame) this._switch()
        } else if (this._pending) this._switch()
        const current = this._segment
        if (!current) return
        const last = current.poses.length - 1
        const f = Math.min(this._frame, last)
        const i = Math.floor(f)
        lerpPose(current.poses[i], current.poses[Math.min(i + 1, last)], f - i, this.pose)
        if (current.stopping && this._frame >= last && !this._pending && !this._request) {
            this._segment = null
            if (this.goal && this._distanceToGoal() < 0.35) this.goal = null
            else if (this.goal) this._generate(true)
            return
        }
        if (!this._request && !this._pending && !current.stopping) {
            const transition = last - current.transitionEarly
            if (this._frame + this._latencyFrames() >= transition) this._generate(false)
        }
    }

    private _latencyFrames() {
        return Math.ceil((this.stats.averageInferenceMs || 400) / 1000 * SAMPLE_RATE) + 2
    }

    private _distanceToGoal() {
        return this.goal ? Math.hypot(this.goal[0] - this.pose[0], this.goal[1] - this.pose[1]) : 0
    }

    /** The frame of the current segment where new motion can start, and the four context poses ending there. */
    private _contextAt(now: boolean): {startFrame: number, context: G1Pose[]} {
        const seg = this._segment
        if (!seg) {
            const p = Float32Array.from(this.pose)
            return {startFrame: -1, context: [p, p, p, p]}
        }
        const last = seg.poses.length - 1
        const soonest = Math.ceil(this._frame) + this._latencyFrames()
        const startFrame = Math.min(last, now ? soonest : Math.max(soonest, last - seg.transitionEarly))
        const frames = [...seg.prefix, ...seg.poses]
        const end = startFrame + seg.prefix.length
        return {startFrame, context: frames.slice(end - 3, end + 1)}
    }

    private _generate(now: boolean) {
        const {startFrame, context} = this._contextAt(now)
        const from = context[3]
        const goal = this.goal ?? [from[0], from[1]]
        const dx = goal[0] - from[0], dy = goal[1] - from[1]
        const distance = Math.hypot(dx, dy)
        const speed = GAIT_SPEEDS[this.gait]
        const angle = distance > 0.3 ? Math.atan2(dy, dx) : heading([from[3], from[4], from[5], from[6]])
        let targets: G1Pose[]
        let stopping: boolean
        if (distance > speed * this.lead + 0.8) {
            const ahead = speed * this.lead
            targets = placePoses(withSpeed(this.bricks[this.gait], speed), from[0] + Math.cos(angle) * ahead, from[1] + Math.sin(angle) * ahead, angle)
            stopping = false
        } else {
            if (!this._segment && distance < 0.35) {
                this.goal = null
                return
            }
            targets = placePoses(this.bricks.rest, goal[0], goal[1], angle)
            stopping = true
        }
        const request: Request = {id: ++this._requestId, startFrame, stopping}
        this._request = request
        this._dirty = false
        this.engine.generate(context, targets).then(motion => {
            const s = this.stats
            s.generations++
            s.lastInferenceMs = motion.inferenceMs
            s.lastTokenCount = motion.tokenCount
            // Ignore the first runs, which include shader and kernel warm-up.
            s.averageInferenceMs = s.generations <= 1 ? motion.inferenceMs : s.averageInferenceMs * 0.7 + motion.inferenceMs * 0.3
            this._request = null
            if (this._dirty) {
                this._generate(true)
                return
            }
            this._pending = {request, poses: motion.poses}
            this.onGenerated?.(motion.poses, targets)
        }).catch(e => {
            this._request = null
            this.onError?.(e)
        })
    }

    private _switch() {
        const {request, poses} = this._pending!
        this._pending = null
        const seg = this._segment
        let prefix: G1Pose[]
        if (seg && request.startFrame >= 0) {
            const frames = [...seg.prefix, ...seg.poses]
            const end = request.startFrame + seg.prefix.length
            prefix = frames.slice(end - 3, end)
            this._frame = Math.max(0, this._frame - request.startFrame)
        } else {
            const p = Float32Array.from(poses[0])
            prefix = [p, p, p]
            this._frame = 0
        }
        this._segment = {
            poses,
            prefix,
            transitionEarly: request.stopping ? 0 : 10,
            stopping: request.stopping,
        }
    }
}
