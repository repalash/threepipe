// .vitepress/theme/index.js
import DefaultTheme from 'vitepress/theme'
import './custom.css'

import vitepressNprogress from 'vitepress-plugin-nprogress'
import 'vitepress-plugin-nprogress/lib/css/index.css'

export default {
    ...DefaultTheme,
    enhanceApp: (ctx) => {
        DefaultTheme.enhanceApp(ctx)
        vitepressNprogress(ctx)
    }
}
