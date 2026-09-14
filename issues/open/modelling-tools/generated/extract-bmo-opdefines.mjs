#!/usr/bin/env node
/**
 * extract-bmo-opdefines.mjs
 *
 * Extracts the BMesh operator definition table from Blender's C++ source and emits:
 *   - bmo-opdefines.json   raw extracted data (the artifact reviewers diff)
 *   - bmo-ops.schema.ts    generated TS operator/slot/enum table
 *   - bmo-ops.types.ts     generated TS `<Op>Params` / `<Op>Result` interfaces
 *
 * Source of truth (never guess, always parse):
 *   source/blender/bmesh/intern/bmesh_opdefines.cc      operator table + shared enum tables
 *   source/blender/bmesh/intern/bmesh_operator_api.hh   eBMOpSlotType / subtype enums, BMOpTypeFlag
 *   source/blender/bmesh/bmesh_class.hh                 BM_VERT / BM_EDGE / BM_LOOP / BM_FACE
 *   any header under source/blender                      symbolic enum-table values (MOD_TRIANGULATE_*, ...)
 *   source/blender/bmesh/{intern,operators,tools}/*.cc   BMOpDefine `init` callbacks, for sourced defaults
 *
 * Parsing conventions follow Blender's own doc generator,
 * `doc/python_api/rst_from_bmesh_opdefines.py` (read it before changing this file):
 *   - the block comment directly above a `static BMOpDefine ...` is the operator doc (reStructuredText,
 *     first line = title, following blank-line-separated blocks = paragraphs)
 *   - a slot's doc is the block comment on its own line directly above it, or the inline block comment
 *     directly after it on the same line
 *   - `//` comments are ignored
 *   - `{0, nullptr}` is the enum-table sentinel
 * Unlike that script this one is token-based rather than line-based, so odd wrapping is handled, and
 * anything it cannot resolve unambiguously is a hard error rather than silently-wrong data.
 *
 * Usage:
 *   node extract-bmo-opdefines.mjs [--blender-root <dir>] [--out-dir <dir>] [--check]
 *   --blender-root  default: ../../../../../blender relative to this file, else $BLENDER_SRC
 *   --out-dir       default: the directory containing this script
 *   --check         parse + validate only, write nothing
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
    const out = {blenderRoot: null, outDir: THIS_DIR, check: false}
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--blender-root') out.blenderRoot = argv[++i]
        else if (a === '--out-dir') out.outDir = argv[++i]
        else if (a === '--check') out.check = true
        else if (a === '--help' || a === '-h') {
            process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0] + '*/\n')
            process.exit(0)
        } else fail(`unknown argument: ${a}`)
    }
    return out
}

function fail(msg) {
    // Fail loudly: this generator must never emit half-understood data.
    console.error('\n[extract-bmo-opdefines] FATAL: ' + msg + '\n')
    process.exit(1)
}

const warnings = []
function warn(msg) {
    warnings.push(msg)
    console.error('[extract-bmo-opdefines] warning: ' + msg)
}

function resolveBlenderRoot(explicit) {
    const candidates = [
        explicit,
        process.env.BLENDER_SRC,
        // this file lives at <repo>/issues/open/modelling-tools/generated/, blender clone at <repo>/../blender
        path.resolve(THIS_DIR, '../../../../../blender'),
        path.resolve(THIS_DIR, '../../../../.repos/blender'),
    ].filter(Boolean)
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'source/blender/bmesh/intern/bmesh_opdefines.cc'))) return path.resolve(c)
    }
    fail(
        'could not locate a Blender source tree containing source/blender/bmesh/intern/bmesh_opdefines.cc.\n' +
        'tried:\n  ' + candidates.join('\n  ') + '\n' +
        'pass --blender-root <dir> or set $BLENDER_SRC.'
    )
}

// ---------------------------------------------------------------------------------------------
// Tokenizer (C/C++ subset: enough for declarative initializer tables)
// ---------------------------------------------------------------------------------------------

const PUNCT3 = ['<<=', '>>=']
const PUNCT2 = ['<<', '>>', '->', '::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=']

/**
 * @returns {{t:string,v:string,line:number,start:number,end:number,ownLine?:boolean}[]}
 *   t: 'comment' | 'str' | 'chr' | 'id' | 'num' | 'punct'
 *   comment.v is the raw text between the delimiters; comment.ownLine is true when only whitespace
 *   precedes it on its line (Blender's convention for "this comment documents the next thing").
 */
function tokenize(src, file) {
    const toks = []
    let i = 0
    let line = 1
    const nl = (s) => {
        for (let k = 0; k < s.length; k++) if (s[k] === '\n') line++
    }
    while (i < src.length) {
        const c = src[i]
        if (c === '\n') { line++; i++; continue }
        if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue }
        // line comment
        if (c === '/' && src[i + 1] === '/') {
            const e = src.indexOf('\n', i)
            i = e < 0 ? src.length : e
            continue
        }
        // block comment
        if (c === '/' && src[i + 1] === '*') {
            const e = src.indexOf('*/', i + 2)
            if (e < 0) fail(`${file}:${line}: unterminated block comment`)
            const raw = src.slice(i + 2, e)
            const ls = src.lastIndexOf('\n', i - 1) + 1
            const ownLine = src.slice(ls, i).trim() === ''
            toks.push({t: 'comment', v: raw, line, start: i, end: e + 2, ownLine})
            nl(src.slice(i, e + 2))
            i = e + 2
            continue
        }
        // preprocessor directive: skip the whole logical line (handles `\` continuations).
        // Macros are irrelevant to the declarative tables; `#define`s are collected separately
        // by collectSymbols() which runs its own directive-aware pass.
        if (c === '#') {
            let e = i
            for (;;) {
                const n = src.indexOf('\n', e)
                if (n < 0) { e = src.length; break }
                if (src[n - 1] === '\\') { e = n + 1; continue }
                e = n
                break
            }
            nl(src.slice(i, e))
            i = e
            continue
        }
        // string literal
        if (c === '"') {
            let j = i + 1
            while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
            if (j >= src.length) fail(`${file}:${line}: unterminated string literal`)
            toks.push({t: 'str', v: unescapeC(src.slice(i + 1, j)), line, start: i, end: j + 1})
            i = j + 1
            continue
        }
        // char literal
        if (c === "'") {
            let j = i + 1
            while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1
            if (j >= src.length) fail(`${file}:${line}: unterminated char literal`)
            toks.push({t: 'chr', v: src.slice(i + 1, j), line, start: i, end: j + 1})
            i = j + 1
            continue
        }
        // identifier
        if (/[A-Za-z_]/.test(c)) {
            let j = i + 1
            while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
            toks.push({t: 'id', v: src.slice(i, j), line, start: i, end: j})
            i = j
            continue
        }
        // number
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i
            while (j < src.length && /[0-9a-fA-FxXoObB.]/.test(src[j])) j++
            // exponent
            if (/[eE]/.test(src[j - 1] || '') && /[+-]/.test(src[j] || '')) {
                j++
                while (j < src.length && /[0-9]/.test(src[j])) j++
            }
            while (j < src.length && /[uUlLfF]/.test(src[j])) j++
            toks.push({t: 'num', v: src.slice(i, j), line, start: i, end: j})
            i = j
            continue
        }
        // punctuation
        const p3 = src.substr(i, 3)
        const p2 = src.substr(i, 2)
        let p = c
        if (PUNCT3.includes(p3)) p = p3
        else if (PUNCT2.includes(p2)) p = p2
        toks.push({t: 'punct', v: p, line, start: i, end: i + p.length})
        i += p.length
    }
    return toks
}

