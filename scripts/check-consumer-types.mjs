// Type-checks the published declarations the way a consumer project sees them.
//
// Packs threepipe and @threepipe/plugin-tweakpane as the publish workflow does (clean-package + npm pack),
// installs both tarballs into a temporary project, and runs tsc on tests/consumer-types/consumer.ts
// under each TypeScript version and tsconfig setup in CASES.
//
// A case fails on any diagnostic in the consumer file or in the threepipe / @threepipe declarations.
// With skipLibCheck: false, diagnostics in other packages (@types/three, @webgpu/types, ...) are
// counted and printed but do not fail the case: threepipe does not emit them.
//
// Build first: `npm run build` and `npm run build` in plugins/tweakpane.
// Usage: npm run test:types [-- --keep]    (--keep leaves the temporary project on disk)
// Env:   TS_VERSIONS=5.0.4,7.0.2 to override the TypeScript versions.

import {execFileSync, execSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const plugin = path.join(root, 'plugins/tweakpane')
const keep = process.argv.includes('--keep')
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const pluginPkg = JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'), 'utf8'))

// Oldest supported, the version the repo builds with, and the two current majors.
const tsVersions = process.env.TS_VERSIONS?.split(',') ?? ['5.0.4', rootPkg.devDependencies.typescript, '6.0.3', '7.0.2']
const major = v => parseFloat(v)

const SETUPS = [
    {name: 'bundler', module: 'esnext', moduleResolution: 'bundler', libCheck: true},
    {name: 'node16', module: 'node16', moduleResolution: 'node16'},
    {name: 'nodenext', module: 'nodenext', moduleResolution: 'nodenext', libCheck: true},
    {name: 'node10', module: 'esnext', moduleResolution: 'node', maxTs: 7}, // removed in TypeScript 7
]
const CASES = tsVersions.flatMap(ts => SETUPS.filter(s => !s.maxTs || major(ts) < s.maxTs).flatMap(s => [
    {ts, ...s, skipLibCheck: true},
    // skipLibCheck: false from TypeScript 5.7: the declarations contain generic typed arrays (Float32Array<ArrayBuffer>).
    ...s.libCheck && major(ts) >= 5.7 ? [{ts, ...s, skipLibCheck: false}] : [],
]))

for (const dir of [path.join(root, 'lib'), path.join(root, 'dist'), path.join(plugin, 'dist')]) {
    if (!fs.existsSync(path.join(dir, 'index.d.ts'))) throw new Error(`${dir}/index.d.ts is missing. Build first (see the header of this script).`)
}

// Static check of every built package (core and plugins/*), also the ones the consumer below does not
// install: relative imports in its .d.ts files carry .js, and a "types" condition in its exports comes
// first and names a file that exists.
const bareSpecRE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+(?=['"])|\bdeclare\s+module\s+)(['"])([^.'"\n/][^'"\n]*)\2/g
const relativeSpecRE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+(?=['"])|\bdeclare\s+module\s+)(['"])(\.\.?\/[^'"\n]*)\2/g
const dtsFiles = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? dtsFiles(path.join(dir, e.name)) : e.name.endsWith('.d.ts') ? [path.join(dir, e.name)] : [])
const staticErrors = []
for (const dir of [root, ...fs.readdirSync(path.join(root, 'plugins')).map(d => path.join(root, 'plugins', d))]) {
    const built = ['dist', 'lib'].map(d => path.join(dir, d)).filter(d => fs.existsSync(d))
    if (!fs.existsSync(path.join(dir, 'package.json')) || !built.length) continue
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    for (const [sub, cond] of Object.entries(pkg.exports || {})) {
        if (!cond || typeof cond !== 'object' || !('types' in cond)) continue
        if (Object.keys(cond)[0] !== 'types') staticErrors.push(`${pkg.name} exports["${sub}"]: "types" must be the first condition`)
        if (!fs.existsSync(path.join(dir, cond.types))) staticErrors.push(`${pkg.name} exports["${sub}"].types: ${cond.types} is not in the build`)
    }
    // A plugin's declarations may import only packages it declares (dependencies or peerDependencies) or that
    // threepipe, its peer, brings. A bundled devDependency must be an optional peer, or its types stay out.
    const declared = dir === root ? null : new Set([pkg, rootPkg].flatMap(p => [...Object.keys(p.dependencies || {}), ...Object.keys(p.peerDependencies || {})]).concat('threepipe'))
    for (const file of built.flatMap(dtsFiles)) {
        const text = fs.readFileSync(file, 'utf8')
        for (const m of text.matchAll(relativeSpecRE)) {
            const line = text.slice(text.lastIndexOf('\n', m.index) + 1, m.index)
            if (!/^\s*(\/\*|\*|\/\/)/.test(line) && !m[3].endsWith('.js')) staticErrors.push(`${path.relative(root, file)}: '${m[3]}' needs .js (add afterBuild: fixDtsImports to its dts() call)`)
        }
        if (!declared) continue
        for (const m of text.matchAll(bareSpecRE)) {
            const line = text.slice(text.lastIndexOf('\n', m.index) + 1, m.index)
            const name = m[3].startsWith('@') ? m[3].split('/').slice(0, 2).join('/') : m[3].split('/')[0]
            if (!/^\s*(\/\*|\*|\/\/)/.test(line) && !name.includes('*') && !declared.has(name) && !declared.has('@types/' + name))
                staticErrors.push(`${path.relative(root, file)}: '${m[3]}' is not a dependency or peerDependency of ${pkg.name} (declare it, optional if it is bundled)`)
        }
    }
}
if (staticErrors.length) {
    console.log('FAIL  static declaration check\n' + staticErrors.slice(0, 20).map(e => '      ' + e).join('\n'))
    process.exit(1)
}
console.log('pass  static declaration check (every built package)')

const t0 = Date.now()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'threepipe-consumer-types-'))
const cleanPackage = path.join(root, 'node_modules/.bin/clean-package')

