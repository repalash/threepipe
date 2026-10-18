#!/usr/bin/env node
/**
 * After drive.mjs: measures the two recordings and composes them side by side (Blender left, Design
 * right, the shorter one held on its last frame), with ffmpeg. Writes video-side-by-side.webm and
 * videos.json (duration and size of each, for the report).
 *
 *   node demos/house-walkthrough/compose-videos.mjs
 */

import {execFileSync} from 'node:child_process'
import {existsSync, statSync, writeFileSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const probe = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())
const files = ['video-blender.webm', 'video-design.webm'].map(f => join(here, f))
const info = {}

// Playwright's webm has no duration in its header; ffprobe then reports N/A. Remux once to fix it.
for (const f of files) {
    if (!existsSync(f)) continue
    let d = probe(f)
    if (!Number.isFinite(d)) {
        const tmp = f.replace(/\.webm$/, '.remux.webm')
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', f, '-c', 'copy', tmp])
        execFileSync('mv', [tmp, f])
        d = probe(f)
    }
    info[f.split('/').pop()] = {duration: Math.round(d), sizeMB: Math.round(statSync(f).size / 1e5) / 10}
}

if (files.every(existsSync)) {
    const [a, b] = files.map(probe)
    const len = Math.max(a, b)
    const out = join(here, 'video-side-by-side.webm')
    // Each run scaled to 960x540, held on its last frame to the longer one's length, side by side
    // (1920x540), with a label over each half. VP9 at a bitrate that keeps a 3-4 minute clip under 25 MB.
    const filter = [
        `[0:v]scale=960:540,tpad=stop_mode=clone:stop_duration=${Math.ceil(len - a + 1)},drawtext=text='Blender keymap':x=16:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8[l]`,
        `[1:v]scale=960:540,tpad=stop_mode=clone:stop_duration=${Math.ceil(len - b + 1)},drawtext=text='Design keymap':x=16:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8[r]`,
        `[l][r]hstack=inputs=2,trim=duration=${Math.ceil(len)}[v]`,
    ].join(';')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', files[0], '-i', files[1], '-filter_complex', filter, '-map', '[v]',
        '-c:v', 'libvpx-vp9', '-b:v', '700k', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', out], {stdio: 'inherit'})
    info['video-side-by-side.webm'] = {duration: Math.round(probe(out)), sizeMB: Math.round(statSync(out).size / 1e5) / 10}
}
writeFileSync(join(here, 'videos.json'), JSON.stringify(info, null, 2))
console.log(info)
