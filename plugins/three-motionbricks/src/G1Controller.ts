// Point-to-point locomotion for the G1 on top of MotionBricksG1.
// It plays generated motion at 30 Hz and generates the next segment ahead of time, from frames
// that are already planned, so the new motion takes over without a jump.
// The targets follow the reference Scene Preview: a gait target placed one second of travel ahead
// while far from the goal, then a standing target at the goal so the robot stops there. The gait
// target is the pose of the stride the robot will be at when it arrives, so the steps stay even.

import {G1Obstacle, placeSequence, probeHits, G1PrimitiveStep} from './G1Primitives'
import {BOUNDARY_FRAMES, DEFAULT_TOKEN_COUNTS, G1Pose, GenerateOptions, MotionGenerator, POSES_PER_TOKEN, SAMPLE_RATE} from './MotionBricksG1'
import {G1_RIG, PoseRig} from './PoseRig'

export interface G1Bricks {
    /** Standing pose, one frame, at the ground origin facing +X. */
    rest: number[][]
    /** Four consecutive frames of each gait, starting at the ground origin, travelling along +X. */
    walk: number[][]
    run: number[][]
    /**
     * One steady stride of each gait, footfall to the same foot's next footfall, starting at the ground origin and
     * travelling along +X, with the ground travel over the whole stride. With these, gait targets are taken from the
     * point of the stride the robot will reach when it gets there, so no step is squeezed or stretched to fit.
     */
    cycles?: Partial<Record<G1Gait, G1StrideCycle>>
    /** Walk and run speeds in m/s, when not GAIT_SPEEDS (another skeleton's clips). */
    speeds?: Record<G1Gait, number>
}

/** One stride of a gait: its frames from a footfall, and the ground travel over the whole stride. */
export interface G1StrideCycle {
    frames: number[][]
    travel: number[]
}

export type G1Gait = 'walk' | 'run'

// Frames over which a new segment fades in from the one it replaces.
const FADE_FRAMES = 8

// Target speeds in m/s, those of the clips the bricks were seeded with.
export const GAIT_SPEEDS: Record<G1Gait, number> = {walk: 1.13, run: 3.43}

interface Segment {
    poses: G1Pose[]
    /** The three frames played before poses[0], for the context of an early regeneration. */
    prefix: G1Pose[]
    /** Frames before the end where the next segment takes over. */
    transitionEarly: number
    stopping: boolean
    /** A Smart Primitive sequence being played (a jump): its placed steps, and the next one to generate. */
    sequence?: Sequence
}

interface Sequence {
    /** What the sequence is: a primitive's sequence name, or the name given to perform(). */
    name?: string
    steps: G1PrimitiveStep[]
    next: number
    /** Hold the last step's pose at the end (sitting down, standing up) instead of walking on. */
    hold?: boolean
    /** The obstacle being sat on, for a Sit sequence. */
    seat?: G1Obstacle
    /** The obstacle the sequence is played at. */
    obstacle?: G1Obstacle
}

interface Request {
    id: number
    /** The segment the motion continues, or null when starting from rest. */
    segment: Segment | null
    /** Frame of that segment where the new motion starts. -1 when starting from rest. */
    startFrame: number
    stopping: boolean
    gait: G1Gait
    sequence?: Sequence
    /** The step's own transition point, for a sequence step. */
    transitionEarly?: number
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
    /** Obstacles with a Smart Primitive (see G1Primitives), which the robot jumps or vaults on its way. */
    obstacles: G1Obstacle[] = []
    /** The obstacle the robot sits on, or null. */
    seat: G1Obstacle | null = null
    /** An action asked for (sit, stand up), to start at the next generation. */
    private _action: Sequence | null = null
    /**
     * Seconds of travel between the robot and its gait target. With stride cycles in the bricks, the target is
     * the pose the stride reaches by then and the segment length is fixed to match. Without them, the single gait
     * brick was baked with 1 s; other values make the model squeeze or stretch steps to fit.
     */
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
    /** Seconds to wait before generating on its own again, after a failed generation. */
    private _retryIn = 0
    /**
     * The segment being replaced, still playing while the new one fades in. Motion that arrives late starts
     * a few frames in, and the fade hides the difference from the frame shown.
     */
    private _fade: {segment: Segment, frame: number, t: number} | null = null
    private _segmentPose: Float32Array
    private _fadePose: Float32Array
    /** The skeleton's poses: G1_RIG, or SOMA_RIG for the SOMA model. */
    readonly rig: PoseRig

