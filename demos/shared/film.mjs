/**
 * film.mjs - a directed, frame-exact recorder for the modelling demos.
 *
 * The page is the modelling example (`examples/modelling-api`), reduced to its viewport. The film is not a screen
 * recording: every frame is rendered on purpose and captured, so camera moves are smooth whatever the machine,
 * a slow command never shows as a freeze, and the timeline is exactly what the storyboard says. Real time is
 * measured and reported separately (command ms, frame ms on the GPU).
 *
 *     const film = await openFilm({out: 'tmp/demo/camera/film', url})
 *     await film.title('Measure', 'Published dimensions and calibrated photographs', {seconds: 2})
 *     await film.run({op: 'primitive', ...}, {frames: 4})   // the command, then 4 frames of the camera move
 *     await film.orbit({deg: 30, seconds: 4})
 *     await film.finish()                                    // frames -> H.264 MP4 (faststart), chapters.json
 *
 * GPU: on macOS Chromium is launched with channel 'chromium' and `--use-angle=metal`; the WebGL renderer string is
 * read once and written to film.json (SwiftShader elsewhere, and it says so).
 * Encoding needs ffmpeg with libx264: $FFMPEG, else ~/demo-tools/node_modules/ffmpeg-static/ffmpeg, else `ffmpeg`.
 */
import {chromium} from 'playwright'
import {spawn, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

export const FPS = 30
const sleep = ms => new Promise(r => setTimeout(r, ms))
export const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

/** Serve the repo root with the static server the e2e tests use, unless something already answers. */
async function serve(root, port, probePath) {
    const ok = async () => { try { return (await fetch(`http://127.0.0.1:${port}${probePath}`)).ok } catch { return false } }
    if (await ok()) return () => {}
    const server = spawn(join(root, 'node_modules/.bin/ws'), ['-d', root, '-p', String(port)], {stdio: 'ignore', detached: true})
    for (let i = 0; i < 200 && !await ok(); i++) await sleep(100)
    return () => { try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill() } }
}

