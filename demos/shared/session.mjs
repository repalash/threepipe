/**
 * session.mjs - run a demo's session-style build script (`export default async session => {...}`, the shape
 * `npm run modelling:session` drives) inside a film (film.mjs).
 *
 * The build is unchanged: its `run` goes to the page; its camera jumps become eased glides; `capture(label)`
 * becomes a held shot with the label as caption (and a still); `beat(name)` / `section(title, sub)` put up the
 * storyboard's title card and start a chapter; `orbit` and `hold` are the film's. Everything the build sends is
 * in the film's transcript.
 */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export function filmSession(film, o = {}) {
    const {beats = {}, captureHold = 1.4, glide = 1.0, framesFor = c => READ_ONLY.has(c.op) ? 0 : 2, onBeat} = o
    let shot = 0, chapterNo = 0
    const total = o.chapters ?? Object.values(beats).filter(b => b?.title).length
    const lines = []
    const log = (...a) => { const s = a.join(' '); lines.push(s); if (o.verbose) console.log(s) }

    async function camera(cmd) {
        const {position, target, projection, fov, frustumSize} = cmd
        if (cmd.view || cmd.fit || cmd.save || (!position && !target)) {
            const r = await film.run(cmd, {frames: 0, show: false})
            return r
        }
        const instant = {op: 'camera', ...(projection ? {projection} : {}), ...(fov ? {fov} : {}), ...(frustumSize ? {frustumSize} : {})}
        const cur = await film.page.evaluate(() => window.viewer.scene.mainCamera.isOrthographicCamera ? 'orthographic' : 'perspective')
        if (projection && projection !== cur) {
            // a projection change is a cut: set it with the command, then place the camera at once
            await film.stage({...instant, position, target})
            film.record(cmd)
            return {ok: true, op: 'camera'}
        }
        if (Object.keys(instant).length > 1) await film.stage(instant)
        await film.glide({position, target}, glide)
        film.record(cmd)
        return {ok: true, op: 'camera'}
    }

    const session = {
        recording: true,
        page: film.page,
        outDir: undefined,
        present: true,
        log,
        lines,
        async run(cmd) {
            if (cmd.op === 'camera') return camera(cmd)
            if (cmd.op === 'export') { film.record(cmd); return {ok: true, op: 'export', data: {skipped: 'film'}} }
            const r = await film.run(cmd, {frames: framesFor(cmd), quiet: true})
            // Presentation only: the `light` command has no shadow-camera size (DirectionalLight2 defaults to 10 units,
            // issues/open/modelling-tools/command-light-target-local-space.md), so the film sizes it to the scene.
            if (r.ok && cmd.op === 'light' && cmd.castShadow && o.shadowFrustum) {
                await film.page.evaluate(([n, f]) => {
                    const l = window.viewer.scene.modelRoot.children.find(c => c.name === n && c.isLight)
                    if (l && 'shadowFrustum' in l) { l.shadowFrustum = f; l.shadow.mapSize.set(4096, 4096); l.shadow.map?.dispose(); l.shadow.map = null; l.shadow.bias = -0.0005; l.shadow.normalBias = 0.02 }
                    window.viewer.setDirty()
                }, [cmd.name, o.shadowFrustum])
            }
            return r
        },
        async runAll(cmds) { const out = []; for (const c of cmds) out.push(await session.run(c)); return out },
        async inspect(object, detail = true) { return film.run({op: 'inspect', object, detail, limit: 1000000}, {frames: 0, show: false}) },
        async capture(label, opts = {}) {
            if (opts.view || opts.fit) await camera({op: 'camera', ...opts})
            await film.caption(label)
            await film.hold(captureHold)
            await film.still(`${String(++shot).padStart(2, '0')}-${slug(label)}`)
            await film.caption('')
            return null
        },
        async beat(name, data) {
            const b = beats[name]
            onBeat?.(name, data)
            if (!b) return
            if (typeof b === "function") return b(film, data)
            if (b.camera) await film.glide(b.camera, glide)
            if (b.title) {
                chapterNo++
                film.chapter(b.title)
                await film.step(`${chapterNo} / ${total}  ${b.title}`)
                await film.title(b.title, b.sub ?? '', {kicker: b.kicker ?? `${chapterNo} / ${total}`, sec: b.sec ?? 1.6})
            }
            if (b.caption) await film.caption(b.caption)
        },
        async section(title, sub) {
            chapterNo++
            film.chapter(title)
            await film.step(`${chapterNo} / ${total}  ${title}`)
            await film.title(title, sub ?? '', {kicker: `${chapterNo} / ${total}`, sec: 1.5})
        },
        hold: t => film.hold(t === undefined ? captureHold : o.holdMs ? t / 1000 : t),
        /** One orbit round `center` at `radius` and `height` above it, in `seconds`. */
        async orbit({center, radius, height, seconds = 12, deg = 360}) {
            await film.glide({position: [center[0] + radius, center[1] + height, center[2]], target: center}, glide)
            await film.orbit({deg, sec: seconds, easing: false})
        },
    }
    return session
}

export const READ_ONLY = new Set(['inspect', 'measure', 'validate', 'diff', 'history', 'help', 'look', 'capture', 'checkpoint',
    'selftest', 'select', 'reference', 'lighting', 'light', 'display'])
