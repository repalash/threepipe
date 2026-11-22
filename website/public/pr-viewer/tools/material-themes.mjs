#!/usr/bin/env node
// Generates ../js/themes.js: the Material variants of the JetBrains Material Theme UI, from the plugin's own files in
// a checkout of https://github.com/AtomMaterialUI/material-theme-ui-lite (MIT):
//   - themes/regular/Material <Name>.theme.json: the UI palette ("colors": bg, fg, accent, …)
//   - colors/Material <Name>.xml: the editor scheme (diff, selection, gutter, caret colors and the syntax attributes)
// The syntax attributes are JetBrains' (DEFAULT_KEYWORD, JS.PARAMETER, …); they are mapped to TextMate scopes below.
//
//   node tools/material-themes.mjs <path to material-theme-ui-lite checkout>

import fs from 'node:fs'
import path from 'node:path'

const repo = process.argv[2]
if (!repo) { console.error('usage: node tools/material-themes.mjs <material-theme-ui-lite checkout>'); process.exit(1) }
const res = path.join(repo, 'src/main/resources')
const VARIANTS = ['Darker', 'Oceanic', 'Palenight', 'Deep Ocean', 'Forest', 'Space', 'Volcano', 'Lighter', 'Sandy Beach', 'Sky Blue']

/** A minimal reader for IntelliJ color scheme XML: <colors><option name value/></colors> and <attributes>. */
function readScheme(xml) {
    const colors = {}
    const colorsBlock = xml.match(/<colors>([\s\S]*?)<\/colors>/)?.[1] || ''
    for (const m of colorsBlock.matchAll(/<option name="([^"]+)" value="([^"]*)"\s*\/>/g)) colors[m[1]] = m[2]
    const attributes = {}
    const attrBlock = xml.match(/<attributes>([\s\S]*?)<\/attributes>/)?.[1] || ''
    for (const m of attrBlock.matchAll(/<option name="([^"]+)"(?:\s+baseAttributes="([^"]+)")?\s*(?:\/>|>([\s\S]*?)<\/option>)/g)) {
        const v = {}
        if (m[3]) for (const o of m[3].matchAll(/<option name="([^"]+)" value="([^"]*)"\s*\/>/g)) v[o[1]] = o[2]
        attributes[m[1]] = {base: m[2], ...v}
    }
    return {colors, attributes}
}

