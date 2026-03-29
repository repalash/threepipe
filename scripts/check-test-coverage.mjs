import path from 'node:path'
import fs from 'node:fs'
import {execSync} from 'node:child_process'

// Examples excluded from test coverage check (no test required).
// Tests in both interactive.spec.ts and extras.spec.ts are checked.
const excludedExamples = new Set([
    // Framework samples — esm.sh redirect stubs break CDN cache (see extras.spec.ts comment)
    'r3f-diamond-caustics-demo', 'r3f-drei-text-html', 'r3f-drei-transform-controls',
    'r3f-js-sample', 'r3f-jsx-sample', 'r3f-jsx-webgi', 'r3f-pivot-controls',
    'r3f-router-transitions-demo', 'r3f-spline-glass-demo', 'r3f-ssr-demo',
    'r3f-tsx-sample', 'r3f-tsx-webgi', 'react-js-sample', 'react-jsx-sample',
    'react-tsx-sample', 'vue-html-sample', 'vue-sfc-sample', 'svelte-sample',
    'r3f-spline-glass-demo', // broken: WebGLMultipleRenderTargets removed from three.js fork
    'flickity-ecommerce-pdp', // no index.html
    'aws-client-plugin', 'transfr-share-plugin',
    'ogc-tiles-google-maps', 'ogc-tiles-google-maps-3d', 'ogc-tiles-mars', 'slippy-map-tiles',
    'device-orientation-controls-plugin', 'pointer-lock-controls-plugin',
    'three-first-person-controls-plugin',
    'custom-size-snapshot', // no index.html
    // Procedural generation — in development, shelved
    'buildify-demo-1', 'buildify-demo-2', 'buildify-demo-3', 'buildify-demo-4',
    'pebble-scatter', 'flower-demo', 'flowers-on-building',
    'flower-scatter-v4', 'flower-scatter-v5', 'candy-bounce',
    'procedural-terrain-basic', 'procedural-noise-visualizer',
    'procedural-vegetation-scatter', 'procedural-asteroid-field',
    'procedural-flower-meadow', 'procedural-stone-path',
    'procedural-building', 'procedural-building-modular',
    'procedural-terrain-erosion', 'procedural-terrain-advanced',
    'procedural-terrain-showcase',
    // Non-deterministic rendering
    'video-load', 'shadertoy-player',
    // No _testFinish signal or not testable
    'flickity-carousel', 'html-js-sample', 'monkey-type-3d',
])

function checkTestCoverage(testDir, testFile, ignoredFolders, testingFile) {
    const pathname = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1')
    const __dirname = path.dirname(pathname)
    const dir = path.resolve(__dirname, '../' + testDir)
    const folders = fs.readdirSync(dir, {withFileTypes: true})
        .filter(dirent => dirent.isDirectory() && fs.existsSync(path.join(dir, dirent.name, testingFile)))
        .map(dirent => dirent.name)
        .filter(d => !ignoredFolders.includes(d) && !excludedExamples.has(d))

    const json = execSync(`npx playwright test ${testFile.split(',').join(' ')} --list --reporter=json`, {cwd: path.resolve(__dirname, '..')})
    const parsed = JSON.parse(json.toString())
    // Recursively collect all spec titles from nested suites (test.describe creates sub-suites)
    function collectTitles(suite) {
        const titles = (suite.specs || []).map(s => s.title)
        for (const child of (suite.suites || [])) titles.push(...collectTitles(child))
        return titles
    }
    // Collect titles from all matching suites (may span multiple files)
    const titles = parsed.suites.flatMap(s => collectTitles(s))

    const folderSet = new Set(folders)
    const titleSet = new Set(titles)
    let result = true
    for (const folder of folders) {
        if (!titleSet.has(folder)) {
            console.error(`No test for ${testDir}/${folder}`)
            result = false
        }
    }
    for (const title of titles) {
        if (!folderSet.has(title) && !excludedExamples.has(title)) {
            console.error(`No testing file ${testDir}/${title}/${testingFile} found for test ${testFile}:${title}`)
            result = false
        }
    }
    return result
}

function checkTestCoverageExamples() {
    const testDir = 'examples'
    const testFile = 'interactive.spec.ts,extras.spec.ts'
    const ignored = ['examples-utils', '_index']
    const testingFile = 'index.html'

    return checkTestCoverage(testDir, testFile, ignored, testingFile)
}

let result = true
result = result && checkTestCoverageExamples()

if (result) {
    console.log('Test coverage check passed!')
} else {
    process.exit(1)
}
