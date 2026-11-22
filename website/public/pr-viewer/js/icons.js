// Icons in the style of the JetBrains "new UI" (16px, thin strokes), and file-type badges like the IDE's.

const svg = (body, size = 16) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
    up: svg('<path d="M8 13V3M4 7l4-4 4 4"/>'),
    down: svg('<path d="M8 3v10M4 9l4 4 4-4"/>'),
    left: svg('<path d="M13 8H3M7 4L3 8l4 4"/>'),
    right: svg('<path d="M3 8h10M9 4l4 4-4 4"/>'),
    pencil: svg('<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/>'),
    external: svg('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>'),
    sideBySide: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11"/>'),
    unified: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/>'),
    // a cog (after Lucide's "settings", ISC)
    gear: `<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    chevronDown: svg('<path d="M4 6l4 4 4-4"/>'),
    chevronRight: svg('<path d="M6 4l4 4-4 4"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    collapse: svg('<path d="M4 2.5l4 4 4-4M4 13.5l4-4 4 4"/>'),
    expand: svg('<path d="M4 6.5l4-4 4 4M4 9.5l4 4 4-4"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    commit: svg('<circle cx="8" cy="8" r="2.5"/><path d="M1.5 8h4M10.5 8h4"/>'),
    folder: svg('<path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.5 1.6h5.5a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>'),
    branch: svg('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5"/>'),
    changes: svg('<path d="M3 5.5h8.5M9 3l2.5 2.5L9 8M13 10.5H4.5M7 8l-2.5 2.5L7 13"/>'),
    menu: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
    check: svg('<path d="M3 8.5l3 3 7-7"/>'),
    eye: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    refresh: svg('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/>'),
    pr: svg('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7M8.5 3L7 4.5 8.5 6"/>'),
    comment: svg('<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>'),
    tag: svg('<path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.5" cy="5.5" r="1"/>'),
    search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
    log: svg('<circle cx="5" cy="4" r="1.5"/><circle cx="5" cy="12" r="1.5"/><path d="M5 5.5v5M8.5 4H14M8.5 8H14M8.5 12H14"/>'),
    more: svg('<circle cx="8" cy="3.5" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="8" cy="12.5" r=".6"/>'),
    github: `<svg class="ic" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
}

// file badges: [text, background, foreground]
const BADGES = {
    ts: ['TS', '#3c7ad3', '#fff'], mts: ['TS', '#3c7ad3', '#fff'], cts: ['TS', '#3c7ad3', '#fff'],
    tsx: ['JS', '#d9b45a', '#2b2b2b'], js: ['JS', '#d9b45a', '#2b2b2b'], mjs: ['JS', '#d9b45a', '#2b2b2b'],
    cjs: ['JS', '#d9b45a', '#2b2b2b'], jsx: ['JS', '#d9b45a', '#2b2b2b'],
    json: ['{}', null, '#d9b45a'], css: ['#', null, '#5a9bd6'], scss: ['#', null, '#c76394'], less: ['#', null, '#5a9bd6'],
    html: ['<>', null, '#e2803d'], htm: ['<>', null, '#e2803d'], xml: ['<>', null, '#e2803d'], svg: ['<>', null, '#d9b45a'],
    glsl: ['GL', '#5d6b7a', '#fff'], frag: ['GL', '#5d6b7a', '#fff'], vert: ['GL', '#5d6b7a', '#fff'], wgsl: ['WG', '#5d6b7a', '#fff'],
    py: ['PY', '#3d79b0', '#ffd75e'], go: ['GO', '#4aa8c9', '#fff'], rs: ['RS', '#b8693c', '#fff'], java: ['J', '#c3552c', '#fff'],
    kt: ['K', '#8a62d6', '#fff'], sh: ['>_', null, '#9da5ab'], yml: ['Y', null, '#d1677a'], yaml: ['Y', null, '#d1677a'],
    toml: ['T', null, '#9da5ab'], lock: ['🔒', null, '#9da5ab'], vue: ['V', null, '#41b883'], c: ['C', '#5a6fb3', '#fff'],
    cpp: ['C+', '#5a6fb3', '#fff'], h: ['H', '#7a6fb3', '#fff'], cs: ['C#', '#6a51b3', '#fff'], rb: ['RB', '#b33a3a', '#fff'],
    php: ['PHP', '#6b7bb3', '#fff'], swift: ['SW', '#e0643a', '#fff'], sql: ['SQL', null, '#d9b45a'],
}
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp'])

export function fileIcon(path) {
    const name = path.split('/').pop().toLowerCase()
    const ext = name.includes('.') ? name.split('.').pop() : ''
    if (ext === 'md' || ext === 'mdx') return `<span class="fi fi-md">M<span>↓</span></span>`
    if (IMAGE.has(ext)) return `<span class="fi fi-glyph" style="color:#a387d6">${svg('<rect x="2.5" y="3" width="11" height="10" rx="1"/><circle cx="6" cy="6.5" r="1.2"/><path d="M3 12l3.5-3.5 2.5 2.5 2-2 2.5 2.5"/>')}</span>`
    const b = BADGES[ext]
    if (!b) return `<span class="fi fi-glyph" style="color:#8c9196">${svg('<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>')}</span>`
    if (!b[1]) return `<span class="fi fi-text" style="color:${b[2]}">${b[0]}</span>`
    return `<span class="fi fi-badge" style="background:${b[1]};color:${b[2]}">${b[0]}</span>`
}

export const isImagePath = (path) => IMAGE.has((path.split('.').pop() || '').toLowerCase())
