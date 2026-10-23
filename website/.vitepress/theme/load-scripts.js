// Script loading for the live viewers (home page and package/webgi-plugins).
// Both pages use the same UMD builds of threepipe and @threepipe/webgi-plugins, as a pair.
// Each src is loaded once per session, so moving between the two pages does not load a second copy.

const THREEPIPE_URL = 'https://cdn.jsdelivr.net/npm/threepipe@0.4.2/dist/index.js?o=threepipe.org'
const WEBGI_PLUGINS_URL = 'https://cdn.jsdelivr.net/npm/@threepipe/webgi-plugins@0.6.4/dist/index.js?o=threepipe.org'

const loaded = {}

export function loadScript(src, type) {
    if (loaded[src]) return loaded[src]
    loaded[src] = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        if (type) script.type = type
        script.crossOrigin = 'anonymous'
        script.onload = () => resolve(script)
        script.onerror = () => {
            delete loaded[src]
            script.remove()
            reject(new Error(`Failed to load script: ${src}`))
        }
        document.head.appendChild(script)
    })
    return loaded[src]
}

// window.threepipe and window['@threepipe/webgi-plugins'] are set after this resolves.
export async function loadThreepipeWebgi() {
    await loadScript(THREEPIPE_URL)
    await loadScript(WEBGI_PLUGINS_URL)
}
