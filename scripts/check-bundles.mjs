// Checks the built bundles (dist/ and lib/) of the core and of every plugin, for two mistakes that build without an
// error and only show in the browser:
//
// - An import a consumer cannot resolve: every top-level import in a plugin bundle must be `threepipe` or one of the
//   plugin's peerDependencies, and in the core bundles one of its dependencies or peerDependencies. A bare `three`
//   left in a plugin (the `from 'three'` -> threepipe rewrite missed it) fails in every example import map.
// - A package bundled twice: two copies of one package from different node_modules folders, read from the
//   sourcemaps. In the workspace, a hoisted dependency can resolve another copy than the plugin's own (React 19 from
//   the root next to blueprintjs's React 18), and React hooks then fail. Fix it with `resolve.dedupe` in that
//   plugin's vite config.
//
// Build first: `npm run build:all` (or `npm run build` and `npm run build-plugins`).
// Usage: npm run check-bundles

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const rootPkg = readJson(path.join(root, 'package.json'))

// `import ... from 'x'`, `export ... from 'x'` and `import 'x'` at the start of a line: the bundles' own imports.
// Imports inside the code (bundled CommonJS `require`, dynamic `import()` in a dependency) are not matched.
const staticImportRE = /^(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1|^import\s*(['"])([^'"\n]+)\3/gm
const packageName = spec => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
const builtFiles = (dir, ext) => fs.readdirSync(dir, {recursive: true}).map(String).filter(f => ext.test(f)).map(f => path.join(dir, f))

const packages = [{dir: root, pkg: rootPkg, allowed: new Set([...Object.keys(rootPkg.dependencies || {}), ...Object.keys(rootPkg.peerDependencies || {})])}]
for (const folder of fs.readdirSync(path.join(root, 'plugins'))) {
    const dir = path.join(root, 'plugins', folder)
    if (folder.startsWith('plugin-template-') || !fs.existsSync(path.join(dir, 'package.json'))) continue
    const pkg = readJson(path.join(dir, 'package.json'))
    packages.push({dir, pkg, allowed: new Set(['threepipe', ...Object.keys(pkg.peerDependencies || {})])})
}

const errors = []
let checked = 0
for (const {dir, pkg, allowed} of packages) {
    const built = ['dist', 'lib'].map(d => path.join(dir, d)).filter(d => fs.existsSync(d))
    if (!built.length) {
        errors.push(`${pkg.name}: no dist/ or lib/, build first (npm run build:all)`)
        continue
    }
    checked++

    for (const file of built.flatMap(d => builtFiles(d, /\.m?js$/))) {
        const text = fs.readFileSync(file, 'utf8')
        for (const m of text.matchAll(staticImportRE)) {
            const spec = m[2] || m[4]
            if (spec.startsWith('.') || spec.startsWith('/')) continue
            if (!allowed.has(packageName(spec))) errors.push(`${path.relative(root, file)}: imports '${spec}', which is not ${dir === root ? 'a dependency or peerDependency' : 'threepipe or a peerDependency'} of ${pkg.name}`)
        }
    }

    // package name -> the node_modules folders it was bundled from
    const copies = new Map()
    for (const file of built.flatMap(d => builtFiles(d, /\.map$/))) {
        const map = readJson(file)
        for (const source of map.sources || []) {
            const m = path.resolve(path.dirname(file), map.sourceRoot || '', source).match(/^(.*[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+))[\\/]/)
            if (!m || !fs.existsSync(path.join(m[1], 'package.json'))) continue
            const name = m[2].replace(/\\/g, '/')
            if (!copies.has(name)) copies.set(name, new Set())
            copies.get(name).add(fs.realpathSync(m[1]))
        }
    }
    for (const [name, dirs] of copies) {
        if (dirs.size < 2) continue
        const list = [...dirs].map(d => `${readJson(path.join(d, 'package.json')).version} (${path.relative(root, d)})`).join(', ')
        errors.push(`${pkg.name}: bundles ${dirs.size} copies of ${name}: ${list}. Add it to resolve.dedupe in its vite config`)
    }
}

if (errors.length) {
    console.log('FAIL  bundle check\n' + errors.map(e => '      ' + e).join('\n'))
    process.exit(1)
}
console.log(`pass  bundle check (${checked} packages: imports are declared, no package bundled twice)`)
