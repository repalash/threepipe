import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import postcss, {AtRule, Rule} from 'postcss'

// The page CSS of the tweakpane editor (plugins/tweakpane-editor): which rules apply at a window size. The unit suite
// has no DOM, so the tests read the declarations that the media queries leave for a selector, as a browser would.

const src = path.resolve(__dirname, '../../plugins/tweakpane-editor/src')
const sheets = ['TweakpaneEditorPlugin.css', 'frame/EditorFrame.css'].map(f => postcss.parse(fs.readFileSync(path.join(src, f), 'utf8')))

interface Viewport {width: number, height: number}
const phone: Viewport = {width: 390, height: 664} // iPhone 13 in Playwright
const phoneLandscape: Viewport = {width: 844, height: 340}
const desktop: Viewport = {width: 1440, height: 900}

function px(v: string) {
    return parseFloat(v)
}

/** Evaluates a media query list (`screen`, `only`, `min-width`, `max-width`, `orientation`) for a viewport */
function mediaMatches(params: string, vp: Viewport) {
    return params.split(',').some(query => query.trim().split(/\s+and\s+/).every(part => {
        const p = part.trim().toLowerCase()
        if (p === 'only screen' || p === 'screen' || p === 'all' || p === 'only all') return true
        const m = p.match(/^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/)
        if (!m) throw new Error('Unknown media query part: ' + part)
        const [, feature, value] = m
        if (feature === 'min-width') return vp.width >= px(value)
        if (feature === 'max-width') return vp.width <= px(value)
        if (feature === 'orientation') return value === (vp.height >= vp.width ? 'portrait' : 'landscape')
        throw new Error('Unknown media feature: ' + feature)
    }))
}

/** The declarations for a selector (exactly one of a rule's selectors) at a viewport, in cascade order: `!important` wins */
function declarations(selector: string, vp: Viewport) {
    const normal: Record<string, string> = {}
    const important: Record<string, string> = {}
    for (const sheet of sheets) {
        sheet.walkRules((rule: Rule) => {
            if (!rule.selectors.map(s => s.replace(/\s+/g, ' ').trim()).includes(selector)) return
            for (let p = rule.parent; p && p.type !== 'root'; p = p.parent as any) {
                if (p.type === 'atrule' && (p as AtRule).name === 'media' && !mediaMatches((p as AtRule).params, vp)) return
            }
            rule.walkDecls(d => {
                (d.important ? important : normal)[d.prop] = d.value
            })
        })
    }
    return {...normal, ...important}
}