export async function openFilm(o = {}) {
    const root = resolve(o.root ?? '.')
    const width = o.width ?? 1920, height = o.height ?? 1080
    const out = resolve(o.out)
    const frameDir = join(out, 'frames')
    rmSync(frameDir, {recursive: true, force: true})
    mkdirSync(frameDir, {recursive: true})
    mkdirSync(join(out, 'stills'), {recursive: true})
    const port = o.port ?? 9473
    const page0 = o.page ?? '/examples/modelling-api/index.html'
    const stopServer = await serve(root, port, page0)
    const metal = process.platform === 'darwin' && process.env.FILM_ANGLE !== 'swiftshader'
    const browser = await chromium.launch(metal
        ? {channel: 'chromium', args: ['--use-angle=metal', '--hide-scrollbars']}
        : {args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars']})
    const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1})
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const tLoad = Date.now()
    await page.goto(`http://127.0.0.1:${port}${page0}`, {timeout: 300000})
    await page.waitForFunction(() => !!window.modelling && !!window.viewer?.scene?.environment, null, {timeout: 300000})
    const loadMs = Date.now() - tLoad
    const renderer = await page.evaluate(() => {
        const gl = window.viewer.renderManager.renderer.getContext()
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    })
    console.log('renderer:', renderer)
    await page.evaluate(installStage, {accent: o.accent ?? '#c0101c', background: o.background ?? '#e6e7ea'})

    // ------------------------------------------------------------------------------------------- frames
    const list = []        // [{file, frames}]
    let frameNo = 0, uniq = 0
    const chapters = []
    const transcript = []
    let commandMs = 0
    const state = {ticker: true}

    // CDP's screenshot (optimizeForSpeed) is several times faster than page.screenshot's stable-frame checks.
    const cdp = await page.context().newCDPSession(page)
    const grab = async path => {
        const {data} = await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 93, optimizeForSpeed: true})
        writeFileSync(path, Buffer.from(data, 'base64'))
    }
    /** Render one frame of the current page state and capture it; `n` repeats it (a hold). */
    async function shoot(n = 1) {
        await page.evaluate(() => window.__film.frame())
        const file = `f${String(++uniq).padStart(6, '0')}.jpg`
        await grab(join(frameDir, file))
        list.push({file, frames: n})
        frameNo += n
        return file
    }
    const seconds = () => frameNo / FPS

    /** Animate `fn(t)` (run in the page with t in 0..1, eased) over `sec` seconds, one capture a frame. */
    async function animate(sec, pageFn, arg, {easing = true} = {}) {
        const n = Math.max(1, Math.round(sec * FPS))
        for (let i = 1; i <= n; i++) {
            const t = easing ? ease(i / n) : i / n
            await page.evaluate(([src, t, arg]) => (0, eval)(src)(t, arg), [pageFn.toString(), t, arg])
            await shoot(1)
        }
    }

    const film = {
        page, renderer, errors, transcript, width, height, out,
        get seconds() { return seconds() },
        /** A named chapter starting now (for the report's seek links). */
        chapter(name) { chapters.push({name, t: +seconds().toFixed(2)}) },
        hold: async (sec = 1) => shoot(Math.max(1, Math.round(sec * FPS))),
        shoot,
        animate,
        /** Run a model command in the page; returns its result. `frames` frames are captured after it,
         *  moving the camera along the current move if one is set (`film.move`). */
        async run(cmd, {frames = 3, show = true, quiet = false} = {}) {
            const r = await page.evaluate(c => window.modelling.run(c), cmd)
            if (r.ok && cmd.op === 'decal') await page.evaluate(() => new Promise(r => setTimeout(r, 120))) // its texture decodes async
            commandMs += r.ms ?? 0
            transcript.push({command: cmd, ok: r.ok, ms: r.ms, error: r.ok ? undefined : r.error,
                warnings: r.warnings?.length ? r.warnings : undefined})
            if (!r.ok && !quiet) throw new Error(`${cmd.op} failed: ${r.error}`)
            if (show && state.ticker) await page.evaluate(c => window.__film.tick(c), cmd)
            for (let i = 0; i < frames; i++) { await page.evaluate(() => window.__film.step()); await shoot(1) }
            return r
        },
        /** Note a command the film carried out itself (an eased camera move) in the transcript. */
        record(cmd) { transcript.push({command: cmd, ok: true, ms: 0, film: true}) },
        /** A read-only command for the film itself (camera, reference, display): not in the transcript. */
        stage: cmd => page.evaluate(c => window.modelling.run(c), cmd),
        /** Set the camera now. */
        camera: (v) => page.evaluate(v => window.__film.setCamera(v), v),
        /** Glide the camera from where it is to `to` over `sec`, capturing every frame. */
        async glide(to, sec = 2) {
            const from = await page.evaluate(() => window.__film.getCamera())
            await animate(sec, (t, [a, b]) => window.__film.setCamera(window.__film.mix(a, b, t)), [from, to])
        },
        /** Orbit about the target (y axis) by `deg` over `sec` seconds, optionally rising by `rise` (world units). */
        async orbit({deg = 30, sec = 3, rise = 0, dolly = 1, easing = true} = {}) {
            const from = await page.evaluate(() => window.__film.getCamera())
            await animate(sec, (t, [c, deg, rise, dolly]) => window.__film.orbitFrom(c, deg * t, rise * t, 1 + (dolly - 1) * t), [from, deg, rise, dolly], {easing})
        },
        /** A slow move spread over the next command frames: each `run` frame advances it by one step of `steps`. */
        move: ({deg = 0, rise = 0, dolly = 1, steps = 100}) => page.evaluate(m => window.__film.setMove(m), {deg, rise, dolly, steps}),
        shift: frac => page.evaluate(f => window.__film.shift(f), frac),
        stopMove: () => page.evaluate(() => window.__film.setMove(null)),
        /** Full-screen title card, faded in and out over the live frame. */
        async title(title, sub = '', {kicker = '', sec = 2.2, fade = 0.4, step} = {}) {
            await page.evaluate(([a, b, k, s]) => window.__film.card(a, b, k, s), [title, sub, kicker, step ?? ''])
            await animate(fade, t => window.__film.cardOpacity(t), null, {easing: false})
            await film.hold(sec)
            await animate(fade, t => window.__film.cardOpacity(1 - t), null, {easing: false})
        },
        /** The lower-third caption (empty string hides it). */
        caption: text => page.evaluate(t => window.__film.caption(t), text),
        /** The step chip at the top left: "3 / 8  Subdivision". */
        step: (text) => page.evaluate(t => window.__film.chip(t), text),
        /** A key-value panel at the top right (metrics, measurements); `null` hides it. */
        panel: (rows) => page.evaluate(r => window.__film.panel(r), rows),
        ticker: on => { state.ticker = on; return page.evaluate(on => window.__film.showTicker(on), on) },
        /** A full-screen image (a photograph), `alpha` 0..1, `half` for a left-half split. */
        photo: (src, o) => page.evaluate(([s, o]) => window.__film.photo(s, o), [src, o ?? {}]),
        photoOpacity: async (to, sec = 0.5) => {
            const from = await page.evaluate(() => window.__film.photoAlpha())
            await animate(sec, (t, [a, b]) => window.__film.setPhotoAlpha(a + (b - a) * t), [from, to], {easing: false})
        },
        /** A free full-screen HTML layer (e.g. an SVG over a photograph) and its opacity. */
        layer: (html, alpha) => page.evaluate(([h, a]) => window.__film.layer(h, a), [html, alpha]),
        layerOpacity: async (to, sec = 0.5) => {
            const from = await page.evaluate(() => +(document.getElementById('film-free').style.opacity || 0))
            await animate(sec, (t, [a, b]) => { document.getElementById('film-free').style.opacity = a + (b - a) * t }, [from, to], {easing: false})
        },
        /** Clay: every surface in one matte grey (scene.overrideMaterial) - the form, without the materials. */
        clay: on => page.evaluate(on => window.__film.clay(on), on),
        /** Draw an object's master-mesh edges (the subdivision cage) as lines; `null` clears them. */
        cage: (name, color, opts) => page.evaluate(([n, c, o]) => window.__film.cage(n, c, o), [name, color ?? '#c0101c', opts ?? {}]),
        cageOpacity: o => page.evaluate(o => window.__film.cageOpacity(o), o),
        /** Save the current frame as a still (full size JPEG) under <out>/stills. */
        async still(name) {
            await page.evaluate(() => window.__film.frame())
            await grab(join(out, 'stills', `${name}.jpg`))
        },
        /** Counts over the document: objects, verts, faces, triangles (evaluated). */
        stats: () => page.evaluate(() => window.__film.stats()),
        /** Mean GPU frame time: `n` forced renders, each closed by gl.finish(). */
        frameMs: (n = 60) => page.evaluate(n => window.__film.frameMs(n), n),
        get commandMs() { return commandMs },
        async finish(meta = {}) {
            await browser.close()
            stopServer()
            // ffconcat: each unique frame with its duration; the last entry is repeated (a concat demuxer quirk).
            const lines = ['ffconcat version 1.0']
            for (const {file, frames} of list) lines.push(`file '${file}'`, `duration ${(frames / FPS).toFixed(6)}`)
            lines.push(`file '${list.at(-1).file}'`)
            writeFileSync(join(frameDir, 'list.ffconcat'), lines.join('\n'))
            const ff = process.env.FFMPEG ?? [join(homedir(), 'demo-tools/node_modules/ffmpeg-static/ffmpeg')].find(existsSync) ?? 'ffmpeg'
            const video = join(out, 'video.mp4')
            const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frameDir, 'list.ffconcat'),
                '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf ?? 21),
                '-tune', 'animation', '-movflags', '+faststart', video], {stdio: 'inherit'})
            if (r.status !== 0) throw new Error('ffmpeg failed')
            const info = {renderer, width, height, fps: FPS, seconds: +seconds().toFixed(2), frames: frameNo, uniqueFrames: uniq,
                loadMs, commandMs: +commandMs.toFixed(1), commands: transcript.length,
                failed: transcript.filter(t => !t.ok).length, chapters, errors, ...meta}
            writeFileSync(join(out, 'film.json'), JSON.stringify(info, null, 1))
            writeFileSync(join(out, 'transcript.json'), JSON.stringify(transcript))
            if (!o.keepFrames) rmSync(frameDir, {recursive: true, force: true})
            console.log(JSON.stringify({video, seconds: info.seconds, frames: frameNo, unique: uniq, commands: info.commands, failed: info.failed}))
            return info
        },
        async abort() { await browser.close(); stopServer() },
    }
    return film
}