function unescapeC(s) {
    return s.replace(/\\(.)/g, (_, ch) => ({n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'"}[ch] ?? ch))
}

// ---------------------------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------------------------

const OPEN = {'{': '}', '(': ')', '[': ']'}
const CLOSE = {'}': '{', ')': '(', ']': '['}

/** index of the bracket matching toks[i] (which must be an opening bracket) */
function matchBracket(toks, i, file) {
    const open = toks[i].v
    const close = OPEN[open]
    if (!close) fail(`${file}:${toks[i].line}: expected an opening bracket, got ${JSON.stringify(open)}`)
    let depth = 0
    for (let j = i; j < toks.length; j++) {
        const t = toks[j]
        if (t.t !== 'punct') continue
        if (OPEN[t.v]) depth++
        else if (CLOSE[t.v]) {
            depth--
            if (depth === 0) {
                if (t.v !== close) fail(`${file}:${t.line}: mismatched bracket, expected ${close} got ${t.v}`)
                return j
            }
        }
    }
    fail(`${file}:${toks[i].line}: unterminated ${open}`)
}

/**
 * Split the token range [start, end) on top-level commas.
 * Returns items with their leading own-line comments and a trailing same-line comment, following
 * Blender's rst_from_bmesh_opdefines.py doc-attachment convention.
 */
function splitTopLevel(toks, start, end, file) {
    const items = []
    let pending = [] // comments seen after an item's tokens but before its terminating comma
    let cur = {toks: [], leading: [], trailing: null}
    let depth = 0
    const newItem = () => {
        const it = {toks: [], leading: pending, trailing: null}
        pending = []
        return it
    }
    cur = newItem()
    for (let j = start; j < end; j++) {
        const t = toks[j]
        if (t.t === 'comment') {
            if (depth !== 0) continue // comments inside a nested group belong to that group's own split
            if (cur.toks.length === 0) cur.leading.push(t)
            else if (!t.ownLine && t.line === cur.toks[cur.toks.length - 1].line) cur.trailing = t
            else pending.push(t) // documents whatever follows the upcoming comma
            continue
        }
        if (t.t === 'punct' && OPEN[t.v]) depth++
        else if (t.t === 'punct' && CLOSE[t.v]) depth--
        if (t.t === 'punct' && t.v === ',' && depth === 0) {
            // a same-line block comment right after the comma documents the item just closed
            const k = j + 1
            if (k < end && toks[k].t === 'comment' && !toks[k].ownLine && toks[k].line === t.line) {
                cur.trailing = toks[k]
                j = k // consume it so it does not become the next item's leading comment
            }
            items.push(cur)
            cur = newItem()
            continue
        }
        cur.toks.push(t)
    }
    if (cur.toks.length || cur.leading.length) items.push(cur)
    return items.filter((it) => it.toks.length > 0)
}

/** Doc text for an item: own-line leading comment (preferred) or the inline trailing one. */
function itemDoc(item) {
    const lead = item.leading.filter((c) => c.ownLine)
    const c = lead.length ? lead[lead.length - 1] : item.trailing
    if (!c) return ''
    return washComment(c.v)
}

/** Strip C block-comment decoration, keeping reStructuredText content. */
function washComment(raw) {
    let lines = raw.split('\n')
    // single-line comment: `/* text */`
    if (lines.length === 1) return lines[0].trim()
    // drop the leading ` * ` decoration of each continuation line
    lines = lines.map((l, idx) => (idx === 0 ? l.trim() : l.replace(/^\s*\*[ \t]?/, '').replace(/\s+$/, '')))
    while (lines.length && lines[0].trim() === '') lines.shift()
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    return lines.join('\n')
}

/** Markers such as `/*opname*``/` - single bare word comments used as C designated-field labels. */
function fieldMarker(item) {
    for (const c of item.leading) {
        const v = c.v.trim()
        if (/^[a-z_]+$/.test(v)) return v
    }
    return null
}

function srcText(src, toks) {
    if (!toks.length) return ''
    return src.slice(toks[0].start, toks[toks.length - 1].end)
}

// ---------------------------------------------------------------------------------------------
// Symbol table (C enum constants + object-like #defines), built by parsing headers
// ---------------------------------------------------------------------------------------------

class Symbols {
    constructor() {
        /** name -> {tokens, file, value?} */
        this.defs = new Map()
        this.cache = new Map()
        this.sources = new Map()
    }

    has(name) {
        return this.defs.has(name)
    }

    /** record a symbol; conflicting redefinitions with a different value are a hard error */
    add(name, tokens, file) {
        if (this.defs.has(name)) {
            const prev = this.defs.get(name)
            if (prev.file === file) return // include guards / duplicate scan
            // resolve both and compare; only complain when they actually differ
            let a = null
            let b = null
            try { a = this.resolveTokens(prev.tokens, prev.file) } catch { /* unresolvable */ }
            try { b = this.resolveTokens(tokens, file) } catch { /* unresolvable */ }
            if (a !== null && b !== null && a !== b) {
                fail(
                    `conflicting definitions for ${name}: ${a} (${prev.file}) vs ${b} (${file}).\n` +
                    'Narrow the header scan or disambiguate before regenerating.'
                )
            }
            return
        }
        this.defs.set(name, {tokens, file})
    }

    resolve(name, stack = []) {
        if (this.cache.has(name)) return this.cache.get(name)
        const d = this.defs.get(name)
        if (!d) return null
        if (stack.includes(name)) fail(`cyclic symbol definition: ${[...stack, name].join(' -> ')}`)
        const v = this.resolveTokens(d.tokens, d.file, [...stack, name])
        this.cache.set(name, v)
        this.sources.set(name, d.file)
        return v
    }

    resolveTokens(tokens, file, stack = []) {
        return evalExpr(tokens, file, (n) => this.resolve(n, stack))
    }
}

/**
 * Evaluate a C constant expression over `|`, `&`, `^`, `<<`, `>>`, `+`, `-`, `*`, `/`, parentheses
 * and brace-grouping (`{X}` initializers). Identifiers resolve through `lookup`.
 * Unknown identifiers used as *functions* or as *casts* are treated as the identity transform
 * (this is how `to_subtype_union(X)`, `eBMOpSlotSubType_Elem(X)` and `(int)X` appear in the source).
 * Anything else unknown throws - callers turn that into a hard failure.
 */
function evalExpr(tokens, file, lookup) {
    // Drop wrapper calls and casts around unknown identifiers.
    const ts = tokens.filter((t) => t.t !== 'comment')
    let pos = 0

    const peek = () => ts[pos]
    const at = (v) => ts[pos] && ts[pos].t === 'punct' && ts[pos].v === v

    function parsePrimary() {
        const t = ts[pos]
        if (!t) throw new Error(`${file}: unexpected end of expression`)
        if (t.t === 'punct' && (t.v === '(' || t.v === '{')) {
            const close = OPEN[t.v]
            // is this a cast `( TYPE ) expr`?
            if (t.v === '(' && ts[pos + 1] && ts[pos + 1].t === 'id' && ts[pos + 2] && ts[pos + 2].t === 'punct' && ts[pos + 2].v === ')') {
                const nameTok = ts[pos + 1]
                const after = ts[pos + 3]
                const isValue = lookup(nameTok.v) !== null
                const castFollowedByExpr = after && (after.t === 'id' || after.t === 'num' || (after.t === 'punct' && (after.v === '(' || after.v === '{')))
                if (!isValue && castFollowedByExpr) {
                    pos += 3 // consume `( TYPE )`
                    return parseUnary()
                }
            }
            pos++
            const v = parseExpr()
            if (!at(close)) throw new Error(`${file}:${t.line}: expected ${close} in expression`)
            pos++
            return v
        }
        if (t.t === 'num') {
            pos++
            const raw = t.v.replace(/[uUlLfF]+$/, '')
            const n = raw.startsWith('0x') || raw.startsWith('0X') ? parseInt(raw, 16) : Number(raw)
            if (!Number.isFinite(n)) throw new Error(`${file}:${t.line}: bad numeric literal ${t.v}`)
            return n
        }
        if (t.t === 'id') {
            const next = ts[pos + 1]
            if (next && next.t === 'punct' && next.v === '(') {
                // function-like: identity wrapper (to_subtype_union / eBMOpSlotSubType_Elem / ...)
                if (lookup(t.v) !== null) throw new Error(`${file}:${t.line}: ${t.v} is both a constant and called as a function`)
                pos++
                return parsePrimary() // parses the parenthesised group
            }
            const v = lookup(t.v)
            if (v === null || v === undefined) throw new Error(`${file}:${t.line}: unresolved identifier ${t.v}`)
            pos++
            return v
        }
        throw new Error(`${file}:${t.line}: unexpected token ${JSON.stringify(t.v)} in expression`)
    }

    function parseUnary() {
        const t = peek()
        if (t && t.t === 'punct' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
            pos++
            const v = parseUnary()
            return t.v === '-' ? -v : t.v === '+' ? v : t.v === '~' ? ~v : v ? 0 : 1
        }
        return parsePrimary()
    }

    function binary(nextFn, ops) {
        return function () {
            let left = nextFn()
            while (peek() && peek().t === 'punct' && ops.includes(peek().v)) {
                const op = ts[pos++].v
                const right = nextFn()
                switch (op) {
                    case '*': left = left * right; break
                    case '/': left = Math.trunc(left / right); break
                    case '%': left = left % right; break
                    case '+': left = left + right; break
                    case '-': left = left - right; break
                    case '<<': left = left << right; break
                    case '>>': left = left >> right; break
                    case '&': left = left & right; break
                    case '^': left = left ^ right; break
                    case '|': left = left | right; break
                    default: throw new Error(`${file}: unsupported operator ${op}`)
                }
            }
            return left
        }
    }

    const pMul = binary(parseUnary, ['*', '/', '%'])
    const pAdd = binary(pMul, ['+', '-'])
    const pShift = binary(pAdd, ['<<', '>>'])
    const pAnd = binary(pShift, ['&'])
    const pXor = binary(pAnd, ['^'])
    const pOr = binary(pXor, ['|'])
    function parseExpr() {
        return pOr()
    }

    const v = parseExpr()
    if (pos !== ts.length) throw new Error(`${file}: trailing tokens in expression: ${ts.slice(pos).map((t) => t.v).join(' ')}`)
    return v
}

/** Parse every `enum [class] [Name] [: type] { ... };` body and every object-like `#define` in a file. */
function collectSymbols(symbols, file, wanted /* Set|null */) {
    const src = fs.readFileSync(file, 'utf8')

    // object-like #defines (the tokenizer skips directives, so scan them textually)
    const defineRe = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+(.+)$/gm
    let m
    while ((m = defineRe.exec(src))) {
        const name = m[1]
        if (wanted && !wanted.has(name)) continue
        let body = m[2]
        if (body.trimEnd().endsWith('\\')) continue // multi-line macro, skip
        body = body.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim()
        if (!body) continue
        const bt = tokenize(body, file)
        if (!bt.length) continue
        symbols.add(name, bt, file)
    }

    const toks = tokenize(src, file)
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i]
        if (!(t.t === 'id' && t.v === 'enum')) continue
        // enum [class|struct] [Name] [: underlying] {
        let j = i + 1
        if (toks[j] && toks[j].t === 'id' && (toks[j].v === 'class' || toks[j].v === 'struct')) j++
        if (toks[j] && toks[j].t === 'id') j++
        if (toks[j] && toks[j].t === 'punct' && toks[j].v === ':') {
            j++
            while (toks[j] && (toks[j].t === 'id' || (toks[j].t === 'punct' && toks[j].v === '::'))) j++
        }
        if (!(toks[j] && toks[j].t === 'punct' && toks[j].v === '{')) continue
        const close = matchBracket(toks, j, file)
        const items = splitTopLevel(toks, j + 1, close, file)
        let counter = 0
        for (const item of items) {
            const its = item.toks
            if (!its.length || its[0].t !== 'id') continue
            const name = its[0].v
            let valueTokens = null
            if (its[1] && its[1].t === 'punct' && its[1].v === '=') valueTokens = its.slice(2)
            if (valueTokens && valueTokens.length) {
                if (!wanted || wanted.has(name)) symbols.add(name, valueTokens, file)
                // keep the implicit counter correct for following entries
                let v = null
                try { v = symbols.resolveTokens(valueTokens, file) } catch { /* later */ }
                counter = v === null ? counter + 1 : v + 1
            } else {
                const numTok = [{t: 'num', v: String(counter), line: its[0].line, start: its[0].start, end: its[0].end}]
                if (!wanted || wanted.has(name)) symbols.add(name, numTok, file)
                counter++
            }
        }
        i = close
    }
}

function listHeaders(dir) {
    const out = []
    const walk = (d) => {
        let entries
        try { entries = fs.readdirSync(d, {withFileTypes: true}) } catch { return }
        for (const e of entries) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) walk(p)
            else if (/\.(h|hh|hpp)$/.test(e.name)) out.push(p)
        }
    }
    walk(dir)
    out.sort()
    return out
}

