// .vitepress/theme/index.js
import DefaultTheme from 'vitepress/theme'
import './custom.css'

import vitepressNprogress from 'vitepress-plugin-nprogress'
import 'vitepress-plugin-nprogress/lib/css/index.css'
// import {setupViewer} from "./home-viewer.js";

function createScript(src, type) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        if (type) script.type = type
        script.crossOrigin = 'anonymous'
        script.onload = () => resolve(script)
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
        document.head.appendChild(script)
    })
}

export default {
    ...DefaultTheme,
    enhanceApp: (ctx) => {
        DefaultTheme.enhanceApp(ctx)
        vitepressNprogress(ctx)
        ctx.app.component('SetupViewer', async ()=>{
            await createScript('https://cdn.jsdelivr.net/npm/threepipe@0.4.2/dist/index.js?o=threepipe.org')
            await createScript('https://cdn.jsdelivr.net/npm/@threepipe/webgi-plugins@0.5.11/dist/index.js?o=threepipe.org')
            await createScript('/scripts/home-viewer.js', 'module')
        })
    }
}
