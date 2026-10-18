// The GPU VM, through `tpvm` (../../../../tools/TPVM.md): sync the committed branch, push input files that are
// not in git (the reference GLB, a build's GLB, heat data), run a render job, pull the result.
//
// `tpvm` sends only committed work, and the relay caps a single write at 1 MB, so files go up base64'd in
// 900 kB parts (`ij write`) and are reassembled and md5-checked on the VM. A file whose md5 already matches
// on the VM is not sent again.

import {execFile, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'

export const TPVM = process.env.TPVM ?? '/Users/palash/Projects/threepipe/.repos/tools/tpvm'
const IJ = process.env.IJ ?? `${homedir()}/.local/bin/ij`
const HOST = process.env.TPVM_HOST ?? 'palash-mac2-utm-mac-1-p'
const PART = 900000

const sh = (file, args, opts = {}) => execFileSync(file, args, {encoding: 'utf8', maxBuffer: 64 << 20, ...opts})
const ij = (cmd, opts) => sh(IJ, ['-h', HOST, cmd], opts).split('\n').filter(l => !l.startsWith('[exit ')).join('\n').trim()
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`
/** The md5 a VM command printed (the relay may add notices around it). */
const md5Of = text => text.split('\n').map(l => l.trim()).filter(l => /^[0-9a-f]{32}$/.test(l)).pop() ?? ''

export function md5(path) { return createHash('md5').update(readFileSync(path)).digest('hex') }

let wtCache = null
/** The VM worktree of the current branch. */
export function vmPath(cwd) { return wtCache ??= sh(TPVM, ['path'], {cwd}).trim() }

export function sync(cwd) { return sh(TPVM, ['sync'], {cwd}) }

/** Copy a local file to `<vm worktree>/<rel>` unless it is already there with the same md5. */
export function push(cwd, local, rel) {
    const dest = `${vmPath(cwd)}/${rel}`
    const want = md5(local)
    const have = md5Of(ij(`md5 -q ${q(dest)} 2>/dev/null || true`))
    if (have === want) return {sent: false, md5: want}
    const b64 = readFileSync(local).toString('base64')
    const key = `/tmp/bench-push-${want}`
    const n = Math.ceil(b64.length / PART)
    for (let i = 0; i < n; i++) sh(IJ, ['-h', HOST, 'write', `${key}.${String(i).padStart(4, '0')}`], {input: b64.slice(i * PART, (i + 1) * PART)})
    ij(`mkdir -p $(dirname ${q(dest)}) && cat ${key}.* | base64 -D -o ${q(dest)} && rm -f ${key}.*`)
    const got = md5Of(ij(`md5 -q ${q(dest)}`))
    if (got !== want) throw new Error(`push ${local}: md5 on the VM is ${got}, expected ${want}`)
    return {sent: true, md5: want, parts: n}
}

/** Run a shell command in the VM worktree under the GPU lock. */
export function run(cwd, cmd, timeoutSec = 1800) { return sh(TPVM, ['run', '-t', String(timeoutSec), cmd], {cwd}) }

/**
 * Copy `<vm worktree>/<rel>` back to `local`, checked against the VM's md5 and retried. The file is base64'd on
 * the VM and fetched in 30 kB slices (the relay caps a command's output), 6 at a time. Only base64 lines are kept
 * from each slice: the relay can add notices ("rules changed: ...") to any output, which broke `tpvm pull`'s
 * size parse and could otherwise corrupt a slice.
 */
export async function pull(cwd, rel, local, attempts = 3) {
    const src = `${vmPath(cwd)}/${rel}`
    const want = md5Of(ij(`md5 -q ${q(src)}`))
    const key = `/tmp/bench-pull-${process.pid}-${Date.now()}`
    const sizeOut = ij(`base64 -i ${q(src)} | tr -d '\\n' > ${key}.b64 && wc -c < ${key}.b64`)
    const n = Number(sizeOut.split('\n').map(l => l.trim()).filter(l => /^\d+$/.test(l)).pop())
    if (!Number.isFinite(n) || n <= 0) throw new Error(`vm pull ${rel}: cannot size ${src} (${sizeOut})`)
    const SLICE = 30000
    const chunks = Math.ceil(n / SLICE)
    const b64Line = /^[A-Za-z0-9+/=]+$/
    const fetchOnce = i => new Promise((res, rej) => execFile(IJ, ['-h', HOST, `dd if=${key}.b64 bs=${SLICE} skip=${i} count=1 2>/dev/null`],
        {encoding: 'utf8', maxBuffer: 1 << 20}, (err, out) => err ? rej(err) : res(out.split('\n').map(l => l.trim()).filter(l => b64Line.test(l)).join(''))))
    // a single relay call can fail transiently (exit 255); retry a slice a few times before giving up
    const fetch = async i => {
        for (let t = 1; ; t++) {
            try { return await fetchOnce(i) } catch (e) {
                if (t >= 5) throw e
                await new Promise(r => setTimeout(r, 500 * t))
            }
        }
    }
    try {
        for (let a = 1; a <= attempts; a++) {
            const parts = new Array(chunks)
            let next = 0
            const worker = async() => { while (next < chunks) { const i = next++; parts[i] = await fetch(i) } }
            await Promise.all(Array.from({length: Math.min(4, chunks)}, worker))
            const b64 = parts.join('')
            const buf = Buffer.from(b64, 'base64')
            const got = createHash('md5').update(buf).digest('hex')
            if (got === want && b64.length === n) {
                writeFileSync(local, buf)
                return {md5: got, attempts: a}
            }
            console.warn(`vm pull ${rel}: md5 ${got} (${b64.length} of ${n} base64 bytes), expected ${want} (attempt ${a} of ${attempts})`)
        }
    } finally {
        ij(`rm -f ${key}.b64`)
    }
    throw new Error(`vm pull ${rel}: still corrupt after ${attempts} attempts`)
}