function listSources(dir) {
    const out = []
    const walk = (d) => {
        let entries
        try { entries = fs.readdirSync(d, {withFileTypes: true}) } catch { return }
        for (const e of entries) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) walk(p)
            else if (/\.(c|cc|cpp)$/.test(e.name)) out.push(p)
        }
    }
    walk(dir)
    out.sort()
    return out
}

// ---------------------------------------------------------------------------------------------
// bmesh_opdefines.cc parsing
// ---------------------------------------------------------------------------------------------

function parseOpdefines(src, file) {
    const toks = tokenize(src, file)
    const enumTables = []
    const ops = []
    let opdefinesOrder = null

    for (let i = 0; i < toks.length; i++) {
        const t = toks[i]
        if (!(t.t === 'id' && t.v === 'static')) {
            // `BMOpDefine *bmo_opdefines[] = { ... };` - the registration order / completeness list
            if (t.t === 'id' && t.v === 'bmo_opdefines' && toks[i + 1] && toks[i + 1].v === '[') {
                let j = i + 1
                while (toks[j] && !(toks[j].t === 'punct' && toks[j].v === '{')) {
                    if (toks[j].t === 'punct' && toks[j].v === ';') break
                    j++
                }
                if (toks[j] && toks[j].v === '{') {
                    const close = matchBracket(toks, j, file)
                    opdefinesOrder = splitTopLevel(toks, j + 1, close, file)
                        .map((it) => it.toks.filter((x) => x.t === 'id').map((x) => x.v).join(''))
                        .filter(Boolean)
                    i = close
                }
            }
            continue
        }
        const kind = toks[i + 1]
        if (!kind || kind.t !== 'id') continue

        if (kind.v === 'BMO_FlagSet') {
            const nameTok = toks[i + 2]
            if (!nameTok || nameTok.t !== 'id') continue
            let j = i + 3
            while (toks[j] && !(toks[j].t === 'punct' && toks[j].v === '{')) j++
            const close = matchBracket(toks, j, file)
            const entries = []
            for (const item of splitTopLevel(toks, j + 1, close, file)) {
                const inner = item.toks
                if (!(inner[0] && inner[0].t === 'punct' && inner[0].v === '{')) {
                    fail(`${file}:${inner[0] && inner[0].line}: unexpected entry in enum table ${nameTok.v}`)
                }
                const iclose = matchBracket(inner, 0, file)
                const fields = splitTopLevel(inner, 1, iclose, file)
                if (fields.length !== 2) fail(`${file}:${inner[0].line}: enum table ${nameTok.v} entry must be {value, "name"}`)
                const idTok = fields[1].toks
                // sentinel {0, nullptr}
                if (idTok.length === 1 && idTok[0].t === 'id' && (idTok[0].v === 'nullptr' || idTok[0].v === 'NULL')) continue
                if (!(idTok.length === 1 && idTok[0].t === 'str')) {
                    fail(`${file}:${idTok[0].line}: enum table ${nameTok.v} identifier must be a string literal`)
                }
                entries.push({name: idTok[0].v, valueTokens: fields[0].toks, valueSrc: srcText(src, fields[0].toks)})
            }
            enumTables.push({cName: nameTok.v, line: nameTok.line, entries})
            i = close
            continue
        }

        if (kind.v === 'BMOpDefine') {
            const nameTok = toks[i + 2]
            if (!nameTok || nameTok.t !== 'id') continue
            if (!(toks[i + 3] && toks[i + 3].t === 'punct' && toks[i + 3].v === '=')) continue
            const braceIdx = i + 4
            if (!(toks[braceIdx] && toks[braceIdx].t === 'punct' && toks[braceIdx].v === '{')) {
                fail(`${file}:${nameTok.line}: expected '{' after ${nameTok.v} =`)
            }
            const close = matchBracket(toks, braceIdx, file)

            // operator doc = the block comment immediately preceding `static`
            let doc = ''
            const prev = toks[i - 1]
            if (prev && prev.t === 'comment' && prev.ownLine) doc = washComment(prev.v)
            else warn(`${file}:${nameTok.line}: ${nameTok.v} has no doc comment`)

            const members = splitTopLevel(toks, braceIdx + 1, close, file)
            const EXPECTED = ['opname', 'slot_types_in', 'slot_types_out', 'init', 'exec', 'type_flag']
            if (members.length !== EXPECTED.length) {
                fail(
                    `${file}:${nameTok.line}: ${nameTok.v} has ${members.length} initializer members, expected ${EXPECTED.length} ` +
                    `(struct BMOpDefine changed? update this script)`
                )
            }
            members.forEach((m, idx) => {
                const marker = fieldMarker(m)
                if (marker && marker !== EXPECTED[idx]) {
                    fail(`${file}:${m.toks[0].line}: ${nameTok.v} member ${idx} labelled /*${marker}*/ but expected /*${EXPECTED[idx]}*/`)
                }
            })

            const [mName, mIn, mOut, mInit, mExec, mFlags] = members
            if (!(mName.toks.length === 1 && mName.toks[0].t === 'str')) {
                fail(`${file}:${nameTok.line}: ${nameTok.v} opname is not a plain string literal`)
            }
            const opname = mName.toks[0].v

            const parseIdentOrNull = (m, what) => {
                const ts = m.toks
                if (ts.length === 1 && ts[0].t === 'id') {
                    if (ts[0].v === 'nullptr' || ts[0].v === 'NULL') return null
                    return ts[0].v
                }
                fail(`${file}:${ts[0].line}: ${nameTok.v} ${what} must be a plain function name or nullptr`)
            }

            ops.push({
                name: opname,
                cName: nameTok.v,
                line: nameTok.line,
                doc,
                slotsIn: parseSlotList(src, mIn.toks, file, `${opname}.slot_types_in`),
                slotsOut: parseSlotList(src, mOut.toks, file, `${opname}.slot_types_out`),
                initC: parseIdentOrNull(mInit, 'init'),
                execC: parseIdentOrNull(mExec, 'exec'),
                typeFlagTokens: mFlags.toks,
                typeFlagSrc: srcText(src, mFlags.toks),
            })
            i = close
            continue
        }
    }

    return {enumTables, ops, opdefinesOrder}
}

