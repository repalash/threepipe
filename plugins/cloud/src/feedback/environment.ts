import {ThreeViewer} from 'threepipe'

/**
 * The environment of a report: the browser, the screen, the WebGL renderer and what it supports, and
 * threepipe with its plugins. Nothing personal: no cookies, storage, history or file names. The worker
 * caps it at 8 KB of JSON, so the extension list is the one part that is cut.
 */
export function collectEnvironment(viewer: ThreeViewer | undefined): Record<string, unknown> {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    const env: Record<string, unknown> = {
        userAgent: nav?.userAgent?.slice(0, 300),
        platform: (nav as {userAgentData?: {platform?: string}} | undefined)?.userAgentData?.platform || nav?.platform,
        language: nav?.language,
        cores: nav?.hardwareConcurrency,
        memoryGB: (nav as {deviceMemory?: number} | undefined)?.deviceMemory,
        touch: nav ? nav.maxTouchPoints > 0 : undefined,
    }
    if (typeof window !== 'undefined') {
        env.screen = {width: window.screen?.width, height: window.screen?.height, dpr: window.devicePixelRatio}
        env.viewport = {width: window.innerWidth, height: window.innerHeight}
    }
    if (viewer) {
        env.threepipe = ThreeViewer.VERSION
        env.plugins = Object.keys(viewer.plugins).sort()
        const canvas = viewer.canvas
        env.canvas = {width: canvas.width, height: canvas.height, renderScale: viewer.renderManager.renderScale}
        env.webgl = webglInfo(viewer)
    }
    return env
}

function webglInfo(viewer: ThreeViewer): Record<string, unknown> {
    try {
        const renderer = viewer.renderManager.webglRenderer
        const gl = renderer.getContext()
        if (gl.isContextLost()) return {contextLost: true}
        const info: Record<string, unknown> = {
            webgl2: viewer.renderManager.isWebGL2,
            version: gl.getParameter(gl.VERSION),
            shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxSamples: renderer.capabilities.maxSamples,
            precision: renderer.capabilities.precision,
        }
        const dbg = gl.getExtension('WEBGL_debug_renderer_info')
        info.vendor = gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)
        info.renderer = gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
        // Without the common prefix, sorted; at most 4 KB of them.
        let ext = (gl.getSupportedExtensions() || []).map(e => e.replace(/^(WEBGL|EXT|OES|KHR|ANGLE)_/, m => m.toLowerCase())).sort().join(' ')
        if (ext.length > 4000) ext = ext.slice(0, 4000) + '…'
        info.extensions = ext
        return info
    } catch (e) {
        return {error: String((e as Error)?.message ?? e).slice(0, 200)}
    }
}