    constructor(engine: MotionGenerator, bricks: G1Bricks, x = 0, y = 0, angle = 0, rig: PoseRig = G1_RIG) {
        this.engine = engine
        this.bricks = bricks
        this.rig = rig
        this._segmentPose = new Float32Array(rig.poseSize)
        this._fadePose = new Float32Array(rig.poseSize)
        this.pose = rig.place(bricks.rest, x, y, angle)[0]
    }

    /** Walk or run speed in m/s. */
    speedOf(gait: G1Gait) {
        return (this.bricks.speeds ?? GAIT_SPEEDS)[gait]
    }

    get moving() {
        return this._segment !== null
    }

    get generating() {
        return this._request !== null
    }

    /**
     * The sequence being played (a jump, a vault, sitting down, or one given to perform), or null: its name, primitive,
     * the step whose motion is playing, and that step's index.
     */
    get action() {
        const seq = this._segment?.sequence
        return seq ? {name: seq.name ?? '', primitive: seq.obstacle?.primitive ?? null, step: seq.steps[seq.next - 1]?.name ?? '', index: seq.next - 1} : null
    }

    /** Whether a sequence is asked for, generating or playing, so that new goals wait for it. */
    get busy() {
        const seq = this._pending?.request.sequence ?? this._request?.sequence ?? this._segment?.sequence
        return !!this._action || !!seq && (seq.next < seq.steps.length || !!seq.hold && this._segment?.sequence === seq && this._frame < this._segment.poses.length - 1)
    }

    /**
     * Play target steps in controller space, one generation each: poses authored at the origin facing +X and placed
     * with rig.place, such as the human's kick or reach (SOMAActions). With `hold`, the motion ends on the last step
     * and stays there; otherwise the robot goes on to its goal, or stops, after it. The steps start from the next
     * generation, so the motion already planned plays into them.
     */
    perform(steps: G1PrimitiveStep[], {name = '', hold = true}: {name?: string, hold?: boolean} = {}) {
        this.goal = null
        this._action = {name, steps, next: 0, hold}
        const playing = this._segment?.sequence
        // A held sequence that has finished playing is done with; one still going plays on first.
        if (this._request || this._pending) this._dirty = true
        else if (!playing || playing.next >= playing.steps.length) this._generate(true)
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
        this._regenerate()
    }

    /**
     * Sit on a 'sit' obstacle: walk the last metre to it, turn and sit, then stay seated. Start within about two
     * metres of it. Moving again stands up first.
     */
    sit(o: G1Obstacle) {
        const sequence = o.primitive.sequences.find(q => q.name === 'Sit')
        if (!sequence || this.seat) return
        const [px, py] = this.rig.ground(this.pose)
        const angle = Math.atan2(o.y - py, o.x - px)
        const steps = placeSequence(o, sequence, px, py, angle, this.speedOf('walk'))
        this.goal = null
        this._action = {steps, next: 0, hold: true, seat: o, obstacle: o}
        if (!this._request && !this._pending) this._generate(true)
    }

    /** Stand up from the seat and stay there. */
    standUp() {
        const o = this.seat
        const sequence = o?.primitive.sequences.find(q => q.name === 'Stand')
        if (!o || !sequence) return
        this.goal = null
        const [px, py] = this.rig.ground(this.pose)
        this._action = {steps: placeSequence(o, sequence, px, py, 0, 0), next: 0, hold: true}
        if (!this._request && !this._pending) this._generate(true)
    }

    /** Come to a stop a short way ahead. */
    stop() {
        this.goal = null
        if (this._segment || this._request || this._pending) this._regenerate()
    }

