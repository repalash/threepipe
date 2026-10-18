/**
 * screencast.mjs - a real-time recording of a page through CDP's screencast (JPEG frames with their timestamps), for
 * demos driven by real keyboard and mouse input, where the film cannot be rendered frame by frame. Sharper than
 * Playwright's recordVideo (VP8 at about 1 Mbit/s): frames are kept as JPEG at quality 90 and encoded once, to H.264.
 *
 *     const rec = await startScreencast(page, 'tmp/rec')     // after the page has loaded: load time is not filmed
 *     ...drive the page...
 *     const info = await rec.stop()
 *     encodeScreencast(info, 'video.mp4', {maxHold: 1.5})    // holds longer than 1.5 s are cut to it (dead time)
 *
 * Encoding needs ffmpeg with libx264: $FFMPEG, else ~/demo-tools/node_modules/ffmpeg-static/ffmpeg, else `ffmpeg`.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

export async function startScreencast(page, dir, {quality = 90, width, height} = {}) {
    dir = resolve(dir)
    rmSync(dir, {recursive: true, force: true})
    mkdirSync(dir, {recursive: true})
    const cdp = await page.context().newCDPSession(page)
    const frames = []
    let n = 0
    const writes = []
    cdp.on('Page.screencastFrame', ({data, metadata, sessionId}) => {
        const file = `s${String(++n).padStart(6, '0')}.jpg`
        frames.push({file, t: metadata.timestamp})
        writes.push(Promise.resolve().then(() => writeFileSync(join(dir, file), Buffer.from(data, 'base64'))))
        cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {})
    })
    const vp = page.viewportSize()
    await cdp.send('Page.startScreencast', {format: 'jpeg', quality, everyNthFrame: 1,
        maxWidth: width ?? vp?.width, maxHeight: height ?? vp?.height})
    const t0 = Date.now()
    return {
        async stop() {
            await cdp.send('Page.stopScreencast').catch(() => {})
            await Promise.all(writes)
            await cdp.detach().catch(() => {})
            return {dir, frames, wallSeconds: (Date.now() - t0) / 1000}
        },
    }
}

export function encodeScreencast({dir, frames}, out, {maxHold = 1.5, fps = 30, crf = 21} = {}) {
    if (frames.length < 2) throw new Error('screencast: no frames')
    const lines = ['ffconcat version 1.0']
    let total = 0, cut = 0
    for (let i = 0; i < frames.length; i++) {
        const next = frames[i + 1]?.t ?? frames[i].t + 1 / fps
        let d = Math.max(1 / 240, next - frames[i].t)
        if (d > maxHold) { cut += d - maxHold; d = maxHold }
        total += d
        lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(6)}`)
    }
    lines.push(`file '${frames.at(-1).file}'`)
    writeFileSync(join(dir, 'list.ffconcat'), lines.join('\n'))
    const ff = process.env.FFMPEG ?? [join(homedir(), 'demo-tools/node_modules/ffmpeg-static/ffmpeg')].find(existsSync) ?? 'ffmpeg'
    const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.ffconcat'),
        '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-movflags', '+faststart', out], {stdio: 'inherit'})
    if (r.status !== 0) throw new Error('ffmpeg failed')
    return {seconds: +total.toFixed(2), deadTimeCut: +cut.toFixed(2), frames: frames.length}
}
