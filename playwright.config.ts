import {defineConfig, devices} from '@playwright/test'
import {readFileSync, existsSync} from 'node:fs'

const VIEWPORT_WIDTH = parseInt(process.env.VIEWPORT_WIDTH || '1280')
const VIEWPORT_HEIGHT = parseInt(process.env.VIEWPORT_HEIGHT || '720')
const WORKERS = process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : (process.env.CI ? 2 : 6)

// Alpine Linux: system Chromium + Mesa GL (no SwiftShader available)
function isAlpine() {
    try { return readFileSync('/etc/os-release', 'utf8').includes('ID=alpine') }
    catch { return false }
}

function getExecutablePath() {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    if (isAlpine()) {
        for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium']) {
            if (existsSync(p)) return p
        }
    }
    return undefined
}

function getLaunchArgs() {
    const base = ['--no-sandbox', '--disable-dev-shm-usage']
    if (isAlpine()) {
        // No SwiftShader in system Chromium — use ANGLE → Mesa EGL → llvmpipe
        // --enable-webgl + --ignore-gpu-blocklist are required for WebGL on Alpine
        return [...base, '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl']
    }
    // Default: SwiftShader via ANGLE (bundled with Playwright Chromium)
    return [...base, '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
}

const executablePath = getExecutablePath()

export default defineConfig({
    testDir: './tests',
    testIgnore: ['**/snapshots/**', '**/setup.ts', '**/old-testing-branch-ref/**', '**/tests/*-agent-*.spec.ts'],
    timeout: 180000, // 3 min per test (includes asset download + rendering + screenshots)
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    workers: WORKERS,
    reporter: process.env.CI ? [['html', {open: 'never'}], ['line']] : 'html',
    use: {
        baseURL: 'http://127.0.0.1:9229',
        trace: 'on-first-retry',
        viewport: {width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT},
        launchOptions: {
            ...(executablePath ? {executablePath} : {}),
            args: getLaunchArgs(),
        },
    },
    snapshotPathTemplate: 'tests/snapshots/{projectName}-{platform}/{testName}/{arg}{ext}',
    expect: {
        timeout: 15000, // allow up to 15s for assertions (screenshot stability, title checks)
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.003,
            threshold: 0.1,
        },
        toMatchSnapshot: {
            maxDiffPixelRatio: 0.003,
            threshold: 0.1,
        },
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome']},
        },
        // Firefox and WebKit added in Phase 3
        // {
        //     name: 'firefox',
        //     use: {...devices['Desktop Firefox']},
        // },
        // {
        //     name: 'webkit',
        //     use: {...devices['Desktop Safari']},
        // },
    ],
    webServer: {
        command: 'npm run serve',
        url: 'http://127.0.0.1:9229',
        reuseExistingServer: !process.env.CI,
    },
})
