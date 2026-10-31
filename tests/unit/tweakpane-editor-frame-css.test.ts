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

    it('puts the mode bar beside the panel only in a narrow portrait window, and in a row at the bottom when the panel is hidden', () => {
        for (const layout of ['titlebar', 'statusbar', 'floating']) {
            const bar = declarations(`body.lay-${layout} .mb-root`, phone)
            const panel = declarations(`body.lay-${layout} #tweakpaneUiContainer`, phone)
            // the same top and bottom as the panel, so the canvas takes the full width above them
            expect(bar.top, layout).toBe(panel.top.replace(/\s*!important$/, ''))
            expect(bar.bottom, layout).toBe(panel.bottom)
            expect(declarations(`body.lay-${layout} #canvas-container`, phone).width, layout).toBe('100%')
            // the panel hidden: the canvas leaves a row at the bottom for the mode bar
            expect(declarations(`body.lay-${layout}.mb-panel-hidden #canvas-container`, phone).height, layout).toContain('var(--mb-row-height)')
        }
        expect(declarations('body.lay-frame', phone)['--mb-row-height']).toBe('44px')
        const hidden = declarations('body.lay-frame.mb-panel-hidden .mb-root', phone)
        expect(hidden['flex-direction']).toBe('row')
        expect(hidden.top).toBe('auto')
        expect(hidden.height).toBe('var(--mb-row-height)')
        expect(hidden['overflow-x']).toBe('auto')
        // a mode bar taller than its room scrolls, without moving the page
        const mb = declarations('.mb-root', phone)
        expect(mb['overflow-y']).toBe('auto')
        expect(mb['overscroll-behavior']).toBe('contain')
        // landscape and wide windows keep the full-height mode bar, also with the panel hidden
        for (const vp of [phoneLandscape, desktop]) {
            expect(declarations('body.lay-titlebar .mb-root', vp).top).toBe('var(--lay-top)')
            expect(declarations('body.lay-floating .mb-root', vp).top).toBe('var(--lay-gap)')
            expect(declarations('body.lay-frame.mb-panel-hidden .mb-root', vp)['flex-direction']).toBeUndefined()
        }
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

    it('lays out floating on a phone as the other layouts: no gap, round corners or shadows', () => {
        expect(declarations('body.lay-floating', phone)['--lay-gap']).toBe('0px')
        for (const sel of ['body.lay-floating #tweakpaneUiContainer', 'body.lay-floating .mb-root', 'body.lay-floating.mb-panel-hidden .mb-root']) {
            const d = declarations(sel, phone)
            expect([d['border-radius'], d['box-shadow'], d['clip-path']], sel).toEqual(['0', 'none', 'none'])
        }
        for (const prop of ['width', 'height']) {
            expect(declarations('body.lay-floating #canvas-container', phone)[prop], prop).toBe(declarations('body.lay-titlebar #canvas-container', phone)[prop])
        }
    })

    it('sizes the mode bar from --mb-width, and stacks the bars in the panels and bars layer', () => {
        expect(declarations('.mb-root', desktop).width).toBe('var(--mb-width, 44px)')
        expect(declarations('.mb-root.mb-wide', desktop).width).toBeUndefined()
        // CONTRIBUTING, UI layers: panels and bars 200 to 999, below the layout menu (popups and dropdown menus)
        const z = (sel: string) => Number(declarations(sel, desktop)['z-index'])
        for (const sel of ['.mb-root', '.lay-bar']) {
            expect(z(sel), sel).toBeGreaterThanOrEqual(200)
            expect(z(sel), sel).toBeLessThan(1000)
        }
        expect(z('.lay-menu')).toBeGreaterThanOrEqual(2000)
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
        // the rules of the bar, in the order of their specificity (a later one wins): with the perf pill at the bottom
        // left (PerfPanelPlugin, in the example), the rules for it apply too
        const pillContainer = 'body.lay-frame #canvas-container:has(.pp-root.pp-bottom-left)'
        const barRules = (pill: boolean) => ['.util-buttons-container', 'body.lay-frame .util-buttons-container', 'body.lay-floating .util-buttons-container',
            ...pill ? [pillContainer + ' .util-buttons-container'] : []]
        for (const vp of [{width: 568, height: 320}, {width: 844, height: 390}, desktop]) {
            for (const mb of ['44px', '168px']) {
                for (const pill of [false, true]) {
                    const vars: Record<string, string> = {'--mb-width': mb, '--tweakpane-ui-container-width': '300px', '--lay-gap': '12px'}
                    vars['--lay-right-inset'] = declarations('body.lay-floating #canvas-container', vp)['--lay-right-inset']
                    if (pill) Object.assign(vars, declarations(pillContainer, vp))
                    const bar = Object.assign({}, ...barRules(pill).map(r => declarations(r, vp)))
                    const sidePadding = sidePad(bar.padding ?? declarations('.button-bar', vp).padding)
                    const right = evaluate(bar.right, vp, vars)
                    const maxWidth = evaluate(bar['max-width'], vp, vars)
                    const width = Math.max(0, maxWidth) + sidePadding
                    const panelLeft = vp.width - evaluate(vars['--lay-right-inset'], vp, vars) + 12 // the panel card's left edge
                    // the right edge of the pill: its left and its widest (the 76 px of a phone). When the canvas left of
                    // the panels has no room for the pill and a button (568 px with the mode names, which a narrow window
                    // hides at the first visit), the bar has no width and only the window edge is checked
                    const pillRight = pill && maxWidth > 0 ? evaluate(declarations('body.lay-frame .pp-root.pp-bottom-left', vp).left, vp, vars) + 76 : 0
                    const at = `${vp.width} px, mode bar ${mb}${pill ? ', perf pill' : ''}`
                    expect(vp.width - right - width, `${at}: left edge`).toBeGreaterThanOrEqual(pillRight)
                    expect(vp.width - right, `${at}: right edge`).toBeLessThanOrEqual(panelLeft)
                }
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
        // floating: the panel and the mode bar are one card, joined without a gap or round corners at the join
        const floatPanel = declarations('body.lay-floating #tweakpaneUiContainer', desktop)
        const floatBar = declarations('body.lay-floating .mb-root', desktop)
        expect(floatPanel.right).toBe('calc(var(--mb-width, 44px) + var(--lay-gap))')
        expect(floatPanel['border-radius']).toBe('8px 0 0 8px')
        expect(floatBar['border-radius']).toBe('0 8px 8px 0')
        expect(declarations('body.lay-floating.mb-panel-hidden .mb-root', desktop)['border-radius']).toBe('8px')
    })
})