const hex = (v) => {
    if (!v) return undefined
    v = v.replace(/^#/, '').toLowerCase()
    return '#' + (v.length > 6 ? v.padStart(8, '0') : v.padStart(6, '0'))
}

function attr(scheme, name, depth = 0) {
    const a = scheme.attributes[name]
    if (!a || depth > 8) return null
    if (!a.FOREGROUND && !a.BACKGROUND && a.base) return attr(scheme, a.base, depth + 1)
    return a
}

// JetBrains attribute (first one that exists) -> TextMate scopes. Later entries win over earlier ones for the same
// scope; TextMate also prefers the more specific scope.
const SYNTAX = [
    [['DEFAULT_IDENTIFIER', 'DEFAULT_LOCAL_VARIABLE'], ['variable', 'variable.other.readwrite', 'meta.definition.variable variable.other']],
    [['DEFAULT_OPERATION_SIGN'], ['keyword.operator', 'keyword.operator.assignment', 'keyword.operator.arithmetic', 'keyword.operator.logical', 'keyword.operator.comparison', 'keyword.operator.relational', 'keyword.operator.ternary', 'keyword.operator.optional', 'keyword.operator.spread', 'keyword.operator.type.annotation']],
    [['DEFAULT_BRACES', 'DEFAULT_PARENTHS'], ['punctuation', 'meta.brace', 'punctuation.definition.block', 'punctuation.definition.parameters', 'meta.brace.round', 'meta.brace.square', 'punctuation.definition.template-expression']],
    [['DEFAULT_DOT'], ['punctuation.accessor', 'punctuation.separator.period', 'punctuation.separator.dot']],
    [['DEFAULT_COMMA'], ['punctuation.separator.comma', 'punctuation.separator.parameter']],
    [['DEFAULT_SEMICOLON'], ['punctuation.terminator']],
    [['DEFAULT_KEYWORD'], ['keyword', 'keyword.control', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.new', 'keyword.operator.expression', 'keyword.operator.instanceof', 'keyword.operator.typeof', 'keyword.operator.delete', 'keyword.operator.in', 'keyword.operator.of', 'keyword.operator.void', 'variable.language', 'variable.language.this', 'variable.language.super', 'support.type.primitive', 'support.type.builtin', 'keyword.other']],
    [['DEFAULT_STRING'], ['string', 'punctuation.definition.string', 'string.template', 'string.quoted']],
    [['DEFAULT_VALID_STRING_ESCAPE'], ['constant.character.escape']],
    [['JS.REGEXP', 'DEFAULT_STRING'], ['string.regexp']],
    [['DEFAULT_NUMBER'], ['constant.numeric']],
    [['DEFAULT_CONSTANT'], ['constant.language', 'support.constant', 'variable.other.enummember']],
    [['DEFAULT_LINE_COMMENT'], ['comment', 'comment.line', 'punctuation.definition.comment']],
    [['DEFAULT_BLOCK_COMMENT'], ['comment.block']],
    [['DEFAULT_DOC_COMMENT'], ['comment.block.documentation']],
    [['DEFAULT_DOC_COMMENT_TAG'], ['storage.type.class.jsdoc', 'keyword.other.documentation', 'storage.type.class.doxygen']],
    [['JS.PARAMETER', 'DEFAULT_PARAMETER'], ['variable.parameter', 'meta.parameters variable']],
    [['JS.INSTANCE_MEMBER_VARIABLE', 'DEFAULT_INSTANCE_FIELD'], ['variable.other.property', 'variable.other.object.property', 'meta.object-literal.key', 'support.variable.property', 'variable.other.constant.property', 'entity.name.tag.yaml', 'support.type.property-name.json', 'meta.object.member']],
    [['DEFAULT_STATIC_FIELD'], ['variable.other.property.static']],
    [['DEFAULT_FUNCTION_DECLARATION'], ['entity.name.function', 'meta.definition.method entity.name.function', 'meta.definition.function entity.name.function']],
    [['JS.INSTANCE_MEMBER_FUNCTION', 'DEFAULT_FUNCTION_CALL'], ['meta.function-call entity.name.function', 'support.function', 'meta.method-call entity.name.function', 'entity.name.function.member']],
    [['DEFAULT_CLASS_NAME'], ['entity.name.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class', 'new.expr entity.name.type', 'entity.name.type.class', 'support.type']],
    [['DEFAULT_INTERFACE_NAME'], ['entity.name.type.interface']],
    [['TS.TYPE_PARAMETER'], ['entity.name.type.parameter']],
    [['DEFAULT_METADATA'], ['meta.decorator', 'punctuation.decorator', 'entity.name.function.decorator', 'storage.type.annotation']],
    [['DEFAULT_PREDEFINED_SYMBOL'], ['support.variable', 'support.function.builtin', 'variable.language.arguments']],
    [['HTML_TAG_NAME', 'DEFAULT_TAG'], ['entity.name.tag', 'punctuation.definition.tag']],
    [['HTML_ATTRIBUTE_NAME', 'DEFAULT_ATTRIBUTE'], ['entity.other.attribute-name']],
    [['CSS.PROPERTY_NAME'], ['support.type.property-name', 'support.type.property-name.css', 'meta.property-name']],
    [['CSS.PROPERTY_VALUE'], ['support.constant.property-value', 'meta.property-value']],
    [['MARKDOWN_HEADER_LEVEL_1', 'DEFAULT_KEYWORD'], ['markup.heading', 'entity.name.section', 'punctuation.definition.heading']],
    [['MARKDOWN_CODE_SPAN', 'DEFAULT_STRING'], ['markup.inline.raw', 'markup.raw']],
    [['MARKDOWN_LINK_TEXT', 'DEFAULT_FUNCTION_CALL'], ['markup.underline.link', 'string.other.link']],
    [['MARKDOWN_BOLD'], ['markup.bold']],
    [['MARKDOWN_ITALIC'], ['markup.italic']],
    [['MARKDOWN_BLOCK_QUOTE', 'DEFAULT_LINE_COMMENT'], ['markup.quote']],
]

function fontStyle(a) {
    const t = +(a.FONT_TYPE || 0)
    return [t & 2 ? 'italic' : '', t & 1 ? 'bold' : ''].filter(Boolean).join(' ')
}

function syntaxRules(scheme) {
    const rules = []
    for (const [names, scopes] of SYNTAX) {
        const a = names.map((n) => attr(scheme, n)).find((x) => x?.FOREGROUND)
        if (!a) continue
        rules.push({scope: scopes, settings: {foreground: hex(a.FOREGROUND), fontStyle: fontStyle(a)}})
    }
    // the arrow of an arrow function: keyword color, upright (as the IDE shows it)
    const kw = attr(scheme, 'DEFAULT_KEYWORD')
    if (kw?.FOREGROUND) rules.push({scope: ['storage.type.function.arrow'], settings: {foreground: hex(kw.FOREGROUND), fontStyle: ''}})
    return rules
}

/** `c` over `bg` at `alpha`, as a hex color (the IDE softens a modified block's lines this way). */
function blend(c, bg, alpha) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const [a, b] = [p(c), p(bg)]
    return '#' + a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')
}

const themes = []
for (const v of VARIANTS) {
    const ui = JSON.parse(fs.readFileSync(path.join(res, `themes/regular/Material ${v}.theme.json`), 'utf8'))
    const scheme = readScheme(fs.readFileSync(path.join(res, `colors/Material ${v}.xml`), 'utf8'))
    const c = ui.colors
    const sc = scheme.colors
    const text = attr(scheme, 'TEXT') || {}
    const bg = hex(text.BACKGROUND) || c.bg.toLowerCase()
    const diff = (n) => attr(scheme, n) || {}
    // a translucent scheme color (#rrggbbaa) flattened onto the editor background
    const solid = (h) => (h && h.length === 9 ? blend(h.slice(0, 7), bg, parseInt(h.slice(7), 16) / 255) : h)
    const mod = solid(hex(diff('DIFF_MODIFIED').BACKGROUND)), ins = solid(hex(diff('DIFF_INSERTED').BACKGROUND)), del = solid(hex(diff('DIFF_DELETED').BACKGROUND))
    themes.push({
        id: 'material-' + v.toLowerCase().replace(/\s+/g, '-'),
        name: `Material ${v}`,
        dark: !!ui.dark,
        // the UI palette, as the plugin names it
        ui: Object.fromEntries(Object.entries(c).map(([k, val]) => [k, val.length === 9 ? val : val.toLowerCase()])),
        editor: {
            bg,
            fg: hex(text.FOREGROUND) || c.white,
            gutter: hex(sc.GUTTER_BACKGROUND) || bg,
            lineNumber: hex(sc.LINE_NUMBERS_COLOR),
            lineNumberCaret: hex(sc.LINE_NUMBER_ON_CARET_ROW_COLOR),
            selection: solid(hex(sc.SELECTION_BACKGROUND)),
            caret: hex(sc.CARET_COLOR),
            caretRow: solid(hex(sc.CARET_ROW_COLOR)),
            indentGuide: hex(sc.INDENT_GUIDE),
            separator: hex(sc.TEARLINE_COLOR) || hex(sc.INDENT_GUIDE),
            collapsed: solid(hex(sc.DIFF_SEPARATORS_BACKGROUND)),
        },
        status: {
            added: hex(sc.MT_FILESTATUS_ADDED), modified: hex(sc.MT_FILESTATUS_MODIFIED), deleted: hex(sc.MT_FILESTATUS_DELETED),
            renamed: hex(sc.MT_FILESTATUS_RENAMED) || hex(sc.MT_FILESTATUS_MODIFIED),
        },
        diff: {
            modified: blend(mod, bg, ui.dark ? 0.35 : 0.45), modifiedWord: mod,
            inserted: ins, insertedWord: ins, deleted: del, deletedWord: del,
            modifiedRuler: hex(diff('DIFF_MODIFIED').ERROR_STRIPE_COLOR), insertedRuler: hex(diff('DIFF_INSERTED').ERROR_STRIPE_COLOR),
            deletedRuler: hex(diff('DIFF_DELETED').ERROR_STRIPE_COLOR),
        },
        tokens: syntaxRules(scheme),
    })
}

const out = `// Generated by tools/material-themes.mjs from Material Theme UI Lite (https://github.com/AtomMaterialUI/material-theme-ui-lite).
// Do not edit by hand.
//
// The MIT License (MIT). Copyright (c) 2015-2023 Elior "Mallowigi" Boukhobza.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice
// and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS
// PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

export const THEMES = [
${themes.map((t) => JSON.stringify(t)).join(',\n')},
]
`
fs.writeFileSync(new URL('../js/themes.js', import.meta.url), out)
console.log(themes.map((t) => `${t.name}: bg ${t.editor.bg}, diff ${t.diff.modifiedWord} ${t.diff.inserted} ${t.diff.deleted}, ${t.tokens.length} syntax rules`).join('\n'))
