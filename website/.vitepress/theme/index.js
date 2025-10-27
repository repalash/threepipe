// .vitepress/theme/index.js
import DefaultTheme from 'vitepress/theme'
import './custom.css'

import vitepressNprogress from 'vitepress-plugin-nprogress'
import 'vitepress-plugin-nprogress/lib/css/index.css'
// import {setupViewer} from "./home-viewer.js";

const importMap = {
    threepipe: 'https://unpkg.com/threepipe@0.4.2/dist/index.mjs',
}

export default {
    ...DefaultTheme,
    enhanceApp: (ctx) => {
        DefaultTheme.enhanceApp(ctx)
        vitepressNprogress(ctx)
        ctx.app.component('SetupViewer', ()=>{
            // add import map to the page
            const script = document.createElement('script')
            script.type = 'importmap'
            script.text = JSON.stringify({imports: importMap})
            document.head.appendChild(script)
            const script2 = document.createElement('script')
            script2.type = 'module'
            script2.src = '/scripts/home-viewer.js'
            document.head.appendChild(script2)
            // setupViewer()
        })
    }
}