    /**
     * Generate for the new goal now, or once the motion in flight is in place: a request's start frame
     * belongs to the segment it was made from, so none is made while another waits to take over.
     */
    private _regenerate() {
        // A jump plays to its end; the new goal applies after it.
        const seq = this._pending?.request.sequence ?? this._request?.sequence ?? this._segment?.sequence
        if (seq && seq.next < seq.steps.length || this._action) return
        if (this._request || this._pending) this._dirty = true
        else this._generate(true)
    }

    /** Advance playback by dt seconds and update pose. */
    update(dt: number) {
        this._retryIn = Math.max(0, this._retryIn - dt)
        const seg = this._segment
        if (this._fade) {
            this._fade.frame += dt * SAMPLE_RATE
            this._fade.t += dt * SAMPLE_RATE
        }
        if (seg) {
            // Hold at the last frame while the next motion is late, so it starts from the pose shown.
            this._frame = Math.min(this._frame + dt * SAMPLE_RATE, seg.poses.length - 1)
            if (this._pending && this._frame >= this._pending.request.startFrame) this._switch()
        } else if (this._pending) this._switch()
        if (this._dirty && !this._request && !this._pending) this._generate(true)
        const current = this._segment
        if (!current) return
        const last = current.poses.length - 1
        samplePoses(this.rig, current.poses, this._frame, this._segmentPose)
        const fade = this._fade
        if (fade) {
            const w = Math.min(fade.t / FADE_FRAMES, 1)
            samplePoses(this.rig, fade.segment.poses, fade.frame, this._fadePose)
            this.rig.lerp(this._fadePose, this._segmentPose, w * w * (3 - 2 * w), this.pose)
            if (w >= 1) this._fade = null
        } else this.pose.set(this._segmentPose)
        if (current.stopping && this._frame >= last && !this._pending && !this._request) {
            this._segment = null
            this._fade = null
            if (this.goal && this._distanceToGoal() < 0.35) this.goal = null
            else if (this.goal) this._generate(true)
            return
        }
        if (!this._request && !this._pending && !current.stopping && this._retryIn <= 0) {
            const transition = last - current.transitionEarly
            // Ask early, with room for a slow inference; the new motion still starts at the transition point.
            if (this._frame + this._latencyFrames() * 1.5 >= transition) this._generate(false)
        }
    }

    private _latencyFrames() {
        const s = this.stats
        return Math.ceil(Math.max(s.averageInferenceMs || 400, s.lastInferenceMs) / 1000 * SAMPLE_RATE) + 2
    }

    /**
     * Frames before a gait segment's end where the next one takes over. With stride cycles, a run hands over 6
     * frames early and a walk 2, so the hand-overs fall on alternate feet rather than always on the same step.
     * Without them, a run keeps its cadence with 10. Slow inference gets 2: more time to generate.
     */
    private _transitionEarly(gait: G1Gait) {
        if (gait !== 'run' || Math.max(this.stats.averageInferenceMs, this.stats.lastInferenceMs) >= 600) return 2
        return this.bricks.cycles?.run ? 6 : 10
    }

    /**
     * A jump to start now: the nearest obstacle the probe meets whose first target is no more than `lead` seconds of
     * travel ahead, with its steps placed for this approach. When the robot is already past the first target, it
     * starts at the next one still ahead.
     */
    private _findJump(from: G1Pose, angle: number, speed: number, distance: number): Sequence | undefined {
        let best: Sequence | undefined, bestAhead = Infinity
        const cos = Math.cos(angle), sin = Math.sin(angle)
        const [fx, fy] = this.rig.ground(from)
        const ahead = (p: G1Pose) => {
            const [x, y] = this.rig.ground(p)
            return (x - fx) * cos + (y - fy) * sin
        }
        for (const o of this.obstacles) {
            if (o.primitive.kind !== 'pass' || !probeHits(o, fx, fy, angle, speed, speed * this.lead + 3)) continue
            const sequence = o.primitive.sequences.reduce((a, b) => Math.abs(b.startSpeed - speed) < Math.abs(a.startSpeed - speed) ? b : a)
            const steps = placeSequence(o, sequence, fx, fy, angle, speed)
            const entry = ahead(steps[0].window[0])
            if (entry > speed * this.lead + 0.3 || entry >= bestAhead) continue
            const first = steps.findIndex(s => ahead(s.window[0]) > 0.3)
            // Skip it when the goal comes before the landing.
            if (first < 0 || ahead(steps[steps.length - 1].window[0]) > distance + 0.5) continue
            best = {steps, next: first, obstacle: o}
            bestAhead = entry
        }
        return best
    }

