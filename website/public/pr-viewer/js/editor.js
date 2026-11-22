// Loads Monaco (AMD build from the CDN, like the threepipe examples editor) and highlights code with TextMate
// grammars and a VS Code theme through Shiki (like shader-flow-editor's monacoSetup.ts). Languages load lazily, by
// file name, the first time a file needs them.

const MONACO_VERSION = '0.52.2'
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`
const SHIKI = 'https://esm.sh/shiki@4.6.0'
const SHIKI_THEMES = 'https://esm.sh/@shikijs/themes@4.6.0'

import {THEMES} from './themes.js'

export {THEMES}
export const DEFAULT_THEME = 'material-darker'

/** The Monaco theme in use (named after the variant, e.g. prv-material-darker). */
export let MONACO_THEME = 'prv-' + DEFAULT_THEME

// JetBrains (Material Darker) diff colors, sampled from the IDE
// The current variant's diff colors (from its IDE scheme: DIFF_MODIFIED, DIFF_INSERTED, DIFF_DELETED and their error
// stripes). A modified block's lines get the modified color softened over the background, its changed words the full
// color; an inserted or deleted block its full color. Replaced in place by applyTheme.
export const DIFF_COLORS = {...THEMES[0].diff}
/** The current variant's editor colors (line numbers, separators…), for what the page draws itself. */
export const EDITOR_COLORS = {...THEMES[0].editor}

// full-width multi-line selections, as in the IDE (Monaco stops a selected line at its end): see fullWidthSelection
const selStyle = document.createElement('style')
document.head.appendChild(selStyle)
const selClasses = new Set()
function selFromClass(px) {
    const name = `prv-sel-x${px}`
    if (!selClasses.has(name)) {
        selClasses.add(name)
        selStyle.sheet.insertRule(`.monaco-editor .view-overlays .prv-sel.${name} { margin-left: ${px}px; }`)
    }
    return name
}

/** Paints a multi-line selection to the editor's right edge (from the start column on its first line), as the IDE does. */
export function fullWidthSelection(monaco, editor) {
    const deco = editor.createDecorationsCollection()
    const update = () => {
        const out = []
        for (const s of editor.getSelections() || []) {
            if (s.startLineNumber === s.endLineNumber) continue
            const first = s.startLineNumber
            const x = s.startColumn > 1 ? Math.round(editor.getOffsetForColumn(first, s.startColumn)) : 0
            out.push({range: new monaco.Range(first, 1, first, 1), options: {isWholeLine: true, className: x ? `prv-sel ${selFromClass(x)}` : 'prv-sel'}})
            if (s.endLineNumber - 1 > first)
                out.push({range: new monaco.Range(first + 1, 1, s.endLineNumber - 1, 1), options: {isWholeLine: true, className: 'prv-sel'}})
        }
        deco.set(out)
    }
    editor.onDidChangeCursorSelection(update)
    editor.onDidChangeModel(() => deco.clear())
    return deco
}

let monacoReady
let highlighter
const registered = new Map() // shiki lang id -> monaco language id
const aliases = new Map() // alias/extension -> shiki lang id

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = src
        s.onload = resolve
        s.onerror = () => reject(new Error('Failed to load ' + src))
        document.head.appendChild(s)
    })
}

export function loadMonaco() {
    return monacoReady ??= (async () => {
        const shikiReady = loadShiki()
        await loadScript(`${MONACO_BASE}/vs/loader.js`)
        window.require.config({paths: {vs: `${MONACO_BASE}/vs`}})
        // Workers cannot be created cross-origin; start them from a data: URL that imports the CDN worker script.
        window.MonacoEnvironment = {
            getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
                `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`)}`,
        }
        const monaco = await new Promise((resolve, reject) => window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject))
        await shikiReady
        // the code font may arrive after Monaco measured it
        document.fonts?.ready.then(() => monaco.editor.remeasureFonts())
        return monaco
    })()
}

async function loadShiki() {
    const [{createHighlighter, bundledLanguagesInfo}, {createJavaScriptRegexEngine}] = await Promise.all([
        import(SHIKI),
        import(`${SHIKI}/engine/javascript`),
    ])
    highlighter = await createHighlighter({
        themes: [],
        langs: [],
        engine: createJavaScriptRegexEngine({forgiving: true}),
    })
    for (const info of bundledLanguagesInfo) {
        aliases.set(info.id, info.id)
        for (const a of info.aliases || []) aliases.set(a, info.id)
    }
}

const hex = (c) => (c || '').replace('#', '').slice(0, 6)

const baseThemes = {}
/** Shiki's Material theme for the scopes the IDE scheme does not map (light or dark). */
function baseTheme(dark) {
    const id = dark ? 'material-theme-darker' : 'material-theme-lighter'
    return baseThemes[id] ??= import(`${SHIKI_THEMES}/${id}`).then((m) => m.default)
}

export function themeById(id) {
    return THEMES.find((t) => t.id === id) || THEMES[0]
}

function onColor(hexColor) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#000000' : '#ffffff'
}