/** Runs in the page: the stage (viewport only) and the overlays, all driven per frame - no CSS transitions. */
async function installStage({accent, background}) {
    const viewer = window.viewer
    const T = await import('threepipe')
    for (const sel of ['#console', '#side', '#tweakpaneUiContainer', '.code-preview', '#example-code-preview', '#example-code-btn',
        '[class*="loadingScreen"]', '[class*="code-btn"]', 'a.code-btn'])
        document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
    document.body.style.gridTemplateColumns = '1fr'
    document.body.style.gridTemplateRows = '1fr'
    document.body.style.gridTemplateAreas = '"view"'
    viewer.getPlugin('LoadingScreenPlugin')?.hide?.()
    viewer.scene.setBackgroundColor?.(background)
    const css = document.createElement('style')
    css.textContent = `
      body > *:not(#film):not(canvas):not(#mcanvas):not(#canvas-container):not(main):not(#view) { }
      [class*="loadingScreen"], [class*="LoadingScreen"] { display: none !important; }
      #film { position: fixed; inset: 0; pointer-events: none; z-index: 100; font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', sans-serif; }
      #film-card { position: absolute; inset: 0; background: #0d0e10; color: #f2f2f4; display: flex; flex-direction: column;
        align-items: center; justify-content: center; text-align: center; opacity: 0; padding: 0 12vw; }
      #film-card .t { font-weight: 300; font-size: 64px; line-height: 1.15; letter-spacing: .005em; }
      #film-card .s { font-size: 25px; color: #a2a4ac; margin-top: 20px; font-weight: 400; line-height: 1.4; }
      #film-card .k { font: 600 17px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .24em; color: ${accent}; margin-bottom: 26px; text-transform: uppercase; }
      #film-photo { position: absolute; inset: 0; background: #0d0e10 center/contain no-repeat; opacity: 0; }
      #film-photo.half { right: 50%; }
      #film-photo .credit { position: absolute; right: 14px; bottom: 10px; font-size: 13px; color: #9a9ca4; }
      #film-caption { position: absolute; left: 48px; bottom: 44px; padding: 11px 18px; background: rgba(13,14,16,.82); color: #f0f0f2;
        font-size: 24px; line-height: 1.35; border-left: 4px solid ${accent}; max-width: 62%; }
      #film-caption:empty, #film-chip:empty, #film-panel:empty { display: none; }
      #film-chip { position: absolute; left: 48px; top: 40px; padding: 8px 16px; background: rgba(13,14,16,.85); color: #fff;
        font: 600 20px ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em; }
      #film-chip b { color: ${accent}; font-weight: 700; margin-right: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      #film-ticker { position: absolute; right: 40px; bottom: 40px; width: 640px; font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #e8e8ea; background: rgba(13,14,16,.74); padding: 10px 14px; border-radius: 4px; white-space: nowrap; overflow: hidden; }
      #film-ticker:empty { display: none; }
      #film-ticker div { overflow: hidden; text-overflow: ellipsis; opacity: .55; }
      #film-ticker div:last-child { opacity: 1; }
      #film-ticker .op { color: #ff8a80; }
      #film-panel { position: absolute; right: 40px; top: 40px; background: rgba(255,255,255,.86); color: #1b1c20; padding: 12px 16px;
        font: 17px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; border-radius: 4px; min-width: 300px; }
      #film-panel .r { display: flex; justify-content: space-between; gap: 28px; }
      #film-panel .r span:last-child { font-weight: 700; }
      #film-panel .h { font: 700 13px ui-sans-serif, system-ui; letter-spacing: .18em; text-transform: uppercase; color: ${accent}; margin-bottom: 4px; }
    `
    document.head.appendChild(css)
    const root = document.createElement('div')
    root.id = 'film'
    root.innerHTML = '<canvas id="film-lines" style="position:absolute;inset:0"></canvas><div id="film-photo"></div><div id="film-free" style="position:absolute;inset:0;opacity:0"></div><div id="film-chip"></div><div id="film-panel"></div><div id="film-ticker"></div><div id="film-caption"></div><div id="film-card"></div>'
    document.body.appendChild(root)
    window.dispatchEvent(new Event('resize'))
    const $ = id => document.getElementById(id)
    const cam = () => viewer.scene.mainCamera
    const ctrl = () => cam().controls
    if (ctrl()) { ctrl().enableDamping = false; ctrl().autoRotate = false }
    let move = null, moveFrom = null, moveI = 0
    let cage = null
    const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c])
    const f = window.__film = {
        T: {...T, clay: new T.PhysicalMaterial({color: '#7f8287', roughness: 0.5, metalness: 0})},
        async frame() {
            f.drawCage()
            viewer.setDirty()
            await new Promise(r => viewer.doOnce('postFrame', r))
        },
        getCamera() {
            const c = cam()
            return {position: c.position.toArray(), target: c.target.toArray(), fov: c.fov}
        },
        setCamera(v) {
            const c = cam()
            if (v.position) c.position.fromArray(v.position)
            if (v.target) c.target.fromArray(v.target)
            if (v.fov && c.fov !== v.fov) { c.fov = v.fov; c.updateProjectionMatrix?.() }
            c.setDirty?.()
            if (ctrl()) ctrl().update?.()
        },
        mix(a, b, t) {
            const L = (x, y) => x.map((v, i) => v + (y[i] - v) * t)
            return {position: L(a.position, b.position), target: L(a.target, b.target), fov: a.fov + ((b.fov ?? a.fov) - a.fov) * t}
        },
        orbitFrom(c, deg, rise, dolly) {
            const [px, py, pz] = c.position, [tx, ty, tz] = c.target
            const a = deg * Math.PI / 180, dx = px - tx, dz = pz - tz
            f.setCamera({position: [tx + (dx * Math.cos(a) - dz * Math.sin(a)) * dolly, ty + ((py - ty) * dolly) + rise,
                tz + (dx * Math.sin(a) + dz * Math.cos(a)) * dolly], target: c.target})
        },
        /** Slide the camera and its target sideways by `frac` of the view width (positive: the model moves left). */
        shift(frac) {
            const c = cam(), V3 = f.T.Vector3
            const dir = c.target.clone().sub(c.position), d = dir.length()
            const right = new V3().crossVectors(dir.normalize(), new V3(0, 1, 0)).normalize()
            const w = 2 * d * Math.tan(c.fov * Math.PI / 360) * (innerWidth / innerHeight)
            const off = right.multiplyScalar(w * frac)
            f.setCamera({position: c.position.clone().add(off).toArray(), target: c.target.clone().add(off).toArray()})
        },
        setMove(m) { move = m; moveFrom = m ? f.getCamera() : null; moveI = 0 },
        step() {
            if (!move) return
            moveI = Math.min(move.steps, moveI + 1)
            const t = moveI / move.steps
            f.orbitFrom(moveFrom, move.deg * t, move.rise * t, 1 + (move.dolly - 1) * t)
        },
        card(t, s, k, step) {
            $('film-card').innerHTML = `${k ? `<div class="k">${esc(k)}</div>` : ''}<div class="t">${esc(t)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}`
        },
        cardOpacity(o) { $('film-card').style.opacity = o },
        caption(t) { $('film-caption').textContent = t ?? '' },
        chip(t) {
            if (!t) { $('film-chip').innerHTML = ''; return }
            const m = /^(\S+ \/ \S+)\s+(.*)$/.exec(t)
            $('film-chip').innerHTML = m ? `<b>${esc(m[1])}</b>${esc(m[2])}` : esc(t)
        },
        panel(rows) {
            if (!rows) { $('film-panel').innerHTML = ''; return }
            $('film-panel').innerHTML = rows.map(r => typeof r === 'string' ? `<div class="h">${esc(r)}</div>`
                : `<div class="r"><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('')
        },
        lines: [],
        tick(c) {
            const {op, ...rest} = c
            let s = JSON.stringify(rest)
            if (s.length > 120) s = s.slice(0, 117) + '…'
            f.lines.push(`<span class="op">${esc(op)}</span> ${esc(s)}`)
            f.lines = f.lines.slice(-4)
            if (f.tickerOn !== false) $('film-ticker').innerHTML = f.lines.map(l => `<div>${l}</div>`).join('')
        },
        showTicker(on) { f.tickerOn = on; $('film-ticker').innerHTML = on ? f.lines.map(l => `<div>${l}</div>`).join('') : '' },
        photo(src, o) {
            const p = $('film-photo')
            p.style.backgroundImage = src ? `url(${src})` : ''
            p.classList.toggle('half', !!o.half)
            p.style.backgroundColor = o.bg ?? '#0d0e10'
            p.innerHTML = o.credit ? `<div class="credit">${esc(o.credit)}</div>` : ''
            if (o.alpha !== undefined) p.style.opacity = o.alpha
        },
        layer(h, a) { if (h !== null && h !== undefined) $('film-free').innerHTML = h; if (a !== undefined) $('film-free').style.opacity = a },
        photoAlpha() { return +($('film-photo').style.opacity || 0) },
        setPhotoAlpha(a) { $('film-photo').style.opacity = a },
        clay(on) {
            viewer.scene.overrideMaterial = on ? f.T.clay : null
            viewer.setDirty()
        },
        /** The cage: an object's master-mesh edges (as `inspect {detail}` reports them), drawn as lines on a 2D
         *  overlay projected from the camera every frame - so it is unaffected by clay and draws through the surface. */
        async cage(name, color = '#c0101c', opts = {}) {
            cage = null
            if (!name) { f.drawCage(); return 0 }
            const r = await window.modelling.run({op: 'inspect', object: name, detail: true, limit: 1000000})
            const {vertices, edgeVerts} = r.data
            const obj = window.modelling.document.require(name).object
            obj.updateMatrixWorld(true)
            const world = vertices.map(v => new f.T.Vector3(...v).applyMatrix4(obj.matrixWorld))
            cage = {world, edges: edgeVerts, color, opacity: 1, obj, ...opts}
            f.drawCage()
            return edgeVerts.length
        },
        cageOpacity(o) { if (cage) cage.opacity = o; f.drawCage() },
        drawCage() {
            const cv = $('film-lines'), W = cv.width = innerWidth, H = cv.height = innerHeight
            const ctx = cv.getContext('2d')
            ctx.clearRect(0, 0, W, H)
            if (!cage || cage.opacity <= 0) return
            const c = cam()
            c.updateMatrixWorld(true)
            const p = cage.world.map(v => { const q = v.clone().project(c); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H, q.z] })
            // hidden vertices (behind the surface, by a ray from the eye) draw their edges faint, as Blender's
            // edit-mode overlay does without x-ray
            let seen = null
            if (cage.occlude) {
                const ray = new f.T.Raycaster(), eye = c.getWorldPosition(new f.T.Vector3())
                seen = cage.world.map(v => {
                    const dir = v.clone().sub(eye), d = dir.length()
                    ray.set(eye, dir.normalize())
                    ray.far = d
                    const hit = ray.intersectObject(cage.obj, true)[0]
                    return !hit || hit.distance > d - Math.max(1e-4, d * 2e-3)
                })
            }
            ctx.lineWidth = cage.width ?? 1.6
            ctx.strokeStyle = cage.color
            for (const pass of seen ? [false, true] : [true]) {
                ctx.globalAlpha = cage.opacity * (pass ? 1 : 0.18)
                ctx.beginPath()
                for (const [a, b] of cage.edges) {
                    if (p[a][2] > 1 || p[b][2] > 1) continue
                    if (seen && (seen[a] && seen[b]) !== pass) continue
                    ctx.moveTo(p[a][0], p[a][1]); ctx.lineTo(p[b][0], p[b][1])
                }
                ctx.stroke()
            }
            ctx.fillStyle = cage.color
            ctx.globalAlpha = cage.opacity
            p.forEach((q, i) => { if (q[2] <= 1 && (!seen || seen[i])) ctx.fillRect(q[0] - 2, q[1] - 2, 4, 4) })
        },
        stats() {
            let objects = 0, verts = 0, faces = 0, tris = 0
            for (const e of window.modelling.document.entries) {
                objects++
                const g = e.object.geometry
                if (g) { tris += (g.index ? g.index.count : g.attributes.position.count) / 3 }
                verts += e.evaluated?.vertsNum ?? 0
                faces += e.evaluated?.facesNum ?? 0
            }
            return {objects, verts, faces, tris: Math.round(tris)}
        },
        async frameMs(n) {
            const gl = viewer.renderManager.renderer.getContext()
            const times = []
            for (let i = 0; i < n; i++) {
                const t0 = performance.now()
                viewer.setDirty()
                await new Promise(r => viewer.doOnce('postFrame', r))
                gl.finish()
                times.push(performance.now() - t0)
            }
            times.sort((a, b) => a - b)
            return {median: +times[n >> 1].toFixed(2), p90: +times[Math.floor(n * .9)].toFixed(2)}
        },
    }
}
