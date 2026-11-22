// Loads Monaco (AMD build from the CDN, like the threepipe examples editor) and highlights code with TextMate
// grammars and a VS Code theme through Shiki (like shader-flow-editor's monacoSetup.ts). Languages load lazily, by
// file name, the first time a file needs them.

const MONACO_VERSION = '0.52.2'
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`
const SHIKI = 'https://esm.sh/shiki@4.6.0'
const SHIKI_THEME = 'https://esm.sh/@shikijs/themes@4.6.0/material-theme-darker'

// Where the IDE's Material Darker colors differ from the VS Code theme's (sampled from the IDE screenshots)
const JETBRAINS_TOKEN_COLORS = [
    {scope: ['meta.object-literal.key', 'variable.other.property', 'variable.other.object.property', 'support.variable.property',
        'variable.other.constant.property', 'entity.name.tag.yaml', 'support.type.property-name'], settings: {foreground: '#EEFFFF'}},
    {scope: ['variable.parameter', 'meta.parameters variable.parameter'], settings: {foreground: '#F78C6C', fontStyle: ''}},
    {scope: ['storage.type', 'storage.modifier', 'keyword.operator.new', 'keyword.operator.expression', 'keyword.control'], settings: {foreground: '#C792EA', fontStyle: 'italic'}},
    {scope: ['support.type.primitive', 'support.type.builtin'], settings: {foreground: '#C792EA', fontStyle: 'italic'}},
    {scope: ['storage.type.function.arrow'], settings: {foreground: '#C792EA', fontStyle: ''}},
]

export const THEME = 'material-theme-darker'
export const MONACO_THEME = 'prv-material-darker'

// JetBrains (Material Darker) diff colors, sampled from the IDE
export const DIFF_COLORS = {
    modified: '#1a2e33',
    modifiedWord: '#24434d',
    inserted: '#264c34',
    insertedWord: '#2f6340',
    deleted: '#3a3a3a',
    deletedWord: '#4f4f4f',
    insertedRuler: '#3f7d52',
    modifiedRuler: '#3b6b78',
    deletedRuler: '#6a6a6a',
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
        defineTheme(monaco)
        // the code font may arrive after Monaco measured it
        document.fonts?.ready.then(() => monaco.editor.remeasureFonts())
        return monaco
    })()
}

async function loadShiki() {
    const [{createHighlighter, bundledLanguagesInfo}, {createJavaScriptRegexEngine}, {default: baseTheme}] = await Promise.all([
        import(SHIKI),
        import(`${SHIKI}/engine/javascript`),
        import(SHIKI_THEME),
    ])
    const theme = {...baseTheme, name: THEME, tokenColors: [...(baseTheme.tokenColors || baseTheme.settings || []), ...JETBRAINS_TOKEN_COLORS]}
    highlighter = await createHighlighter({
        themes: [theme],
        langs: [],
        engine: createJavaScriptRegexEngine({forgiving: true}),
    })
    for (const info of bundledLanguagesInfo) {
        aliases.set(info.id, info.id)
        for (const a of info.aliases || []) aliases.set(a, info.id)
    }
}

const hex = (c) => (c || '').replace('#', '').slice(0, 6)

function defineTheme(monaco) {
    const {colorMap} = highlighter.setTheme(THEME)
    const theme = highlighter.getTheme(THEME)
    const fg = theme.fg || '#EEFFFF'
    const rules = [{token: '', foreground: hex(fg)}]
    const styles = ['', 'italic', 'bold', 'italic bold', 'underline', 'italic underline', 'bold underline', 'italic bold underline']
    colorMap.forEach((c, i) => {
        if (!c) return
        rules.push({token: `c${i}`, foreground: hex(c)})
        for (let s = 1; s < 8; s++) rules.push({token: `c${i}.s${s}`, foreground: hex(c), fontStyle: styles[s]})
    })
    const colors = {}
    for (const [k, v] of Object.entries(theme.colors || {})) if (/^#[0-9a-f]{3,8}$/i.test(v)) colors[k] = v
    monaco.editor.defineTheme(MONACO_THEME, {
        base: 'vs-dark',
        inherit: true,
        rules,
        colors: {
            ...colors,
            'editor.background': '#212121',
            'editorGutter.background': '#212121',
            'editor.lineHighlightBackground': '#00000000',
            'editor.lineHighlightBorder': '#00000000',
            'editorLineNumber.foreground': '#4a4a4a',
            'editorLineNumber.activeForeground': '#6a6a6a',
            'scrollbar.shadow': '#00000000',
            'scrollbarSlider.background': '#4a4a4a66',
            'scrollbarSlider.hoverBackground': '#5a5a5a99',
            'scrollbarSlider.activeBackground': '#6a6a6aaa',
            'editorOverviewRuler.border': '#00000000',
            'diffEditor.insertedLineBackground': DIFF_COLORS.inserted,
            'diffEditor.insertedTextBackground': DIFF_COLORS.insertedWord + 'cc',
            'diffEditor.removedLineBackground': DIFF_COLORS.deleted,
            'diffEditor.removedTextBackground': DIFF_COLORS.deletedWord + 'cc',
            'diffEditor.border': '#2b2b2b',
            'diffEditor.diagonalFill': '#2a2a2a',
            'diffEditor.unchangedRegionBackground': '#1a1a1a',
            'diffEditor.unchangedRegionForeground': '#7a7a7a',
            'diffEditorGutter.insertedLineBackground': DIFF_COLORS.inserted,
            'diffEditorGutter.removedLineBackground': DIFF_COLORS.deleted,
            'diffEditorOverview.insertedForeground': DIFF_COLORS.insertedRuler,
            'diffEditorOverview.removedForeground': DIFF_COLORS.deletedRuler,
        },
    })
    monaco.editor.setTheme(MONACO_THEME)
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