/** Parse a `{ {"name", TYPE[, SUBTYPE][, enum_table]}, ..., {{'\0'}} }` slot array. */
function parseSlotList(src, toks, file, where) {
    if (!(toks[0] && toks[0].t === 'punct' && toks[0].v === '{')) {
        fail(`${file}:${toks[0] && toks[0].line}: ${where} is not a brace-initialised array`)
    }
    const close = matchBracket(toks, 0, file)
    if (close !== toks.length - 1) fail(`${file}:${toks[0].line}: ${where} has trailing tokens after '}'`)
    const items = splitTopLevel(toks, 1, close, file)
    const slots = []
    let sawTerminator = false
    for (const item of items) {
        const its = item.toks
        if (!(its[0] && its[0].t === 'punct' && its[0].v === '{')) {
            fail(`${file}:${its[0] && its[0].line}: ${where}: slot entry is not brace-initialised`)
        }
        const iclose = matchBracket(its, 0, file)
        if (iclose !== its.length - 1) fail(`${file}:${its[0].line}: ${where}: trailing tokens in slot entry`)
        const fields = splitTopLevel(its, 1, iclose, file)
        // terminator: `{{'\0'}}`
        if (fields.length === 1 && fields[0].toks[0] && fields[0].toks[0].t === 'punct' && fields[0].toks[0].v === '{') {
            const inner = fields[0].toks
            const hasNul = inner.some((x) => x.t === 'chr' && (x.v === '\\0' || x.v === '\\x00'))
            if (!hasNul) fail(`${file}:${inner[0].line}: ${where}: unrecognised slot-array terminator ${srcText(src, inner)}`)
            sawTerminator = true
            continue
        }
        if (sawTerminator) fail(`${file}:${its[0].line}: ${where}: slot entry after the {{'\\0'}} terminator`)
        if (fields.length < 2 || fields.length > 4) {
            fail(`${file}:${its[0].line}: ${where}: slot entry has ${fields.length} fields, expected 2..4`)
        }
        const nameToks = fields[0].toks
        if (!(nameToks.length === 1 && nameToks[0].t === 'str')) {
            fail(`${file}:${nameToks[0].line}: ${where}: slot name is not a plain string literal`)
        }
        slots.push({
            name: nameToks[0].v,
            line: nameToks[0].line,
            typeTokens: fields[1].toks,
            typeSrc: srcText(src, fields[1].toks),
            subtypeTokens: fields[2] ? fields[2].toks : null,
            subtypeSrc: fields[2] ? srcText(src, fields[2].toks) : null,
            enumTokens: fields[3] ? fields[3].toks : null,
            doc: itemDoc(item),
        })
    }
    if (!sawTerminator) fail(`${file}: ${where}: missing {{'\\0'}} terminator`)
    return slots
}

// ---------------------------------------------------------------------------------------------
// `init` callbacks -> sourced defaults
// ---------------------------------------------------------------------------------------------

const SLOT_SET_FNS = {
    BMO_slot_bool_set: 'bool',
    BMO_slot_int_set: 'int',
    BMO_slot_float_set: 'float',
    BMO_slot_ptr_set: 'ptr',
    BMO_slot_vec_set: 'vec3',
    BMO_slot_mat_set: 'mat4',
}

/** Find `void <fn>(BMOperator *op) { ... }` and extract the BMO_slot_*_set calls it makes. */
function parseInitFns(bmeshDir, wantedFns) {
    const found = new Map()
    if (!wantedFns.size) return found
    for (const file of listSources(bmeshDir)) {
        const src = fs.readFileSync(file, 'utf8')
        if (![...wantedFns].some((fn) => src.includes(fn))) continue
        const toks = tokenize(src, file)
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i]
            if (t.t !== 'id' || !wantedFns.has(t.v)) continue
            if (!(toks[i + 1] && toks[i + 1].v === '(')) continue
            const pclose = matchBracket(toks, i + 1, file)
            if (!(toks[pclose + 1] && toks[pclose + 1].v === '{')) continue // prototype, not definition
            const bclose = matchBracket(toks, pclose + 1, file)
            const defaults = []
            for (let j = pclose + 1; j < bclose; j++) {
                const c = toks[j]
                if (c.t !== 'id' || !SLOT_SET_FNS[c.v]) continue
                if (!(toks[j + 1] && toks[j + 1].v === '(')) continue
                const ac = matchBracket(toks, j + 1, file)
                const args = splitTopLevel(toks, j + 2, ac, file)
                // (op->slots_in, "name", value...) or (op, "name", value...)
                const nameArg = args.find((a) => a.toks.length === 1 && a.toks[0].t === 'str')
                if (!nameArg) continue
                const idx = args.indexOf(nameArg)
                const valArgs = args.slice(idx + 1)
                defaults.push({
                    slot: nameArg.toks[0].v,
                    kind: SLOT_SET_FNS[c.v],
                    valueSrc: valArgs.map((a) => srcText(src, a.toks)).join(', '),
                    line: c.line,
                })
                j = ac
            }
            found.set(t.v, {file, line: t.line, defaults})
        }
    }
    return found
}

// ---------------------------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------------------------

/**
 * Blender name -> TypeScript name.
 *
 *  1. a trailing `.out` or `.in` qualifier is removed (slot names only; the untouched Blender name
 *     is always kept in the table as `name`)
 *  2. the remainder is split on `_` and `.`
 *  3. the first part stays lower-case, every later part gets its first character upper-cased
 *
 *  extrude_face_region -> extrudeFaceRegion, use_normal_flip -> useNormalFlip,
 *  faces.out -> faces, geom_split.out -> geomSplit, edge_face.in -> edgeFace, radius1 -> radius1
 *
 * The rule is reversible: tsNameToBlender() below re-inserts `_` before every upper-case letter and
 * lower-cases it. Every generated name is round-trip checked; a failure is a hard error.
 */
function toTsName(blenderName) {
    const base = blenderName.replace(/\.(out|in)$/, '')
    const parts = base.split(/[_.]/).filter((p) => p.length > 0)
    if (!parts.length) fail(`cannot derive a tsName from ${JSON.stringify(blenderName)}`)
    return parts[0].toLowerCase() + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join('')
}

function tsNameToBlender(tsName) {
    return tsName.replace(/([A-Z])/g, (_, c) => '_' + c.toLowerCase())
}

/** PascalCase for interface names */
function toPascal(tsName) {
    return tsName[0].toUpperCase() + tsName.slice(1)
}

// ---------------------------------------------------------------------------------------------
// Mapping to the TS schema vocabulary
// ---------------------------------------------------------------------------------------------

const SLOT_TYPE_TS = {
    BMO_OP_SLOT_BOOL: 'bool',
    BMO_OP_SLOT_INT: 'int',
    BMO_OP_SLOT_FLT: 'float',
    BMO_OP_SLOT_PTR: 'ptr',
    BMO_OP_SLOT_MAT: 'mat4',
    BMO_OP_SLOT_VEC: 'vec3',
    BMO_OP_SLOT_ELEMENT_BUF: 'elems',
    BMO_OP_SLOT_MAPPING: 'map',
}

/**
 * Input slots whose name matches the documented primary-geometry convention
 * (bmesh_opdefines.cc file header, "A word on slot names") are treated as required parameters.
 * Everything else is optional. This is the ONLY heuristic in the generator - see README.
 */