    private _distanceToGoal() {
        if (!this.goal) return 0
        const [x, y] = this.rig.ground(this.pose)
        return Math.hypot(this.goal[0] - x, this.goal[1] - y)
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
        const speed = this.speedOf(this.gait)
        const [fx, fy] = this.rig.ground(from)
        const facing = this.rig.heading(from)
        // With no goal, stop a short way ahead of where the new motion starts.
        const stopAhead = this._segment ? 0.5 * speed : 0
        const goal = this.goal ?? [fx + Math.cos(facing) * stopAhead, fy + Math.sin(facing) * stopAhead]
        const dx = goal[0] - fx, dy = goal[1] - fy
        const distance = Math.hypot(dx, dy)
        const angle = distance > 0.3 ? Math.atan2(dy, dx) : facing
        let targets: G1Pose[]
        let stopping: boolean
        let options: GenerateOptions | undefined
        let sequence: Sequence | undefined
        const lead = this.lead
        const cycle = this.bricks.cycles?.[this.gait]
        const playing = this._segment?.sequence
        let jump = playing && playing.next < playing.steps.length ? playing : undefined
        if (!jump && this._action) {
            jump = this._action
            this._action = null
        }
        // Seated with somewhere to go: stand up first, then go on.
        if (!jump && this.seat && this.goal) {
            const stand = this.seat.primitive.sequences.find(q => q.name === 'Stand')
            if (stand) jump = {steps: placeSequence(this.seat, stand, fx, fy, 0, 0), next: 0}
        }
        if (!jump && this._segment && !this._segment.stopping && distance > 1) jump = this._findJump(from, angle, speed, distance)
        if (jump) {
            const step = jump.steps[jump.next]
            targets = step.window
            options = {tokens: step.tokens}
            sequence = {...jump, next: jump.next + 1}
            // The last step of a held sequence ends the motion there, like a stop.
            stopping = !!jump.hold && jump.next === jump.steps.length - 1
        } else if (distance > speed * lead + 0.8 && cycle && this._segment && !this._segment.stopping) {
            // A fixed length, the travel for it at gait speed, and the pose of the stride the robot reaches by then.
            // About `lead` seconds, or longer when generating is slow, so the next one is ready before this one ends.
            const room = this._latencyFrames() + this._transitionEarly(this.gait) + 2
            const tokens = Math.min(DEFAULT_TOKEN_COUNTS[DEFAULT_TOKEN_COUNTS.length - 1], Math.max(
                Math.round((lead * SAMPLE_RATE + POSES_PER_TOKEN + BOUNDARY_FRAMES) / POSES_PER_TOKEN),
                Math.ceil((room + POSES_PER_TOKEN + BOUNDARY_FRAMES) / POSES_PER_TOKEN)))
            const frames = Math.round(segmentSeconds(tokens) * SAMPLE_RATE)
            const ahead = speed * frames / SAMPLE_RATE
            const window = cycleWindow(this.rig, cycle, cyclePhase(this.rig, cycle, context) + frames)
            targets = this.rig.place(this.rig.withSpeed(window, speed), fx + Math.cos(angle) * ahead, fy + Math.sin(angle) * ahead, angle)
            options = {tokens: [tokens]}
            stopping = false
        } else if (distance > speed * lead + 0.8) {
            const ahead = speed * lead
            targets = this.rig.place(this.rig.withSpeed(this.bricks[this.gait], speed), fx + Math.cos(angle) * ahead, fy + Math.sin(angle) * ahead, angle)
            stopping = false
        } else {
            if (!this._segment && distance < 0.35) {
                this.goal = null
                this._dirty = false
                return
            }
            targets = this.rig.place(this.bricks.rest, goal[0], goal[1], angle)
            stopping = true
            // Slowing down evenly takes twice as long as the distance at speed: allow only lengths near that,
            // or the model may rush the last metres and lurch.
            const moving = this._segment && !this._segment.stopping
            const need = moving ? Math.min(2 * distance / speed, segmentSeconds(DEFAULT_TOKEN_COUNTS[DEFAULT_TOKEN_COUNTS.length - 1])) * 0.8 : 0
            const tokens = DEFAULT_TOKEN_COUNTS.filter(t => segmentSeconds(t) >= need)
            if (tokens.length < DEFAULT_TOKEN_COUNTS.length) options = {tokens}
        }
        const request: Request = {
            id: ++this._requestId, segment: this._segment, startFrame, stopping, gait: this.gait,
            sequence, transitionEarly: sequence ? sequence.steps[sequence.next - 1].transitionEarly : undefined,
        }
        this._request = request
        this._dirty = false
        this.engine.generate(context, targets, options).then(motion => {
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
            this._retryIn = 1
            this.onError?.(e)
        })
    }