/** The page's colors (CSS variables) from a variant's UI palette and scheme. Works before Monaco loads. */
export function applyThemeCss(theme) {
    const u = theme.ui, e = theme.editor, d = theme.diff, st = theme.status
    const a = (c, alpha) => (c.length === 7 ? c + alpha : c)
    const vars = {
        '--bg': u.bg, '--bg2': u.cs, '--bg-hover': u.button, '--bg-sel': u.tree, '--bg-sel-focus': u.table,
        '--border': u.border, '--border2': u.hl, '--bg-on': u.hl, '--bg-tab': u.second, '--popup': u.second,
        '--popup-sel': u.selBg, '--fg': u.fg, '--fg-strong': u.white, '--fg-dim': u.text, '--fg-faint': u.dis,
        '--accent': u.accent, '--accent-bg': a(u.accent, '30'), '--on-accent': onColor(u.accent.slice(0, 7)),
        '--icon': u.fg, '--icon-dim': u.text, '--added': st.added, '--modified': st.modified, '--deleted': st.deleted,
        '--renamed': u.blue, '--danger': u.red, '--ed-bg': e.bg, '--sel': e.selection,
        '--d-mod': d.modified, '--d-mod-w': d.modifiedWord, '--d-ins': d.inserted, '--d-ins-w': d.insertedWord,
        '--d-del': d.deleted, '--d-del-w': d.deletedWord,
    }
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(k, v)
    root.style.colorScheme = theme.dark ? 'dark' : 'light'
    root.dataset.theme = theme.dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', u.bg)
    Object.assign(DIFF_COLORS, d)
    Object.assign(EDITOR_COLORS, e)
}

/**
 * Applies a Material variant: the page's colors, then (Monaco loaded) the code colors: Shiki's Material theme with
 * the variant's IDE syntax rules on top, and a Monaco theme with its editor and diff colors. Open models keep their
 * old tokens until they are tokenized again (the caller reopens the file).
 */
export async function applyTheme(monaco, theme) {
    applyThemeCss(theme)
    const name = 'prv-' + theme.id
    if (!highlighter.getLoadedThemes().includes(name)) {
        const base = await baseTheme(theme.dark)
        await highlighter.loadTheme({
            ...base, name, type: theme.dark ? 'dark' : 'light', fg: theme.editor.fg, bg: theme.editor.bg,
            colors: {...base.colors, 'editor.background': theme.editor.bg, 'editor.foreground': theme.editor.fg},
            tokenColors: [...(base.tokenColors || base.settings || []), ...theme.tokens],
        })
    }
    const {colorMap} = highlighter.setTheme(name)
    const rules = [{token: '', foreground: hex(theme.editor.fg)}]
    const styles = ['', 'italic', 'bold', 'italic bold', 'underline', 'italic underline', 'bold underline', 'italic bold underline']
    colorMap.forEach((c, i) => {
        if (!c) return
        rules.push({token: `c${i}`, foreground: hex(c)})
        for (let s = 1; s < 8; s++) rules.push({token: `c${i}.s${s}`, foreground: hex(c), fontStyle: styles[s]})
    })
    const e = theme.editor, d = theme.diff, u = theme.ui
    const slider = theme.dark ? '#ffffff' : '#000000'
    monaco.editor.defineTheme(name, {
        base: theme.dark ? 'vs-dark' : 'vs',
        inherit: true,
        rules,
        colors: {
            'editor.background': e.bg,
            'editor.foreground': e.fg,
            'editorGutter.background': e.gutter,
            'editor.lineHighlightBackground': '#00000000',
            'editor.lineHighlightBorder': '#00000000',
            'editorLineNumber.foreground': e.lineNumber, // LINE_NUMBERS_COLOR
            'editorLineNumber.activeForeground': e.lineNumberCaret, // LINE_NUMBER_ON_CARET_ROW_COLOR
            'editor.selectionBackground': e.selection, // SELECTION_BACKGROUND
            'editor.inactiveSelectionBackground': e.selection,
            'editor.selectionHighlightBackground': '#00000000',
            'editorCursor.foreground': e.caret, // CARET_COLOR
            'editorIndentGuide.background1': e.indentGuide,
            'editorWidget.background': u.second,
            'editorWidget.border': u.hl,
            'scrollbar.shadow': '#00000000',
            'scrollbarSlider.background': slider + '1f',
            'scrollbarSlider.hoverBackground': slider + '33',
            'scrollbarSlider.activeBackground': slider + '44',
            'editorOverviewRuler.border': '#00000000',
            'diffEditor.insertedLineBackground': d.inserted,
            'diffEditor.insertedTextBackground': d.insertedWord + 'cc',
            'diffEditor.removedLineBackground': d.deleted,
            'diffEditor.removedTextBackground': d.deletedWord + 'cc',
            'diffEditor.border': e.separator,
            'diffEditor.diagonalFill': u.border,
            'diffEditor.unchangedRegionBackground': e.collapsed || u.cs,
            'diffEditor.unchangedRegionForeground': u.text,
            'diffEditorGutter.insertedLineBackground': d.inserted,
            'diffEditorGutter.removedLineBackground': d.deleted,
            'diffEditorOverview.insertedForeground': d.insertedRuler,
            'diffEditorOverview.removedForeground': d.deletedRuler,
        },
    })
    MONACO_THEME = name
    monaco.editor.setTheme(name)
}