describe('tweakpane editor frame on a phone', () => {
    it('keeps the chosen frame: the bars and the mode bar show, the mode tabs and the panel title do not', () => {
        for (const vp of [phone, phoneLandscape]) {
            expect(declarations('.mb-root', vp).display, 'mode bar').not.toBe('none')
            expect(declarations('.lay-bar', vp).display, 'title or status bar').not.toBe('none')
            expect(declarations('.lay-menu', vp).display, 'layout menu').not.toBe('none')
            expect(declarations('body.lay-frame .mode-buttons-container', vp).display, 'mode tabs').toBe('none')
            expect(declarations('body.lay-frame #tweakpaneUiContainer .tp-rotv_b', vp).display, 'panel title').toBe('none')
        }
    })

    it('stacks the panel below the canvas in a narrow portrait window, between the bars', () => {
        for (const layout of ['titlebar', 'statusbar', 'floating']) {
            const canvas = declarations(`body.lay-${layout} #canvas-container`, phone)
            const panel = declarations(`body.lay-${layout} #tweakpaneUiContainer`, phone)
            // the canvas is above the panel, full width but the mode bar
            expect(canvas.height, layout).toContain('var(--lay-split)')
            expect(panel.top, layout).toContain('var(--lay-split)')
            expect(panel.width, layout).toBe('auto')
            expect(panel.height, layout).toBe('auto')
            expect(panel['max-height'], layout).toBe('none')
        }
        // the status bar is below the panel, the title bar above the canvas
        expect(declarations('body.lay-statusbar #tweakpaneUiContainer', phone).bottom).toBe('var(--lay-bottom)')
        expect(declarations('body.lay-titlebar #canvas-container', phone).top).toBe('var(--lay-top)')
    })

    it('lets the panel scroll with touch', () => {
        for (const vp of [phone, phoneLandscape, desktop]) {
            const panel = declarations('body.lay-frame #tweakpaneUiContainer', vp)
            // iOS does not scroll a container that lets the touches through (pointer-events: none in the Tweakpane theme)
            expect(panel['pointer-events']).toBe('auto')
            expect(panel['overflow-y']).toBe('auto')
            expect(panel['overscroll-behavior']).toBe('contain')
        }
        // classic: the same, as tall as its content up to the room above the tool bar
        const classic = declarations('#tweakpaneUiContainer', phone)
        expect(classic['pointer-events']).toBe('auto')
        expect(classic.height).toBe('auto')
    })

    it('keeps the tool bar in one row', () => {
        for (const vp of [phone, desktop]) {
            const bar = declarations('.util-buttons-container', vp)
            expect(bar['flex-wrap']).toBe('nowrap')
            expect(bar['overflow-x']).toBe('auto')
            // a bar wider than the canvas overflows to the end only, so scrolling reaches its first buttons: start aligned,
            // and the auto margins of the first and last buttons center the buttons when they fit (0 when they overflow)
            expect(bar['justify-content']).toBe('flex-start')
            expect(declarations('.util-buttons-container > :first-child', vp)['margin-left']).toBe('auto')
            expect(declarations('.util-buttons-container > :last-child', vp)['margin-right']).toBe('auto')
        }
    })

    it('keeps the floating tool bar in the part of the canvas that the panels do not cover', () => {
        // the floating canvas is the whole window and the bar moves left of the panels: its max-width must leave the
        // panels out, or a narrow window puts its first buttons left of the window, out of the bar's scroll
        const evaluate = (expr: string, vp: Viewport, vars: Record<string, string>): number => {
            let e = expr
            for (let i = 0; i < 5; i++) e = e.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, k, fb) => vars[k] ?? fb ?? 'NaN')
            const js = e.replace(/calc/g, '').replace(/(-?[\d.]+)rem/g, '($1*16)').replace(/(-?[\d.]+)px/g, '($1)').replace(/(-?[\d.]+)%/g, `($1*${vp.width}/100)`)
            if (!/^[\d\s.+\-*/()]+$/.test(js)) throw new Error('Cannot evaluate: ' + expr)
            return Function(`return (${js})`)() as number
        }
        // the left and right padding of a padding shorthand (1 to 4 values)
        const sidePad = (v: string) => {
            const p = v.split(/\s+/).map(x => evaluate(x, phone, {}))
            return (p[1] ?? p[0]) + (p[3] ?? p[1] ?? p[0])
        }
        for (const vp of [{width: 568, height: 320}, {width: 844, height: 390}, desktop]) {
            for (const mb of ['44px', '168px']) {
                const vars: Record<string, string> = {'--mb-width': mb, '--tweakpane-ui-container-width': '300px', '--lay-gap': '12px'}
                vars['--lay-right-inset'] = declarations('body.lay-floating #canvas-container', vp)['--lay-right-inset']
                const bar = {...declarations('.util-buttons-container', vp), ...declarations('body.lay-floating .util-buttons-container', vp)}
                const sidePadding = sidePad(bar.padding ?? declarations('.button-bar', vp).padding)
                const right = evaluate(bar.right, vp, vars)
                const width = Math.max(0, evaluate(bar['max-width'], vp, vars)) + sidePadding
                const panelLeft = vp.width - evaluate(vars['--lay-right-inset'], vp, vars) + 12 // the panel card's left edge
                expect(vp.width - right - width, `${vp.width} px, mode bar ${mb}: left edge`).toBeGreaterThanOrEqual(0)
                expect(vp.width - right, `${vp.width} px, mode bar ${mb}: right edge`).toBeLessThanOrEqual(panelLeft)
            }
        }
    })

    it('keeps the side by side frame in a wide window', () => {
        const canvas = declarations('body.lay-titlebar #canvas-container', desktop)
        const panel = declarations('body.lay-titlebar #tweakpaneUiContainer', desktop)
        expect(canvas.width).toBe('calc(100% - var(--mb-width, 44px) - var(--tweakpane-ui-container-width, 300px))')
        expect(canvas.height).toBe('calc(100% - var(--lay-top) - var(--lay-bottom))')
        expect(panel.top).toBe('var(--lay-top)')
        expect(panel.width).toBe('var(--tweakpane-ui-container-width, 300px)')
        expect(declarations('body.lay-floating #tweakpaneUiContainer', desktop).right).toBe('calc(var(--mb-width, 44px) + 2 * var(--lay-gap))')
    })
})