function pack(dir) {
    execFileSync(cleanPackage, {cwd: dir, stdio: 'ignore'})
    try {
        return path.join(work, execSync(`npm pack --silent --ignore-scripts --pack-destination "${work}"`, {cwd: dir, encoding: 'utf8'}).trim().split('\n').pop())
    } finally {
        execFileSync(cleanPackage, ['restore'], {cwd: dir, stdio: 'ignore'})
    }
}

const tsAlias = v => `typescript-${v}`
fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({
    name: 'threepipe-consumer-types', private: true, type: 'module',
    dependencies: {
        threepipe: 'file:' + pack(root),
        [pluginPkg.name]: 'file:' + pack(plugin),
        three: rootPkg.peerDependencies.three,
        'uiconfig-tweakpane': pluginPkg.peerDependencies['uiconfig-tweakpane'],
        ...Object.fromEntries(tsVersions.map(v => [tsAlias(v), `npm:typescript@${v}`])),
    },
}, null, 2))
fs.copyFileSync(path.join(root, 'tests/consumer-types/consumer.ts'), path.join(work, 'consumer.ts'))
execSync('npm install --silent --no-audit --no-fund --ignore-scripts', {cwd: work, stdio: 'inherit'})
console.log(`packed and installed in ${((Date.now() - t0) / 1000).toFixed(0)}s (${work})\n`)

// Errors that other packages cause in our files. A case whose only errors match these is reported as
// "known" and passes. Remove an entry when the package is fixed (the script says when it stops occurring).
const KNOWN = [
    {setups: ['node16', 'nodenext'], match: 'Property \'setupPluginUi\' does not exist',
        why: 'ts-browser-helpers dist/index.d.ts re-exports \'./types\' without .js, so `Class` is unresolved under node16/nodenext and addPluginSync() loses the plugin type'},
    {setups: ['nodenext'], skipLibCheck: false, match: 'has no exported member \'TextureImageData\'',
        why: '@types/three (three-types-modded) src/Three.d.ts exports \'./textures/types\' without .js'},
]
const seen = new Set()
const ours = /^(consumer\.ts|node_modules\/(threepipe|@threepipe)\/)/
let failed = 0
for (const c of CASES) {
    const name = `ts ${c.ts} ${c.name} skipLibCheck:${c.skipLibCheck}`
    const tsconfig = `tsconfig.${c.ts}.${c.name}.${c.skipLibCheck}.json`
    fs.writeFileSync(path.join(work, tsconfig), JSON.stringify({
        compilerOptions: {
            strict: true, noEmit: true, target: 'ES2022', lib: ['ES2022', 'DOM'],
            module: c.module, moduleResolution: c.moduleResolution, skipLibCheck: c.skipLibCheck,
            ...c.name === 'node10' && major(c.ts) >= 6 ? {ignoreDeprecations: '6.0'} : {},
        },
        files: ['consumer.ts'],
    }))
    let out = ''
    try {
        execFileSync(process.execPath, [path.join(work, 'node_modules', tsAlias(c.ts), 'bin/tsc'), '-p', tsconfig, '--pretty', 'false'], {cwd: work, encoding: 'utf8'})
    } catch (e) {
        out = (e.stdout || '') + (e.stderr || '')
    }
    const errors = out.split('\n').filter(l => / error TS\d+/.test(l))
    const own = errors.filter(l => ours.test(l) || !/^node_modules\//.test(l))
    const external = {}
    for (const l of errors.filter(e => !own.includes(e))) {
        const pkg = l.match(/^node_modules\/((@[^/]+\/)?[^/]+)/)[1]
        external[pkg] = (external[pkg] || 0) + 1
    }
    const known = KNOWN.filter(k => k.setups.includes(c.name) && (k.skipLibCheck ?? c.skipLibCheck) === c.skipLibCheck)
    const unexplained = own.filter(l => !known.some(k => l.includes(k.match) && seen.add(k)))
    const ext = Object.keys(external).length ? `  (not ours: ${Object.entries(external).map(([p, n]) => `${p} ${n}`).join(', ')})` : ''
    console.log(`${unexplained.length ? 'FAIL' : own.length ? 'known' : 'pass'}  ${name}${ext}`)
    for (const l of unexplained.slice(0, 10)) console.log('      ' + l)
    if (unexplained.length > 10) console.log(`      ... ${unexplained.length - 10} more`)
    if (unexplained.length) failed++
}

for (const k of KNOWN) console.log(seen.has(k) ? `\nknown: ${k.why}` : `\nKNOWN entry no longer occurs, remove it: ${k.why}`)
if (!keep) fs.rmSync(work, {recursive: true, force: true})
console.log(`\n${CASES.length - failed}/${CASES.length} cases pass, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
process.exit(failed ? 1 : 0)
