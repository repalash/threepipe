// .vitepress/theme/index.js
import DefaultTheme from 'vitepress/theme'
import './custom.css'

import vitepressNprogress from 'vitepress-plugin-nprogress'
import 'vitepress-plugin-nprogress/lib/css/index.css'
import {loadScript, loadThreepipeWebgi} from './load-scripts.js'
import EffectToggle from './components/EffectToggle.vue'
import WebgiShowcase from './components/WebgiShowcase.vue'
// import {setupViewer} from "./home-viewer.js";

export default {
    ...DefaultTheme,
    enhanceApp: (ctx) => {
        DefaultTheme.enhanceApp(ctx)
        vitepressNprogress(ctx)
        ctx.app.component('SetupViewer', ()=>{
            if(window.setupViewer) {
                window.setupViewer()
                return
            }
            (async ()=> {
                await loadThreepipeWebgi()
                await loadScript('/scripts/home-viewer.js', 'module')
                window.setupViewer && window.setupViewer();
            })()
        })
        // package/webgi-plugins
        ctx.app.component('EffectToggle', EffectToggle)
        ctx.app.component('WebgiShowcase', WebgiShowcase)
    }
}