const PRIMARY_GEOM_SLOT_NAMES = new Set(['verts', 'edges', 'faces', 'geom', 'input'])

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function main() {
    const args = parseArgs(process.argv.slice(2))
    const blenderRoot = resolveBlenderRoot(args.blenderRoot)
    const bmeshDir = path.join(blenderRoot, 'source/blender/bmesh')
    const opdefinesPath = path.join(bmeshDir, 'intern/bmesh_opdefines.cc')
    const rel = (p) => path.relative(blenderRoot, p).split(path.sep).join('/')

    console.error(`[extract-bmo-opdefines] blender root: ${blenderRoot}`)

    // -- git provenance (best effort; the data is still valid without it)
    let commit = null
    let commitDate = null
    let describe = null
    try {
        commit = execFileSync('git', ['-C', blenderRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()
        commitDate = execFileSync('git', ['-C', blenderRoot, 'log', '-1', '--format=%cI'], {encoding: 'utf8'}).trim()
    } catch { warn('could not read git provenance from the Blender checkout') }
    try {
        const v = fs.readFileSync(path.join(blenderRoot, 'source/blender/blenkernel/BKE_blender_version.h'), 'utf8')
        const maj = v.match(/#define\s+BLENDER_VERSION\s+(\d+)/)
        const patch = v.match(/#define\s+BLENDER_VERSION_PATCH\s+(\d+)/)
        const cycle = v.match(/#define\s+BLENDER_VERSION_CYCLE\s+(\w+)/)
        if (maj) {
            const n = Number(maj[1]) // e.g. 503 -> 5.3
            describe = `${Math.floor(n / 100)}.${n % 100}.${patch ? patch[1] : '0'} ${cycle ? cycle[1] : ''}`.trim()
        }
    } catch { /* optional */ }

    // -- 1. parse the operator table
    const src = fs.readFileSync(opdefinesPath, 'utf8')
    const {enumTables, ops, opdefinesOrder} = parseOpdefines(src, rel(opdefinesPath))
    console.error(`[extract-bmo-opdefines] parsed ${ops.length} operators, ${enumTables.length} enum tables`)

    // -- 2. symbols: bmesh headers first (authoritative, small), then the wider tree for stragglers
    const symbols = new Symbols()
    for (const h of listHeaders(bmeshDir)) collectSymbols(symbols, h, null)

    const collectNeeded = () => {
        const need = new Set()
        const scan = (toks) => {
            for (const t of toks) {
                if (t.t !== 'id') continue
                // identifiers used as functions are wrappers/casts, not values
                const i = toks.indexOf(t)
                if (toks[i + 1] && toks[i + 1].t === 'punct' && toks[i + 1].v === '(') continue
                if (!symbols.has(t.v)) need.add(t.v)
            }
        }
        for (const e of enumTables) for (const en of e.entries) scan(en.valueTokens)
        for (const op of ops) {
            scan(op.typeFlagTokens)
            for (const s of [...op.slotsIn, ...op.slotsOut]) {
                scan(s.typeTokens)
                if (s.subtypeTokens) scan(s.subtypeTokens)
            }
        }
        // enum-table references are resolved by name against enumTables, not the symbol table
        for (const e of enumTables) need.delete(e.cName)
        need.delete('nullptr')
        need.delete('NULL')
        return need
    }

    let needed = collectNeeded()
    if (needed.size) {
        console.error(`[extract-bmo-opdefines] ${needed.size} symbol(s) not defined under bmesh/, scanning source/blender ...`)
        for (let round = 0; round < 5 && needed.size; round++) {
            const headers = listHeaders(path.join(blenderRoot, 'source/blender'))
            for (const h of headers) {
                if (h.startsWith(bmeshDir + path.sep)) continue
                const text = fs.readFileSync(h, 'utf8')
                let hit = false
                for (const n of needed) if (text.includes(n)) { hit = true; break }
                if (!hit) continue
                collectSymbols(symbols, h, needed)
            }
            const before = needed.size
            needed = collectNeeded()
            if (needed.size === before) break
        }
    }
    if (needed.size) {
        fail(`unresolved C identifiers (no enum/#define found under source/blender):\n  ${[...needed].sort().join('\n  ')}`)
    }

    const sym = (name) => {
        const v = symbols.resolve(name)
        if (v === null || v === undefined) fail(`unresolved symbol ${name}`)
        return v
    }
    const evalToks = (toks, what) => {
        try {
            return evalExpr(toks, opdefinesPath, (n) => symbols.resolve(n))
        } catch (e) {
            fail(`${what}: ${e.message}`)
        }
    }

    // -- 3. constant tables (all read from the source, never hardcoded)
    const ELEM = {VERT: sym('BM_VERT'), EDGE: sym('BM_EDGE'), LOOP: sym('BM_LOOP'), FACE: sym('BM_FACE')}
    const ELEM_MASK_ALL = ELEM.VERT | ELEM.EDGE | ELEM.LOOP | ELEM.FACE
    const IS_SINGLE = sym('BMO_OP_SLOT_SUBTYPE_ELEM_IS_SINGLE')
    if ((IS_SINGLE & ELEM_MASK_ALL) !== 0) {
        fail(`BMO_OP_SLOT_SUBTYPE_ELEM_IS_SINGLE (${IS_SINGLE}) overlaps the BM_* element mask (${ELEM_MASK_ALL})`)
    }

    const namesWithPrefix = (prefix) => {
        const out = {}
        for (const n of symbols.defs.keys()) if (n.startsWith(prefix)) out[n] = symbols.resolve(n)
        return out
    }
    const slotTypeValues = {}
    for (const n of Object.keys(SLOT_TYPE_TS)) slotTypeValues[n] = sym(n)
    const slotTypeByValue = new Map(Object.entries(slotTypeValues).map(([n, v]) => [v, n]))
    if (slotTypeByValue.size !== Object.keys(slotTypeValues).length) fail('duplicate eBMOpSlotType values')

    const subtypeGroups = {
        map: namesWithPrefix('BMO_OP_SLOT_SUBTYPE_MAP_'),
        ptr: namesWithPrefix('BMO_OP_SLOT_SUBTYPE_PTR_'),
        int: namesWithPrefix('BMO_OP_SLOT_SUBTYPE_INT_'),
        elem: namesWithPrefix('BMO_OP_SLOT_SUBTYPE_ELEM_'),
    }
    const subtypeName = (group, value) => {
        for (const [n, v] of Object.entries(subtypeGroups[group])) if (v === value) return n
        return null
    }

    const opTypeFlags = namesWithPrefix('BMO_OPTYPE_FLAG_')
    const opTypeFlagBits = Object.entries(opTypeFlags).filter(([, v]) => v !== 0).sort((a, b) => a[1] - b[1])

    // -- 4. resolve enum tables
    const enums = enumTables.map((e) => ({
        cName: e.cName,
        entries: e.entries.map((en) => ({
            name: en.name,
            value: evalToks(en.valueTokens, `enum table ${e.cName} entry ${en.name}`),
            valueSrc: en.valueSrc,
        })),
    }))
    const enumByName = new Map(enums.map((e) => [e.cName, e]))
    for (const e of enums) {
        if (!e.entries.length) fail(`enum table ${e.cName} is empty`)
        const seen = new Set()
        for (const en of e.entries) {
            if (seen.has(en.name)) fail(`enum table ${e.cName} has duplicate identifier ${en.name}`)
            seen.add(en.name)
        }
    }

    // -- 5. resolve slots
    const usedEnums = new Set()
    const resolveSlot = (op, s, dir) => {
        const typeValue = evalToks(s.typeTokens, `${op.name}.${s.name} slot type`)
        const cType = slotTypeByValue.get(typeValue)
        if (!cType) fail(`${op.name}.${s.name}: unknown eBMOpSlotType value ${typeValue} (from ${s.typeSrc})`)
        const type = SLOT_TYPE_TS[cType]

        let subtypeC = null
        let elemMask = null
        let elemTypes = null
        let isSingle = false
        let enumName = null

        if (s.enumTokens) {
            const ts = s.enumTokens.filter((t) => t.t !== 'comment')
            if (!(ts.length === 1 && ts[0].t === 'id')) fail(`${op.name}.${s.name}: enum table field is not a plain identifier`)
            enumName = ts[0].v
            if (!enumByName.has(enumName)) fail(`${op.name}.${s.name}: references unknown enum table ${enumName}`)
            usedEnums.add(enumName)
        }

        if (s.subtypeTokens) {
            const v = evalToks(s.subtypeTokens, `${op.name}.${s.name} slot subtype`)
            if (type === 'elems') {
                elemMask = v & ELEM_MASK_ALL
                isSingle = (v & IS_SINGLE) !== 0
                const rest = v & ~(ELEM_MASK_ALL | IS_SINGLE)
                if (rest !== 0) fail(`${op.name}.${s.name}: element subtype has unknown bits ${rest} (from ${s.subtypeSrc})`)
                if (elemMask === 0) fail(`${op.name}.${s.name}: element buffer slot has an empty element mask`)
                elemTypes = Object.entries(ELEM).filter(([, bit]) => elemMask & bit).map(([n]) => n)
            } else if (type === 'map') {
                subtypeC = subtypeName('map', v)
                if (!subtypeC) fail(`${op.name}.${s.name}: unknown MAP subtype value ${v} (from ${s.subtypeSrc})`)
            } else if (type === 'ptr') {
                subtypeC = subtypeName('ptr', v)
                if (!subtypeC) fail(`${op.name}.${s.name}: unknown PTR subtype value ${v} (from ${s.subtypeSrc})`)
            } else if (type === 'int') {
                subtypeC = subtypeName('int', v)
                if (!subtypeC) fail(`${op.name}.${s.name}: unknown INT subtype value ${v} (from ${s.subtypeSrc})`)
            } else {
                fail(`${op.name}.${s.name}: slot type ${cType} does not take a subtype but got ${s.subtypeSrc}`)
            }
        } else {
            if (type === 'elems') fail(`${op.name}.${s.name}: element buffer slot without an element mask`)
            if (type === 'ptr') fail(`${op.name}.${s.name}: pointer slot without a subtype`)
            if (type === 'map') fail(`${op.name}.${s.name}: mapping slot without a subtype`)
        }

        if (enumName && !(type === 'int' && (subtypeC === 'BMO_OP_SLOT_SUBTYPE_INT_ENUM' || subtypeC === 'BMO_OP_SLOT_SUBTYPE_INT_FLAG'))) {
            fail(`${op.name}.${s.name}: enum table given for a non INT_ENUM/INT_FLAG slot`)
        }
        if (type === 'int' && subtypeC && !enumName) {
            fail(`${op.name}.${s.name}: ${subtypeC} slot has no enum table`)
        }

        // output slot names must carry the `.out` qualifier (Blender's own convention, asserted by
        // rst_from_bmesh_opdefines.py); flag rather than silently rename
        if (dir === 'out' && !s.name.endsWith('.out')) {
            warn(`${op.name}: output slot ${JSON.stringify(s.name)} does not end in ".out"`)
        }
        if (dir === 'in' && s.name.endsWith('.out')) {
            warn(`${op.name}: input slot ${JSON.stringify(s.name)} ends in ".out"`)
        }

        return {
            name: s.name,
            tsName: toTsName(s.name),
            type,
            cType,
            subtype: subtypeC ? subtypeC.replace('BMO_OP_SLOT_SUBTYPE_', '') : null,
            subtypeC,
            elemMask,
            elemTypes,
            isSingle,
            enumName,
            doc: s.doc || '',
            sourceLine: s.line,
        }
    }

    const initFns = parseInitFns(bmeshDir, new Set(ops.map((o) => o.initC).filter(Boolean)))

    const operators = ops.map((op) => {
        const slotsIn = op.slotsIn.map((s) => resolveSlot(op, s, 'in'))
        const slotsOut = op.slotsOut.map((s) => resolveSlot(op, s, 'out'))
        const typeFlagValue = evalToks(op.typeFlagTokens, `${op.name} type_flag`)
        const typeFlags = opTypeFlagBits.filter(([, bit]) => typeFlagValue & bit).map(([n]) => n)
        const covered = typeFlags.reduce((a, n) => a | opTypeFlags[n], 0)
        if (covered !== typeFlagValue) fail(`${op.name}: type_flag ${typeFlagValue} has bits not covered by BMO_OPTYPE_FLAG_* (${op.typeFlagSrc})`)
        if (!op.execC) fail(`${op.name}: has no exec callback`)

        for (const [list, label] of [[slotsIn, 'in'], [slotsOut, 'out']]) {
            const seen = new Map()
            for (const s of list) {
                if (seen.has(s.tsName)) fail(`${op.name}: slot tsName collision ${s.tsName} (${seen.get(s.tsName)} vs ${s.name}) in slots_${label}`)
                seen.set(s.tsName, s.name)
                const back = tsNameToBlender(s.tsName)
                const expect = s.name.replace(/\.(out|in)$/, '')
                if (back !== expect) fail(`${op.name}.${s.name}: tsName ${s.tsName} does not round-trip (${back} != ${expect})`)
            }
        }

        const initInfo = op.initC ? initFns.get(op.initC) : null
        if (op.initC && !initInfo) warn(`${op.name}: init callback ${op.initC} not found under ${rel(bmeshDir)}`)
        const initDefaults = {}
        if (initInfo) {
            for (const d of initInfo.defaults) {
                const slot = slotsIn.find((s) => s.name === d.slot)
                if (!slot) {
                    warn(`${op.name}: ${op.initC} sets unknown slot ${JSON.stringify(d.slot)}`)
                    continue
                }
                initDefaults[d.slot] = {
                    valueSrc: d.valueSrc,
                    kind: d.kind,
                    source: `${rel(initInfo.file)}:${d.line}`,
                }
            }
        }

        return {
            name: op.name,
            tsName: toTsName(op.name),
            cName: op.cName,
            doc: op.doc,
            slotsIn,
            slotsOut,
            typeFlags,
            typeFlagValue,
            initC: op.initC,
            initDefaults,
            execC: op.execC,
            sourceLine: op.line,
        }
    })

    // -- 6. global validation
    const byTsName = new Map()
    for (const op of operators) {
        if (byTsName.has(op.tsName)) fail(`operator tsName collision: ${op.tsName} (${byTsName.get(op.tsName)} vs ${op.name})`)
        byTsName.set(op.tsName, op.name)
        const back = tsNameToBlender(op.tsName)
        if (back !== op.name) fail(`operator ${op.name}: tsName ${op.tsName} does not round-trip (got ${back})`)
    }
    if (opdefinesOrder) {
        const declared = new Set(opdefinesOrder.map((s) => s.replace(/^&/, '')))
        for (const op of operators) {
            if (!declared.has(op.cName)) fail(`${op.cName} is defined but not registered in bmo_opdefines[]`)
        }
        if (declared.size !== operators.length) {
            fail(`bmo_opdefines[] registers ${declared.size} operators but ${operators.length} BMOpDefine structs were parsed`)
        }
    } else {
        warn('could not locate the bmo_opdefines[] registration array; completeness was not cross-checked')
    }
    for (const e of enums) {
        if (!usedEnums.has(e.cName)) warn(`enum table ${e.cName} is not referenced by any slot`)
    }

    // -- 7. emit
    const blenderVersion = describe
    const meta = {
        generator: 'extract-bmo-opdefines.mjs',
        generatorNote: 'Generated file. Do not edit by hand - rerun the generator (see README.md).',
        source: {
            opdefines: rel(opdefinesPath),
            operatorApi: rel(path.join(bmeshDir, 'intern/bmesh_operator_api.hh')),
            bmeshClass: rel(path.join(bmeshDir, 'bmesh_class.hh')),
            blenderCommit: commit,
            blenderCommitDate: commitDate,
            blenderVersion,
        },
        counts: {
            operators: operators.length,
            enumTables: enums.length,
            slotsIn: operators.reduce((a, o) => a + o.slotsIn.length, 0),
            slotsOut: operators.reduce((a, o) => a + o.slotsOut.length, 0),
        },
        constants: {
            elementTypes: ELEM,
            elementMaskAll: ELEM_MASK_ALL,
            elemIsSingle: IS_SINGLE,
            slotTypes: slotTypeValues,
            slotSubtypes: subtypeGroups,
            opTypeFlags,
        },
        defaultsPolicy: {
            note:
                'Blender memsets BMOperator to 0 in BMO_op_init (bmesh_operators.cc:147) and then runs ' +
                'bmo_op_slots_init (bmesh_operators.cc:87). So: bool=false, int=0, float=0, vec3=(0,0,0), ' +
                'ptr=null, elems=empty, map=empty. INT_ENUM/INT_FLAG slots are explicitly set to ' +
                'enum_flags[0].value (bmesh_operators.cc:109). MAT slots hold a null pointer, and ' +
                'BMO_slot_mat4_get returns the identity matrix when the pointer is null ' +
                '(bmesh_operators.cc:383-388). Anything else comes from the operator init callback.',
        },
        warnings,
    }
    const json = {...meta, enums, operators}

    if (args.check) {
        console.error('[extract-bmo-opdefines] --check: parsed and validated, nothing written')
        printSummary(operators, enums, warnings)
        return
    }

    fs.mkdirSync(args.outDir, {recursive: true})
    const jsonPath = path.join(args.outDir, 'bmo-opdefines.json')
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n')
    console.error(`[extract-bmo-opdefines] wrote ${rel2(jsonPath)}`)

    const schemaPath = path.join(args.outDir, 'bmo-ops.schema.ts')
    fs.writeFileSync(schemaPath, emitSchemaTs(json))
    console.error(`[extract-bmo-opdefines] wrote ${rel2(schemaPath)}`)

    const typesPath = path.join(args.outDir, 'bmo-ops.types.ts')
    fs.writeFileSync(typesPath, emitTypesTs(json))
    console.error(`[extract-bmo-opdefines] wrote ${rel2(typesPath)}`)

    printSummary(operators, enums, warnings)
}

function rel2(p) {
    return path.relative(process.cwd(), p)
}

function printSummary(operators, enums, warns) {
    console.error('')
    console.error(`operators      ${operators.length}`)
    console.error(`enum tables    ${enums.length}`)
    console.error(`input slots    ${operators.reduce((a, o) => a + o.slotsIn.length, 0)}`)
    console.error(`output slots   ${operators.reduce((a, o) => a + o.slotsOut.length, 0)}`)
    console.error(`warnings       ${warns.length}`)
}

// ---------------------------------------------------------------------------------------------
// Emit: bmo-ops.schema.ts
// ---------------------------------------------------------------------------------------------

/** Escape a doc comment body so it cannot terminate the enclosing block comment. */
function tsDoc(text, indent = '') {
    if (!text) return ''
    const body = text.replace(/\*\//g, '*​/')
    const lines = body.split('\n')
    if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`
    return `${indent}/**\n` + lines.map((l) => `${indent} *${l ? ' ' + l : ''}`).join('\n') + `\n${indent} */\n`
}

function q(s) {
    return JSON.stringify(s)
}

function header(json, what) {
    const s = json.source
    return (
        `/**\n` +
        ` * ${what}\n` +
        ` *\n` +
        ` * GENERATED FILE - DO NOT EDIT.\n` +
        ` * Regenerate with: node extract-bmo-opdefines.mjs --blender-root <blender-src>\n` +
        ` *\n` +
        ` * Source:  ${s.opdefines}\n` +
        ` * Blender: ${s.blenderVersion || 'unknown'} @ ${s.blenderCommit || 'unknown'}${s.blenderCommitDate ? ' (' + s.blenderCommitDate + ')' : ''}\n` +
        ` * Contains ${json.counts.operators} operators, ${json.counts.enumTables} enum tables,\n` +
        ` * ${json.counts.slotsIn} input slots and ${json.counts.slotsOut} output slots.\n` +
        ` */\n\n` +
        `/* eslint-disable */\n\n`
    )
}

function emitSchemaTs(json) {
    let out = header(json, 'BMesh operator schema, extracted from Blender.')

    const c = json.constants
    out += `/** Slot value kinds, mapped from Blender's \`eBMOpSlotType\`. */\n`
    out += `export type BMOSlotType = ${Object.values(SLOT_TYPE_TS).map(q).sort().join(' | ')}\n\n`

    out += `/** Slot subtype, mapped from \`eBMOpSlotSubType_{Map,Ptr,Int}\` (the \`BMO_OP_SLOT_SUBTYPE_\` prefix is stripped). */\n`
    const subtypeNames = []
    for (const g of ['map', 'ptr', 'int']) {
        for (const n of Object.keys(c.slotSubtypes[g])) subtypeNames.push(n.replace('BMO_OP_SLOT_SUBTYPE_', ''))
    }
    out += `export type BMOSlotSubtype = ${subtypeNames.map(q).join(' | ')}\n\n`

    out += `/** Post-execution behaviour declared by the operator (\`BMOpDefine.type_flag\`). */\n`
    out += `export type BMOTypeFlag = ${Object.keys(c.opTypeFlags).filter((n) => c.opTypeFlags[n] !== 0).map(q).join(' | ')}\n\n`

    out += `/** Element-type bitmask for \`elems\` and \`map\` slots. Values are Blender's \`BMHeader.htype\`. */\n`
    out += `export const BM_VERT = ${c.elementTypes.VERT} as const\n`
    out += `export const BM_EDGE = ${c.elementTypes.EDGE} as const\n`
    out += `export const BM_LOOP = ${c.elementTypes.LOOP} as const\n`
    out += `export const BM_FACE = ${c.elementTypes.FACE} as const\n`
    out += `/** \`BMO_OP_SLOT_SUBTYPE_ELEM_IS_SINGLE\` - carried separately as \`BMOSlotDef.isSingle\`. */\n`
    out += `export const BM_ELEM_IS_SINGLE = ${c.elemIsSingle} as const\n`
    out += `export type BMOElemMask = number\n\n`

    out += `/** Numeric \`eBMOpSlotType\` values, for interop with a C-compatible runtime. */\n`
    out += `export const BMO_SLOT_TYPE_VALUES: Readonly<Record<BMOSlotType, number>> = {\n`
    for (const [cname, ts] of Object.entries(SLOT_TYPE_TS)) out += `    ${ts}: ${json.constants.slotTypes[cname]}, // ${cname}\n`
    out += `}\n\n`

    out += `/** Numeric \`BMOpTypeFlag\` bits. */\n`
    out += `export const BMO_TYPE_FLAG_VALUES: Readonly<Record<BMOTypeFlag, number>> = {\n`
    for (const [n, v] of Object.entries(c.opTypeFlags)) if (v !== 0) out += `    ${n}: ${v},\n`
    out += `}\n\n`

    out += `export interface BMOEnumEntry {\n    /** Blender's string identifier, e.g. \`"BEAUTY"\`. */\n    name: string\n    /** The C value the identifier expands to. */\n    value: number\n}\n\n`

    out += `export interface BMOSlotDef {\n`
    out += `    /** Blender slot name, verbatim (output slots keep their \`.out\` qualifier). */\n    name: string\n`
    out += `    /** camelCase name, \`.out\`/\`.in\` stripped. See the naming rules in README.md. */\n    tsName: string\n`
    out += `    type: BMOSlotType\n`
    out += `    /** Blender's \`eBMOpSlotType\` enumerator name. */\n    cType: string\n`
    out += `    /** Subtype for \`int\`, \`ptr\` and \`map\` slots. \`elems\` slots use \`elemMask\`/\`isSingle\` instead. */\n    subtype?: BMOSlotSubtype\n`
    out += `    /** Bitmask of BM_VERT|BM_EDGE|BM_FACE accepted by an \`elems\` slot. */\n    elemMask?: BMOElemMask\n`
    out += `    /** True when the \`elems\` slot holds a single element rather than a buffer. */\n    isSingle?: boolean\n`
    out += `    /** Key into {@link BMO_ENUMS} for \`INT_ENUM\`/\`INT_FLAG\` slots. */\n    enumName?: string\n`
    out += `    /** Slot documentation from the C source (reStructuredText). */\n    doc?: string\n`
    out += `}\n\n`

    out += `export interface BMOOpDef {\n`
    out += `    /** Blender operator name, e.g. \`"extrude_face_region"\`. */\n    name: string\n`
    out += `    /** camelCase operator name, e.g. \`"extrudeFaceRegion"\`. */\n    tsName: string\n`
    out += `    /** Operator documentation from the C source. First line is the title. */\n    doc: string\n`
    out += `    slotsIn: BMOSlotDef[]\n`
    out += `    slotsOut: BMOSlotDef[]\n`
    out += `    typeFlags: BMOTypeFlag[]\n`
    out += `    /** C name of the \`exec\` callback - the function a port has to reimplement. */\n    execC: string\n`
    out += `    /** C name of the optional \`init\` callback that sets non-zero slot defaults. */\n    initC?: string\n`
    out += `    /** Slot defaults set by \`initC\`, keyed by Blender slot name. */\n    initDefaults?: Record<string, {valueSrc: string, source: string}>\n`
    out += `}\n\n`

    // enums
    out += `/** Every \`static BMO_FlagSet bmo_enum_*[]\` table, keyed by its C name. */\n`
    out += `export const BMO_ENUMS: Readonly<Record<string, readonly BMOEnumEntry[]>> = {\n`
    for (const e of json.enums) {
        out += `    ${q(e.cName)}: [\n`
        for (const en of e.entries) {
            const note = en.valueSrc && en.valueSrc !== String(en.value) ? ` // ${en.valueSrc}` : ''
            out += `        {name: ${q(en.name)}, value: ${en.value}},${note}\n`
        }
        out += `    ],\n`
    }
    out += `}\n\n`

    // operators
    out += `/** Every operator in \`bmo_opdefines[]\`, keyed by its Blender name. */\n`
    out += `export const BMO_OPS: Readonly<Record<string, BMOOpDef>> = {\n`
    for (const op of json.operators) {
        out += tsDoc(op.doc, '    ')
        out += `    ${q(op.name)}: {\n`
        out += `        name: ${q(op.name)},\n`
        out += `        tsName: ${q(op.tsName)},\n`
        out += `        doc: ${q(op.doc)},\n`
        out += `        slotsIn: [\n${op.slotsIn.map((s) => emitSlotLiteral(s, '            ')).join('')}        ],\n`
        out += `        slotsOut: [\n${op.slotsOut.map((s) => emitSlotLiteral(s, '            ')).join('')}        ],\n`
        out += `        typeFlags: [${op.typeFlags.map(q).join(', ')}],\n`
        out += `        execC: ${q(op.execC)},\n`
        if (op.initC) out += `        initC: ${q(op.initC)},\n`
        if (Object.keys(op.initDefaults).length) {
            out += `        initDefaults: {\n`
            for (const [k, v] of Object.entries(op.initDefaults)) {
                out += `            ${q(k)}: {valueSrc: ${q(v.valueSrc)}, source: ${q(v.source)}},\n`
            }
            out += `        },\n`
        }
        out += `    },\n`
    }
    out += `}\n\n`

    // name maps
    out += `/** camelCase operator name -> Blender operator name. */\n`
    out += `export const BMO_OP_NAME_BY_TS: Readonly<Record<string, string>> = {\n`
    for (const op of json.operators) out += `    ${q(op.tsName)}: ${q(op.name)},\n`
    out += `}\n\n`

    out += `/** \`"<op>.<tsSlot>"\` -> Blender slot name, for slots whose tsName differs from their name. */\n`
    out += `export const BMO_SLOT_NAME_BY_TS: Readonly<Record<string, string>> = {\n`
    for (const op of json.operators) {
        for (const s of [...op.slotsIn, ...op.slotsOut]) {
            if (s.tsName !== s.name) out += `    ${q(op.name + '.' + s.tsName)}: ${q(s.name)},\n`
        }
    }
    out += `}\n`

    return out
}

function emitSlotLiteral(s, indent) {
    let out = ''
    out += tsDoc(s.doc, indent)
    const parts = [`name: ${q(s.name)}`, `tsName: ${q(s.tsName)}`, `type: ${q(s.type)}`, `cType: ${q(s.cType)}`]
    if (s.subtype) parts.push(`subtype: ${q(s.subtype)}`)
    if (s.elemMask !== null && s.elemMask !== undefined) parts.push(`elemMask: ${s.elemMask} /* ${s.elemTypes.join('|')} */`)
    if (s.isSingle) parts.push(`isSingle: true`)
    if (s.enumName) parts.push(`enumName: ${q(s.enumName)}`)
    if (s.doc) parts.push(`doc: ${q(s.doc)}`)
    out += `${indent}{${parts.join(', ')}},\n`
    return out
}

// ---------------------------------------------------------------------------------------------
// Emit: bmo-ops.types.ts
// ---------------------------------------------------------------------------------------------

const PTR_TS = {
    PTR_BMESH: 'BMeshLike',
    PTR_SCENE: 'SceneLike',
    PTR_OBJECT: 'ObjectLike',
    PTR_MESH: 'MeshLike',
    PTR_STRUCT: 'StructLike',
}

function elemUnion(elemTypes) {
    const map = {VERT: 'BMVert', EDGE: 'BMEdge', LOOP: 'BMLoop', FACE: 'BMFace'}
    return elemTypes.map((t) => map[t]).join(' | ')
}

function enumUnion(entries) {
    return entries.map((e) => q(e.name)).join(' | ')
}

function slotTsType(slot, enums) {
    switch (slot.type) {
        case 'bool': return 'boolean'
        case 'float': return 'number'
        case 'vec3': return 'Vector3Like'
        case 'mat4': return 'Matrix4Like'
        case 'int': {
            if (slot.enumName) {
                const e = enums.get(slot.enumName)
                const u = enumUnion(e.entries)
                if (slot.subtype === 'INT_FLAG') return `(${u})[]`
                return u
            }
            return 'number'
        }
        case 'ptr': {
            const t = PTR_TS[slot.subtype]
            if (!t) fail(`no TS type for pointer subtype ${slot.subtype}`)
            return `${t} | null`
        }
        case 'elems': {
            const u = elemUnion(slot.elemTypes)
            if (slot.isSingle) return `(${u}) | null`
            return slot.elemTypes.length === 1 ? `${u}[]` : `(${u})[]`
        }
        case 'map': {
            switch (slot.subtype) {
                case 'MAP_EMPTY': return 'Set<BMElem>'
                case 'MAP_ELEM': return 'Map<BMElem, BMElem>'
                case 'MAP_FLT': return 'Map<BMElem, number>'
                case 'MAP_INT': return 'Map<BMElem, number>'
                case 'MAP_BOOL': return 'Map<BMElem, boolean>'
                case 'MAP_INTERNAL': return 'Map<BMElem, unknown>'
                default: fail(`no TS type for map subtype ${slot.subtype}`)
            }
            break
        }
        default: fail(`no TS type for slot type ${slot.type}`)
    }
}

/**
 * Default for a slot, sourced from Blender - never invented.
 * Returns null when there is genuinely no sourced default.
 */
function slotDefaultComment(op, slot, enums) {
    const init = op.initDefaults && op.initDefaults[slot.name]
    if (init) return `default: ${init.valueSrc} (set by ${op.initC}, ${init.source})`
    switch (slot.type) {
        case 'bool': return 'default: false (slots are zero-initialised by BMO_op_init)'
        case 'float': return 'default: 0.0 (slots are zero-initialised by BMO_op_init)'
        case 'vec3': return 'default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)'
        case 'mat4': return 'default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)'
        case 'int': {
            if (slot.enumName) {
                const e = enums.get(slot.enumName)
                const first = e.entries[0]
                return `default: ${q(first.name)} (= ${first.value}; bmo_op_slots_init uses enum_flags[0].value)`
            }
            return 'default: 0 (slots are zero-initialised by BMO_op_init)'
        }
        case 'ptr': return 'default: null (slots are zero-initialised by BMO_op_init)'
        case 'elems': return slot.isSingle
            ? 'default: null (slots are zero-initialised by BMO_op_init)'
            : 'default: [] (slots are zero-initialised by BMO_op_init)'
        case 'map': return slot.subtype === 'MAP_EMPTY'
            ? 'default: empty set (bmo_op_slots_init allocates an empty GHash)'
            : 'default: empty map (bmo_op_slots_init allocates an empty GHash)'
        default: return null
    }
}

function emitTypesTs(json) {
    const enums = new Map(json.enums.map((e) => [e.cName, e]))
    let out = header(json, 'BMesh operator parameter/result interfaces, extracted from Blender.')

    out += `/*\n` +
        ` * Dependency-free by design: the element and math types below are declared structurally so this\n` +
        ` * file can be consumed before the real BMesh kernel exists, and so it never pulls in three.js.\n` +
        ` * Replace these declarations with \`import type\` lines once the kernel types land.\n` +
        ` */\n\n`

    out += `/** Structural stand-in for \`three.Vector3\` / \`{x, y, z}\`. */\n`
    out += `export interface Vector3Like { x: number; y: number; z: number }\n`
    out += `/** Structural stand-in for \`three.Matrix4\`: 16 numbers, column-major, as in three.js and Blender. */\n`
    out += `export interface Matrix4Like { elements: ArrayLike<number> }\n\n`

    out += `/** Placeholder BMesh element types. */\n`
    out += `export interface BMVert { readonly __bmElem: 'vert' }\n`
    out += `export interface BMEdge { readonly __bmElem: 'edge' }\n`
    out += `export interface BMLoop { readonly __bmElem: 'loop' }\n`
    out += `export interface BMFace { readonly __bmElem: 'face' }\n`
    out += `export type BMElem = BMVert | BMEdge | BMFace\n\n`

    out += `/** Placeholders for Blender's \`BMO_OP_SLOT_SUBTYPE_PTR_*\` slots. */\n`
    out += `export interface BMeshLike { readonly __bmesh: true }\n`
    out += `/** Blender-only (\`bpy.types.Scene\`); no threepipe equivalent, kept so the table stays complete. */\n`
    out += `export interface SceneLike { readonly __blenderScene: true }\n`
    out += `/** Blender-only (\`bpy.types.Object\`). */\n`
    out += `export interface ObjectLike { readonly __blenderObject: true }\n`
    out += `/** Blender-only (\`bpy.types.Mesh\`). */\n`
    out += `export interface MeshLike { readonly __blenderMesh: true }\n`
    out += `/** Blender-only opaque struct pointer (\`BMO_OP_SLOT_SUBTYPE_PTR_STRUCT\`, used for \`CurveProfile\`). */\n`
    out += `export interface StructLike { readonly __blenderStruct: true }\n\n`

    out += `/*\n` +
        ` * Required vs optional: an input slot is required only when it is an element-buffer slot using one\n` +
        ` * of the primary geometry names documented in bmesh_opdefines.cc ("A word on slot names"):\n` +
        ` * ${[...PRIMARY_GEOM_SLOT_NAMES].join(', ')}. Everything else is optional, because Blender\n` +
        ` * zero-initialises every slot. This is the only heuristic in the generator - see README.md.\n` +
        ` */\n\n`

    for (const op of json.operators) {
        const P = toPascal(op.tsName)
        out += tsDoc(op.doc)
        out += `export interface ${P}Params {\n`
        if (!op.slotsIn.length) out += `    // this operator takes no input slots\n`
        for (const s of op.slotsIn) {
            const required = s.type === 'elems' && !s.isSingle && PRIMARY_GEOM_SLOT_NAMES.has(s.name)
            const def = slotDefaultComment(op, s, enums)
            const lines = []
            if (s.doc) lines.push(...s.doc.split('\n'))
            if (def && !required) lines.push(def)
            if (s.enumName) lines.push(`enum table: ${s.enumName}`)
            if (lines.length) out += tsDoc(lines.join('\n'), '    ')
            out += `    ${s.tsName}${required ? '' : '?'}: ${slotTsType(s, enums)}\n`
        }
        out += `}\n\n`

        out += tsDoc(`Output slots of \`${op.name}\`.`)
        out += `export interface ${P}Result {\n`
        if (!op.slotsOut.length) out += `    // this operator has no output slots\n`
        for (const s of op.slotsOut) {
            if (s.doc) out += tsDoc(s.doc, '    ')
            out += `    ${s.tsName}: ${slotTsType(s, enums)}\n`
        }
        out += `}\n\n`
    }

    out += `/** Operator name -> params/result pair, for a typed \`bmo(op, params)\` dispatcher. */\n`
    out += `export interface BMOOperatorMap {\n`
    for (const op of json.operators) {
        out += `    ${q(op.name)}: {params: ${toPascal(op.tsName)}Params, result: ${toPascal(op.tsName)}Result}\n`
    }
    out += `}\n\n`
    out += `export type BMOOperatorName = keyof BMOOperatorMap\n`

    return out
}

main()