    private _switch() {
        const {request, poses} = this._pending!
        this._pending = null
        const seg = this._segment
        // Motion made from another segment, or from rest while a segment started since, no longer fits.
        if (request.segment !== seg) {
            this._dirty = true
            return
        }
        // A sequence's first step takes the robot off the seat; a Sit sequence's puts it on.
        if (request.sequence && request.sequence.next === 1) this.seat = request.sequence.seat ?? null
        let prefix: G1Pose[]
        if (seg && request.startFrame >= 0) {
            const frames = [...seg.prefix, ...seg.poses]
            const end = request.startFrame + seg.prefix.length
            prefix = frames.slice(end - 3, end)
            this._fade = {segment: seg, frame: this._frame, t: 0}
            this._frame = Math.max(0, this._frame - request.startFrame)
        } else {
            const p = Float32Array.from(poses[0])
            prefix = [p, p, p]
            this._frame = 0
            this._fade = null
        }
        this._segment = {
            poses,
            prefix,
            transitionEarly: request.stopping ? 0 : request.transitionEarly ?? this._transitionEarly(request.gait),
            stopping: request.stopping,
            sequence: request.sequence,
        }
    }
}

/** Seconds from the last context pose to the first target pose in a generation of this many tokens. */
function segmentSeconds(tokens: number) {
    return (tokens * POSES_PER_TOKEN - POSES_PER_TOKEN - BOUNDARY_FRAMES) / SAMPLE_RATE
}

/** The frame of a stride cycle that the last two context poses match best. */
function cyclePhase(rig: PoseRig, cycle: G1StrideCycle, context: G1Pose[]) {
    const frames = cycle.frames, n = frames.length
    let best = 0, bestError = Infinity
    for (let i = 0; i < n; i++) {
        let error = 0
        for (let c = 0; c < 2; c++) error += rig.distance(context[2 + c], frames[(i - 1 + c + n) % n])
        if (error < bestError) [best, bestError] = [i, error]
    }
    return best
}

/** Four frames of a stride cycle from a frame (wrapping into the next stride), moved to the ground origin. */
function cycleWindow(rig: PoseRig, cycle: G1StrideCycle, start: number) {
    const n = cycle.frames.length
    const window = [0, 1, 2, 3].map(f => {
        const i = start + f, stride = Math.floor(i / n)
        const p = Float32Array.from(cycle.frames[(i % n + n) % n])
        rig.translate(p, stride * cycle.travel[0], stride * cycle.travel[1])
        return p
    })
    const [x, y] = rig.ground(window[0])
    for (const p of window) rig.translate(p, -x, -y)
    return window
}

/** The pose at a fractional frame, held at the last frame. */
function samplePoses(rig: PoseRig, poses: G1Pose[], frame: number, out: G1Pose) {
    const last = poses.length - 1
    const f = Math.min(Math.max(frame, 0), last)
    const i = Math.floor(f)
    return rig.lerp(poses[i], poses[Math.min(i + 1, last)], f - i, out)
}