const EXT = {
    ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'jsx', md: 'markdown', mdx: 'mdx', json: 'json', jsonc: 'jsonc', json5: 'json5', yml: 'yaml', yaml: 'yaml', html: 'html',
    htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less', glsl: 'glsl', frag: 'glsl', vert: 'glsl', vs: 'glsl',
    fs: 'glsl', comp: 'glsl', wgsl: 'wgsl', hlsl: 'hlsl', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', kts: 'kotlin', swift: 'swift', c: 'c', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', mm: 'objective-cpp',
    m: 'objective-c', cs: 'csharp', php: 'php', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', vue: 'vue',
    svelte: 'svelte', xml: 'xml', svg: 'xml', plist: 'xml', toml: 'toml', sql: 'sql', lua: 'lua', dart: 'dart', ini: 'ini',
    cfg: 'ini', env: 'dotenv', graphql: 'graphql', gql: 'graphql', proto: 'proto', tf: 'terraform', gradle: 'groovy',
    ps1: 'powershell', bat: 'bat', r: 'r', scala: 'scala', ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell',
    clj: 'clojure', zig: 'zig', nix: 'nix', astro: 'astro', prisma: 'prisma', diff: 'diff', patch: 'diff', csv: 'csv',
    lock: 'yaml', txt: 'txt',
}
const NAMES = {
    dockerfile: 'docker', makefile: 'make', 'cmakelists.txt': 'cmake', '.gitignore': 'txt', '.npmignore': 'txt',
    '.env': 'dotenv', '.editorconfig': 'ini', '.gitattributes': 'txt', 'package-lock.json': 'json', '.babelrc': 'json',
    '.eslintrc': 'json', '.prettierrc': 'json', license: 'txt', notice: 'txt',
}

/** The Shiki language for a file name, or 'txt'. */
export function languageForPath(path) {
    const name = path.split('/').pop().toLowerCase()
    if (NAMES[name]) return NAMES[name]
    if (name.startsWith('dockerfile')) return 'docker'
    if (name.startsWith('.env')) return 'dotenv'
    const ext = name.includes('.') ? name.split('.').pop() : ''
    const id = EXT[ext] || aliases.get(ext)
    return id && (id === 'txt' || aliases.has(id)) ? id : 'txt'
}

const LANG_NAMES = {typescript: 'TypeScript', tsx: 'TypeScript JSX', javascript: 'JavaScript', jsx: 'JavaScript JSX', txt: 'Plain text', glsl: 'GLSL', json: 'JSON', markdown: 'Markdown'}
export function languageName(id) {
    return LANG_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1)
}

class TokenState {
    constructor(stack) { this.stack = stack }
    clone() { return new TokenState(this.stack) }
    equals(o) { return o instanceof TokenState && (o.stack === this.stack || !!(this.stack && o.stack && this.stack.equals(o.stack))) }
}

/** Loads the grammar for a Shiki language and returns the Monaco language id that highlights with it. */
export async function ensureLanguage(monaco, id) {
    if (id === 'txt') return 'plaintext'
    if (registered.has(id)) return registered.get(id)
    const monId = 'prv-' + id
    try {
        await highlighter.loadLanguage(id)
    } catch (e) {
        console.warn('No grammar for', id, e)
        registered.set(id, 'plaintext')
        return 'plaintext'
    }
    // a language id of our own, so Monaco's built-in language services (TS diagnostics etc.) stay out
    monaco.languages.register({id: monId})
    const grammar = highlighter.getLanguage(id)
    monaco.languages.setTokensProvider(monId, {
        getInitialState: () => new TokenState(null),
        tokenize(line, state) {
            if (line.length > 20000) return {endState: state, tokens: [{startIndex: 0, scopes: ''}]}
            const r = grammar.tokenizeLine2(line, state.stack, 500)
            const tokens = []
            for (let j = 0; j < r.tokens.length; j += 2) {
                const meta = r.tokens[j + 1]
                const fgIdx = (meta & 0x00ff8000) >>> 15
                const style = ((meta & 0x00007800) >>> 11) & 7
                tokens.push({startIndex: r.tokens[j], scopes: style ? `c${fgIdx}.s${style}` : `c${fgIdx}`})
            }
            return {endState: new TokenState(r.ruleStack), tokens}
        },
    })
    registered.set(id, monId)
    return monId
}

/** Highlighted HTML (Shiki, the current theme) for a code block of a Markdown preview; null for unknown languages. */
export async function highlightCode(code, lang) {
    if (!highlighter) return null
    const id = aliases.get(String(lang).toLowerCase()) || EXT[String(lang).toLowerCase()] || String(lang).toLowerCase()
    try {
        if (!highlighter.getLoadedLanguages().includes(id)) await highlighter.loadLanguage(id)
        return highlighter.codeToHtml(code, {lang: id, theme: MONACO_THEME})
    } catch {
        return null
    }
}
