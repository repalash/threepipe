/* global monacoTM */

const base = 'https://unpkg.com/monaco-tm@0.1.0/dist'
// const base = 'http://localhost:4173/'

const langs = {
    ['source.css']: {
        lang: 'css',
        file: 'css.tmLanguage.json',
    },
    ['text.html.basic']: {
        lang: 'html',
        file: 'html.tmLanguage.json',
    },
    ['source.ts']: {
        lang: 'typescript',
        file: 'TypeScript.tmLanguage.json',
    },
    ['source.js']: {
        lang: 'javascript',
        file: 'JavaScript.tmLanguage.json',
    },
}

export async function setupTM (monaco, editor) {
    await monacoTM.loadWASM(base + monacoTM.onigasmWasm) // See https://www.npmjs.com/package/onigasm#light-it-up

    const registry = new monacoTM.Registry({
        getGrammarDefinition: async (scopeName) => {
            const file = langs[scopeName] ? langs[scopeName].file : null
            if(!file) {
                throw new Error(`No grammar definition found for scope: ${scopeName}`)
            }
            return {
                format: 'json',
                content: await (await fetch(base + '/grammars/' + file)).text(),
            }
        },
    })

    // map of monaco "language id's" to TextMate scopeNames
    const grammars = new Map()
    Object.entries(langs).forEach(([scope, {lang}]) => {
        grammars.set(lang, scope)
    })

    await monacoTM.wireTmGrammars(monaco, registry, grammars, editor)
}

