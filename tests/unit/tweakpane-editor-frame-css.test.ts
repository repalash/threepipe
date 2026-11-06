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

/**
 * The body classes of the layout that the frame sets for a window size (EditorFrame.Breakpoints = {stack: 920,
 * singleView: 700}): lay-stack for a portrait window under 920 px, else lay-side; lay-single when stacked or under 700 px
 */
function layoutClasses(vp: Viewport) {
    const stack = vp.height >= vp.width && vp.width < 920
    return [stack ? 'lay-stack' : 'lay-side', ...stack || vp.width < 700 ? ['lay-single'] : []]
}
const LAYOUT_CLASS = /\.lay-(stack|side|single)\b/g

/**
 * The declarations for a selector (exactly one of a rule's selectors, without the layout classes) at a viewport, in
 * cascade order: `!important` wins. The layout classes of a rule (lay-stack, lay-side, lay-single) must match the
 * viewport, as a media query would.
 */
function declarations(selector: string, vp: Viewport) {
    const normal: Record<string, string> = {}
    const important: Record<string, string> = {}
    const layout = layoutClasses(vp)
    for (const sheet of sheets) walkSheet(sheet)
    function walkSheet(sheet: typeof sheets[number]) {
        sheet.walkRules((rule: Rule) => {
            const match = rule.selectors.map(s => s.replace(/\s+/g, ' ').trim()).find(s => {
                const needs = [...s.matchAll(LAYOUT_CLASS)].map(m => 'lay-' + m[1])
                return s.replace(LAYOUT_CLASS, '') === selector && needs.every(c => layout.includes(c))
            })
            if (!match) return
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

/** The specificity of a selector of the frame CSS (ids, classes and pseudo-classes, tags), as a number for sorting */
function specificity(selector: string) {
    const ids = selector.match(/#[\w-]+/g)?.length ?? 0
    const classes = selector.match(/[.:][\w-]+/g)?.length ?? 0
    const tags = selector.match(/(^|\s)[a-z]+/g)?.length ?? 0
    return ids * 10000 + classes * 100 + tags
}

/**
 * The declarations for an element with the body in the given classes, at a viewport: every rule `body.a.b <target>`
 * (or `<target>`, or `body.a.b` for the body itself, target `body`) whose body classes the body has, in the order of
 * their specificity, then of the source; `!important` wins. A target is one simple selector of the element (its id or
 * one of its classes).
 */
function cascade(targets: string[], stateClasses: string[], vp: Viewport) {
    // the layout classes that the frame sets for the window size
    const bodyClassList = [...stateClasses, ...layoutClasses(vp)]
    const found: {spec: number, order: number, decls: {prop: string, value: string, important: boolean}[]}[] = []
    let order = 0
    sheets.forEach(sheet => {
        sheet.walkRules((rule: Rule) => {
            order++
            for (let p = rule.parent; p && p.type !== 'root'; p = p.parent as any) {
                if (p.type === 'atrule' && (p as AtRule).name === 'media' && !mediaMatches((p as AtRule).params, vp)) return
            }
            for (const raw of rule.selectors) {
                const sel = raw.replace(/\s+/g, ' ').trim()
                const m = sel.match(/^body((?:\.[\w-]+)*)(?: (.+))?$/)
                const classes = m ? m[1].split('.').filter(Boolean) : []
                const target = m ? m[2] ?? 'body' : sel
                if (!targets.includes(target) || !classes.every(c => bodyClassList.includes(c))) continue
                const decls: {prop: string, value: string, important: boolean}[] = []
                rule.walkDecls(d => {
                    decls.push({prop: d.prop, value: d.value, important: !!d.important})
                })
                found.push({spec: specificity(sel), order, decls})
            }
        })
    })
    found.sort((a, b) => a.spec - b.spec || a.order - b.order)
    const normal: Record<string, string> = {}
    const important: Record<string, string> = {}
    for (const f of found) for (const d of f.decls) (d.important ? important : normal)[d.prop] = d.value
    return {...normal, ...important}
}

/**
 * The value in px of a CSS length (`calc`, `var` with the given custom properties and their fallbacks, px, rem, and % of
 * `percentOf`)
 */
function evaluate(expr: string, percentOf: number, vars: Record<string, string>): number {
    let e = expr
    for (let i = 0; i < 8; i++) e = e.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, k, fb) => vars[k] ?? fb ?? 'NaN')
    const js = e.replace(/calc/g, '').replace(/(-?[\d.]+)rem/g, '($1*16)').replace(/(-?[\d.]+)px/g, '($1)').replace(/(-?[\d.]+)%/g, `($1*${percentOf}/100)`)
    if (!/^[\d\s.+\-*/()]+$/.test(js)) throw new Error('Cannot evaluate: ' + expr)
    return Function(`return (${js})`)() as number
}

type Layout = 'titlebar' | 'statusbar' | 'floating'
interface FrameState {
    left?: boolean, bottom?: boolean, panelHidden?: boolean
    /** The collapsed areas (EditorFrame.setAreaCollapsed) */
    collapsed?: ('left' | 'bottom')[]
    /** The sizes set inline on the body (EditorFrame.setAreaSize), like `--lay-left-area-size: 320px` */
    sizes?: Record<string, string>
    /** The area below the canvas on a phone (EditorFrame.setStackedArea) */
    stacked?: 'left' | 'bottom'
}

/** The classes of the body for a layout and its state, as EditorFrame and EditorModeBar set them */
function bodyClasses(layout: Layout, s: FrameState = {}) {
    return ['lay-frame', 'lay-' + layout, ...s.left ? ['lay-has-left'] : [], ...s.bottom ? ['lay-has-bottom'] : [], ...s.panelHidden ? ['mb-panel-hidden'] : [],
        ...(s.collapsed ?? []).map(a => 'lay-collapsed-' + a), ...s.stacked ? ['lay-stacked-' + s.stacked] : []]
}

/**
 * The custom properties of the body: --mb-width of the mode bar (on the root element, the names hidden) and
 * --tweakpane-ui-container-width of the Tweakpane UI (on the root element), its own, and the sizes set inline
 */
function bodyVars(layout: Layout, vp: Viewport, s: FrameState = {}) {
    const all = cascade(['body'], bodyClasses(layout, s), vp)
    return {'--mb-width': '44px', '--tweakpane-ui-container-width': '300px', ...Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('--'))), ...s.sizes}
}

/** The box of a fixed element, from its left, right, top, bottom, width and height, in px; null when it is not shown */
function box(targets: string[], layout: Layout, vp: Viewport, s: FrameState = {}) {
    const d = cascade(targets, bodyClasses(layout, s), vp)
    if (d.display === 'none') return null
    const vars = bodyVars(layout, vp, s)
    const v = (prop: string, of: number) => d[prop] === undefined || d[prop] === 'auto' ? undefined : evaluate(d[prop], of, vars)
    const side = (start: string, end: string, size: string, of: number) => {
        let [a, b, w] = [v(start, of), v(end, of), v(size, of)]
        if (d.inset === '0') [a, b] = [a ?? 0, b ?? 0]
        if (w === undefined && a !== undefined && b !== undefined) w = of - a - b
        if (a === undefined && b !== undefined && w !== undefined) a = of - b - w
        return [a, w]
    }
    const [left, width] = side('left', 'right', 'width', vp.width)
    const [top, height] = side('top', 'bottom', 'height', vp.height)
    return {left, top, width, height}
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
            expect(declarations('body.lay-floating .mb-root', vp).top).toBe('calc(var(--lay-gap) + var(--lay-right-start))')
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
            // a bar wider than the canvas overflows to the end only, so scrolling reaches its first buttons
            expect(bar['justify-content']).toBe('flex-start')
        }
    })

    it('splits a phone from a wide window at 920 px, as the frame does', () => {
        // 920 px wide is a wide window: the side by side frame, the tool bar and the perf pill of a desktop
        const pill = 'body.lay-frame .pp-root.pp-bottom-left .pp-pill'
        for (const vp of [{width: 920, height: 900}, {width: 920, height: 1200}]) {
            expect(declarations('body.lay-titlebar #tweakpaneUiContainer', vp).top, `${vp.width}x${vp.height}`).toBe('var(--lay-top)')
            expect(declarations(pill, vp).height).toBeUndefined()
            expect(declarations('.util-buttons-container', vp).gap).toBe('8px')
        }
        const narrow = {width: 919, height: 1200}
        expect(declarations('body.lay-titlebar #tweakpaneUiContainer', narrow).top).toContain('var(--lay-split)')
        expect(declarations(pill, narrow).height).toBe('32px')
        expect(declarations('.util-buttons-container', narrow).gap).toBe('2px')
    })

    it('keeps the perf pill and the bar of the sticky notes above it at one left edge', () => {
        for (const vp of [phone, phoneLandscape, desktop]) {
            const left = declarations('body.lay-frame .pp-root.pp-bottom-left', vp).left
            expect(left, `${vp.width}x${vp.height}`).toBe('var(--lay-corner-left)')
            expect(declarations('body.lay-frame .snp-dock', vp).left, `${vp.width}x${vp.height}`).toBe(left)
        }
        expect(declarations('body.lay-frame', desktop)['--lay-corner-left']).toBe('1.25rem')
        expect(declarations('body.lay-frame', phone)['--lay-corner-left']).toBe('0.75rem')
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

    it('keeps the floating tool bar in the part of the canvas that the panels and the left card do not cover', () => {
        // the floating canvas is the whole window and the bar moves left of the panels: its max-width must leave the
        // panels out, or a narrow window puts its first buttons left of the window, out of the bar's scroll
        // the left and right padding of a padding shorthand (1 to 4 values)
        const sidePad = (v: string) => {
            const p = v.split(/\s+/).map(x => evaluate(x, phone.width, {}))
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
                    for (const left of [false, true]) {
                        const vars: Record<string, string> = {...bodyVars('floating', vp, {left}), '--mb-width': mb}
                        if (pill) Object.assign(vars, declarations(pillContainer, vp))
                        const bar = Object.assign({}, ...barRules(pill).map(r => declarations(r, vp)))
                        const sidePadding = sidePad(bar.padding ?? declarations('.button-bar', vp).padding)
                        const right = evaluate(bar.right, vp.width, vars)
                        const maxWidth = evaluate(bar['max-width'], vp.width, vars)
                        const width = Math.max(0, maxWidth) + sidePadding
                        const panelLeft = vp.width - evaluate(vars['--lay-right-inset'], vp.width, vars) + 12 // the panel card's left edge
                        const leftCardRight = evaluate(vars['--lay-left-inset'], vp.width, vars) // with its gap; 0 without the card
                        // the right edge of the pill (moved by the left card): its left and its widest (the 76 px of a
                        // phone). When the canvas left of the panels has no room for the pill and a button (568 px with
                        // the mode names, which a narrow window hides at the first visit; or a left card), the bar has no
                        // width and only the window edge is checked
                        const pillRight = pill && maxWidth > 0 ? evaluate(declarations('body.lay-frame .pp-root.pp-bottom-left', vp).left, vp.width, vars) + leftCardRight + 76 : 0
                        const at = `${vp.width} px, mode bar ${mb}${pill ? ', perf pill' : ''}${left ? ', left area' : ''}`
                        expect(vp.width - right - width, `${at}: left edge`).toBeGreaterThanOrEqual(maxWidth > 0 ? Math.max(pillRight, leftCardRight) : 0)
                        expect(vp.width - right, `${at}: right edge`).toBeLessThanOrEqual(panelLeft)
                    }
                }
            }
        }
    })

    it('keeps the side by side frame in a wide window', () => {
        const canvas = declarations('body.lay-titlebar #canvas-container', desktop)
        const panel = declarations('body.lay-titlebar #tweakpaneUiContainer', desktop)
        expect(canvas.width).toBe('calc(100% - var(--lay-left-area) - var(--lay-right-area))')
        expect(canvas.height).toBe('calc(100% - var(--lay-top) - var(--lay-bottom) - var(--lay-bottom-area))')
        expect(panel.top).toBe('var(--lay-top)')
        expect(panel.width).toBe('var(--tweakpane-ui-container-width, 300px)')
        // floating: the panel and the mode bar are one card, joined without a gap or round corners at the join
        const floatPanel = declarations('body.lay-floating #tweakpaneUiContainer', desktop)
        const floatBar = declarations('body.lay-floating .mb-root', desktop)
        expect(floatPanel.right).toBe('calc(var(--mb-width, 44px) + var(--lay-gap) + var(--lay-right-offset))')
        expect(floatPanel['border-radius']).toBe('8px 0 0 8px')
        expect(floatBar['border-radius']).toBe('0 8px 8px 0')
        expect(declarations('body.lay-floating.mb-panel-hidden .mb-root', desktop)['border-radius']).toBe('8px')
    })
})

describe('tweakpane editor frame areas', () => {
    const canvas = ['#canvas-container']
    const panel = ['#tweakpaneUiContainer']
    const leftArea = ['.lay-area', '.lay-area-left']
    const bottomArea = ['.lay-area', '.lay-area-bottom']
    const corner = ['.pp-root.pp-bottom-left', '.snp-dock']
    /** The margins that move the perf pill and the bar of the sticky notes off the cards of the areas, in px */
    const cornerMargins = (layout: Layout, vp: Viewport, s: FrameState) => corner.map(t => {
        const [, , bottom, left] = cascade([t], bodyClasses(layout, s), vp).margin.split(/\s+(?![^(]*\))/)
        const vars = bodyVars(layout, vp, s)
        return [evaluate(left, vp.width, vars), evaluate(bottom, vp.height, vars)]
    })
    const toolBarMargin = (layout: Layout, vp: Viewport, s: FrameState) =>
        evaluate(cascade(['.util-buttons-container'], bodyClasses(layout, s), vp)['margin-bottom'], vp.height, bodyVars(layout, vp, s))

    // the canvas, the panel and the corner of each layout without areas: the frame of before the areas
    const before = {
        titlebar: {canvas: {left: 0, top: 36, width: 1096, height: 864}, panel: {left: 1096, top: 36, width: 300, height: 864}},
        statusbar: {canvas: {left: 0, top: 0, width: 1096, height: 874}, panel: {left: 1096, top: 0, width: 300, height: 874}},
        floating: {canvas: {left: 0, top: 0, width: 1440, height: 900}, panel: {left: 1084, top: 12, width: 300, height: 876}},
    }

    for (const layout of ['titlebar', 'statusbar', 'floating'] as const) {
        it(`${layout}: an empty left and bottom area take no room, and nothing moves`, () => {
            for (const panelHidden of [false, true]) {
                const s = {panelHidden}
                const vars = bodyVars(layout, desktop, s)
                expect([vars['--lay-left-area'], vars['--lay-bottom-area'], vars['--lay-left-inset'], vars['--lay-bottom-inset']]).toEqual(['0px', '0px', '0px', '0px'])
                expect(box(leftArea, layout, desktop, s), 'left area').toBeNull()
                expect(box(bottomArea, layout, desktop, s), 'bottom area').toBeNull()
                const c = before[layout].canvas
                // the panel hidden: the canvas takes its room, except in floating (the canvas is the whole window)
                expect(box(canvas, layout, desktop, s)).toEqual(panelHidden && layout !== 'floating' ? {...c, width: c.width + 300} : c)
                expect(cornerMargins(layout, desktop, s)).toEqual([[0, 0], [0, 0]])
                expect(toolBarMargin(layout, desktop, s)).toBe(0)
            }
            expect(box(panel, layout, desktop)).toEqual(before[layout].panel)
        })

        it(`${layout}: an element in the left area shows it and sets the width variable`, () => {
            const s = {left: true}
            const vars = bodyVars(layout, desktop, s)
            expect(vars['--lay-left-area-size']).toBe('240px')
            expect(evaluate(vars['--lay-left-area'], desktop.width, vars)).toBe(240)
            const area = box(leftArea, layout, desktop, s)
            const c = before[layout].canvas
            if (layout === 'floating') {
                // a card over the canvas, with the gap of the panel card; the canvas does not change
                // below the head of the floating layout: 36 px and a gap
                expect(area).toEqual({left: 12, top: 60, width: 240, height: 828})
                expect(box(canvas, layout, desktop, s)).toEqual(c)
                // the perf pill and the bar of the sticky notes keep out of the card: its width and the gap
                expect(cornerMargins(layout, desktop, s)).toEqual([[252, 0], [252, 0]])
            } else {
                // from bar to bar at the left; the canvas is narrower
                expect(area).toEqual({left: 0, top: c.top, width: 240, height: c.height})
                expect(box(canvas, layout, desktop, s)).toEqual({...c, left: 240, width: c.width - 240})
                // the canvas moved: the pill and the bar of the sticky notes in it move with it
                expect(cornerMargins(layout, desktop, s)).toEqual([[0, 0], [0, 0]])
            }
            expect(box(panel, layout, desktop, s)).toEqual(before[layout].panel)
            expect(box(bottomArea, layout, desktop, s)).toBeNull()
        })

        it(`${layout}: an element in the bottom area shows it below the canvas, between the left area and the panel`, () => {
            for (const panelHidden of [false, true]) {
                const s = {left: true, bottom: true, panelHidden}
                const right = panelHidden ? 44 : 344 // the mode bar, and the panel
                const area = box(bottomArea, layout, desktop, s)
                const c = before[layout].canvas
                if (layout === 'floating') {
                    expect(area).toEqual({left: 264, top: 900 - 12 - 160, width: 1440 - 264 - right - 24, height: 160})
                    expect(box(canvas, layout, desktop, s)).toEqual(c)
                    expect(cornerMargins(layout, desktop, s)).toEqual([[252, 172], [252, 172]])
                    expect(toolBarMargin(layout, desktop, s)).toBe(172)
                } else {
                    expect(area).toEqual({left: 240, top: c.top + c.height - 160, width: 1440 - 240 - right, height: 160})
                    expect(box(canvas, layout, desktop, s)).toEqual({left: 240, top: c.top, width: 1440 - 240 - right, height: c.height - 160})
                    expect(toolBarMargin(layout, desktop, s)).toBe(0)
                }
            }
        })

        it(`${layout}: a narrow portrait window hides the areas, and they take no room`, () => {
            const s = {left: true, bottom: true}
            expect(box(leftArea, layout, phone, s)).toBeNull()
            expect(box(bottomArea, layout, phone, s)).toBeNull()
            const vars = bodyVars(layout, phone, s)
            for (const k of ['--lay-left-area', '--lay-bottom-area', '--lay-left-inset', '--lay-bottom-inset']) {
                expect(evaluate(vars[k], phone.width, vars), k).toBe(0)
            }
            expect(cascade(canvas, bodyClasses(layout, s), phone).width).toBe('100%')
        })

        it(`${layout}: on a phone, the left or the bottom area picked for below the canvas takes the place of the panel`, () => {
            const panelBox = box(panel, layout, phone, {})
            for (const stacked of ['left', 'bottom'] as const) {
                const s = {left: true, bottom: true, stacked}
                const [shown, other] = stacked === 'left' ? [leftArea, bottomArea] : [bottomArea, leftArea]
                // next to the mode bar, from the canvas to the bottom of the window, as the panel; the panel hides
                expect(box(shown, layout, phone, s), stacked).toEqual(panelBox)
                expect(box(other, layout, phone, s), stacked).toBeNull()
                expect(box(panel, layout, phone, s), stacked).toBeNull()
                expect(cascade(canvas, bodyClasses(layout, s), phone).height).toBe(cascade(canvas, bodyClasses(layout, {}), phone).height)
                // the open mode is not marked: a tap on it shows the panel again
                expect(cascade(['.mb-btn.on'], bodyClasses(layout, s), phone).background, stacked).toBe('transparent')
                expect(cascade(['.mb-btn.on'], bodyClasses(layout, {left: true, bottom: true}), phone).background, stacked).not.toBe('transparent')
                // the mode bar hides the part below the canvas: the area hides with it
                expect(box(shown, layout, phone, {...s, panelHidden: true}), stacked).toBeNull()
                // a collapsed area shows there too
                expect(box(shown, layout, phone, {...s, collapsed: [stacked]}), stacked).toEqual(panelBox)
                // an empty area: the panel
                expect(box(panel, layout, phone, {stacked}), stacked).toEqual(panelBox)
                // a wide or a landscape window shows all the areas, and the panel
                // where they are, as without the pick (the pick is kept for the next narrow window)
                for (const vp of [desktop, phoneLandscape]) {
                    expect(box(panel, layout, vp, s), stacked).not.toBeNull()
                    for (const area of [leftArea, bottomArea]) {
                        expect(box(area, layout, vp, s), stacked).toEqual(box(area, layout, vp, {left: true, bottom: true}))
                    }
                }
            }
        })

        it(`${layout}: a narrow landscape window (under 700 px) shows the areas in the place of the panel, one at a time`, () => {
            const narrow: Viewport = {width: 640, height: 360}
            const panelBox = box(panel, layout, narrow, {})
            // side by side: the panel next to the mode bar (with the gap of the cards in floating)
            expect(panelBox!.left! + panelBox!.width!).toBe(640 - 44 - (layout === 'floating' ? 12 : 0))
            const s = {left: true, bottom: true}
            // no room next to the canvas: the areas take none
            expect(box(leftArea, layout, narrow, s)).toBeNull()
            expect(box(bottomArea, layout, narrow, s)).toBeNull()
            const vars = bodyVars(layout, narrow, s)
            for (const k of ['--lay-left-area', '--lay-bottom-area', '--lay-left-inset', '--lay-bottom-inset']) {
                expect(evaluate(vars[k], narrow.width, vars), k).toBe(0)
            }
            expect(box(canvas, layout, narrow, s)).toEqual(box(canvas, layout, narrow, {}))
            // an entry picks one: it has the box of the panel, and the panel hides
            for (const stacked of ['left', 'bottom'] as const) {
                const shown = stacked === 'left' ? leftArea : bottomArea
                expect(box(shown, layout, narrow, {...s, stacked}), stacked).toEqual(panelBox)
                expect(box(panel, layout, narrow, {...s, stacked}), stacked).toBeNull()
                expect(box(shown, layout, narrow, {...s, stacked, panelHidden: true}), stacked).toBeNull()
            }
            // 700 px and wider: side by side, all of them
            expect(box(leftArea, layout, {width: 800, height: 360}, s)).not.toBeNull()
        })

        it(`${layout}: the entries of the areas in the mode bar: marked while their area shows, a row with the hidden panel`, () => {
            // the colour of the mark: the grey of the labels, unless the app gives one (inline --mb-color)
            expect(cascade(['.lay-area-entry'], bodyClasses(layout, {left: true}), desktop)['--mb-color']).toBe('var(--tp-label-foreground-color, #8a8f98)')
            for (const vp of [phone, desktop]) {
                expect(cascade(['.mb-btn.lay-entry-on'], bodyClasses(layout, {left: true}), vp).background).toContain('color-mix')
                // an area shown below the canvas unmarks the open mode, not the entry
                expect(cascade(['.mb-btn.lay-entry-on'], bodyClasses(layout, {left: true, stacked: 'left'}), vp).background).toContain('color-mix')
            }
            expect(cascade(['.lay-area-entries', '.mb-root > .lay-area-entries'], bodyClasses(layout, {left: true, panelHidden: true}), phone)['flex-direction']).toBe('row')
            expect(cascade(['.lay-area-entries', '.mb-root > .lay-area-entries'], bodyClasses(layout, {left: true, panelHidden: true}), desktop)['flex-direction']).toBe('column')
        })
    }

    it('a stack: a line between the sections; in the floating layout, each section is a card and the split is a gap with dots', () => {
        const s = {left: true}
        const docked = (t: string[]) => cascade(t, bodyClasses('titlebar', s), desktop)
        const float = (t: string[]) => cascade(t, bodyClasses('floating', s), desktop)
        expect(docked(['.lay-area > .lay-split'])).toMatchObject({flex: '0 0 1px', background: 'var(--tp-container-border-color, #e6e6e6)'})
        expect(docked(['.lay-area-left > .lay-split']).cursor).toBe('row-resize')
        expect(docked(['.lay-area-bottom > .lay-split']).cursor).toBe('col-resize')
        expect(docked(['.lay-area-bottom.lay-split-area'])['flex-direction']).toBe('row')
        expect(docked(['.lay-area > .lay-section'])).toMatchObject({flex: '1 1 0', overflow: 'hidden'})
        // floating: the area has no card of its own, its sections are cards
        expect(float(['.lay-area.lay-split-area'])).toMatchObject({background: 'transparent', 'box-shadow': 'none'})
        expect(float(['.lay-split-area > .lay-section'])).toMatchObject({'border-radius': '8px', 'box-shadow': 'var(--lay-card-shadow)'})
        expect(float(['.lay-split-area > .lay-split'])).toMatchObject({'flex-basis': 'var(--lay-gap)', background: 'transparent'})
        expect(float(['.lay-area-left.lay-split-area > .lay-split::before'])).toMatchObject({width: '24px', height: '4px'})
        expect(float(['.lay-split-area > .lay-split::before']).opacity).toBe('0.6')
        expect(docked(['.lay-area > .lay-split:hover'])['--lay-grip-color']).toBe('#0d99ff')
    })

    it('floating: the offsets and the spans move the cards, their edges, grips and ends, and the insets', () => {
        const s = {left: true, bottom: true, sizes: {
            '--lay-left-offset': '20px', '--lay-left-start': '100px', '--lay-left-length': '400px',
            '--lay-right-offset': '30px', '--lay-right-start': '50px', '--lay-right-length': '500px',
            '--lay-bottom-offset': '10px', '--lay-bottom-start': '40px', '--lay-bottom-length': '300px',
        }}
        const at = (t: string[]) => box(t, 'floating', desktop, s)
        // the left card starts below the head (36 px and a gap), 100 px on; the head moves with it on the x axis
        expect(at(leftArea)).toEqual({left: 32, top: 160, width: 240, height: 400})
        expect(at(['.lay-bar', '.lay-head'])).toEqual({left: 32, top: 12, width: 240, height: 36})
        expect(box(['.lay-bar', '.lay-head'], 'titlebar', desktop, s)).toBeNull()
        // the panel and the mode bar move together: right 12 + 30, then the mode bar (44)
        expect(at(panel)).toEqual({left: 1440 - 42 - 44 - 300, top: 62, width: 300, height: 500})
        const bar = cascade(['.mb-root'], bodyClasses('floating', s), desktop)
        const vars = bodyVars('floating', desktop, s)
        expect([bar.right, bar.top, bar.height].map(v => evaluate(v, 900, vars))).toEqual([42, 62, 500])
        // the bottom card in its row: after the left card (12 + 20 + 240) and its gap, 40 px on
        expect(at(bottomArea)).toEqual({left: 272 + 12 + 40, top: 900 - 22 - 160, width: 300, height: 160})
        // the inner edges follow the cards
        expect(at(['.lay-handle', '.lay-handle-left'])).toEqual({left: 32 + 240 - 3, top: 160, width: 6, height: 400})
        expect(at(['.lay-handle', '.lay-handle-bottom'])).toEqual({left: 324, top: 900 - 22 - 160 - 3, width: 300, height: 6})
        // the grip is in the gap on the side of the window; the ends are on the ends of the card
        expect(at(['.lay-grip', '.lay-grip-left'])).toEqual({left: 22, top: 160, width: 8, height: 400})
        expect(at(['.lay-grip', '.lay-grip-right'])).toEqual({left: 1440 - 32 - 8, top: 62, width: 8, height: 500})
        expect(at(['.lay-end', '.lay-end-left', '.lay-end-left-start'])).toEqual({left: 32, top: 157, width: 240, height: 6})
        expect(at(['.lay-end', '.lay-end-left', '.lay-end-left-end'])).toEqual({left: 32, top: 557, width: 240, height: 6})
        expect(at(['.lay-end', '.lay-end-bottom', '.lay-end-bottom-end'])).toEqual({left: 324 + 300 - 3, top: 718, width: 6, height: 160})
        // the pill and the bar of the sticky notes keep out of the column of the left card and the row of the bottom card
        expect(cornerMargins('floating', desktop, s)).toEqual([[272, 182], [272, 182]])
        // the line of an edge stops at the round corners
        const line = (layout: Layout, t: string) => cascade(['.lay-handle::after', `.lay-${t}::after`], bodyClasses(layout, s), desktop)
        expect(line('floating', 'handle-bottom')).toMatchObject({left: '8px', right: '8px'})
        expect(line('floating', 'handle-left')).toMatchObject({top: '8px', bottom: '8px'})
        expect(line('titlebar', 'handle-bottom')).toMatchObject({left: '0', right: '0'})
        // the dots of a grip always show; blue on hover
        expect(cascade(['.lay-grip::after'], bodyClasses('floating', s), desktop).opacity).toBe('0.6')
        expect(cascade(['.lay-grip:hover'], bodyClasses('floating', s), desktop)['--lay-grip-color']).toBe('#0d99ff')
        // the view widget of the canvas: right of the left card; below the head when no left card shows
        const widget = (state: typeof s | {collapsed?: ('left' | 'bottom')[], left?: boolean}) => {
            const d = cascade(['.editor-view-widget'], bodyClasses('floating', state), desktop)
            const v = bodyVars('floating', desktop, state)
            return [evaluate(d['margin-left'] ?? '0px', 1440, v), evaluate(d['margin-top'] ?? '0px', 900, v)]
        }
        expect(widget(s)).toEqual([272, 0])
        expect(widget({})).toEqual([0, 48])
        expect(widget({left: true, collapsed: ['left']})).toEqual([0, 48])
        // no grips or ends: in the other layouts, for a collapsed card, and when the areas show one at a time
        expect(box(['.lay-grip', '.lay-grip-left'], 'titlebar', desktop, s)).toBeNull()
        expect(box(['.lay-grip', '.lay-grip-left'], 'floating', desktop, {...s, collapsed: ['left']})).toBeNull()
        expect(box(['.lay-end', '.lay-end-right', '.lay-end-right-start'], 'floating', {width: 640, height: 360}, s)).toBeNull()
        expect(box(['.lay-grip', '.lay-grip-right'], 'floating', desktop, {})).not.toBeNull()
        // no offsets or spans: the cards fill their sides as before
        expect(box(leftArea, 'floating', desktop, {left: true})).toEqual({left: 12, top: 60, width: 240, height: 828})
        expect(box(panel, 'floating', desktop, {})).toEqual(before.floating.panel)
    })
})

describe('tweakpane editor frame: area sizes and edges', () => {
    const canvas = ['#canvas-container']
    const panel = ['#tweakpaneUiContainer']
    const leftArea = ['.lay-area', '.lay-area-left']
    const bottomArea = ['.lay-area', '.lay-area-bottom']
    const handle = (area: string) => ['.lay-handle', '.lay-handle-' + area]

    for (const layout of ['titlebar', 'statusbar', 'floating'] as const) {
        it(`${layout}: the edges are on the inner edge of the left area, the bottom area and the panel, 6 px wide`, () => {
            const s = {left: true, bottom: true}
            const l = box(leftArea, layout, desktop, s)!, b = box(bottomArea, layout, desktop, s)!, p = box(panel, layout, desktop, s)!
            expect(box(handle('left'), layout, desktop, s)).toEqual({left: l.left! + l.width! - 3, top: l.top, width: 6, height: l.height})
            expect(box(handle('bottom'), layout, desktop, s)).toEqual({left: b.left, top: b.top! - 3, width: b.width, height: 6})
            expect(box(handle('right'), layout, desktop, s)).toEqual({left: p.left! - 3, top: p.top, width: 6, height: p.height})
        })

        it(`${layout}: no edge for an empty area or a hidden panel`, () => {
            expect(box(handle('left'), layout, desktop, {})).toBeNull()
            expect(box(handle('bottom'), layout, desktop, {})).toBeNull()
            expect(box(handle('right'), layout, desktop, {panelHidden: true})).toBeNull()
        })

        it(`${layout}: a collapsed area is hidden and takes no room; its edge stays at the side`, () => {
            const s = {left: true, bottom: true, collapsed: ['left', 'bottom'] as ('left' | 'bottom')[]}
            expect(box(leftArea, layout, desktop, s)).toBeNull()
            expect(box(bottomArea, layout, desktop, s)).toBeNull()
            const vars = bodyVars(layout, desktop, s)
            for (const k of ['--lay-left-area', '--lay-bottom-area', '--lay-left-inset', '--lay-bottom-inset']) {
                expect(evaluate(vars[k], desktop.width, vars), k).toBe(0)
            }
            // the canvas is as without the areas
            expect(box(canvas, layout, desktop, s)).toEqual(box(canvas, layout, desktop, {}))
            // inside the window (in the gap of floating), so all of the edge can be grabbed
            const inset = layout === 'floating' ? 12 - 3 : 0
            expect(box(handle('left'), layout, desktop, s)!.left).toBe(inset)
            const bh = box(handle('bottom'), layout, desktop, s)!
            expect(bh.top! + bh.height!).toBe(desktop.height - (layout === 'statusbar' ? 26 : 0) - inset)
        })

        it(`${layout}: the sizes set on the body move the areas, the panel and the canvas`, () => {
            const s = {left: true, bottom: true, sizes: {'--lay-left-area-size': '320px', '--lay-bottom-area-size': '200px', '--tweakpane-ui-container-width': '400px'}}
            expect(box(leftArea, layout, desktop, s)!.width).toBe(320)
            expect(box(bottomArea, layout, desktop, s)!.height).toBe(200)
            expect(box(panel, layout, desktop, s)!.width).toBe(400)
            if (layout !== 'floating') {
                const c = box(canvas, layout, desktop, s)!
                expect([c.left, c.width]).toEqual([320, 1440 - 320 - 400 - 44])
            }
            expect(box(handle('left'), layout, desktop, s)!.left).toBe((layout === 'floating' ? 12 : 0) + 320 - 3)
        })

        it(`${layout}: a narrow portrait window has no edges`, () => {
            const s = {left: true, bottom: true}
            for (const area of ['left', 'bottom', 'right']) expect(box(handle(area), layout, phone, s), area).toBeNull()
        })
    }
})

describe('tweakpane editor classic page', () => {
    it('the mode tabs are as wide as their buttons, in the middle of the top', () => {
        // the CSS minifier of the build keeps only the last declaration of a property: a vendor fallback after
        // `fit-content` (like `-moz-fit-content`) is the one kept, and Chrome drops it, so the bar took the full width
        expect(declarations('.button-bar', desktop).width).toBe('fit-content')
        const tabs = declarations('.mode-buttons-container', desktop)
        expect([tabs.left, tabs.right, tabs['margin-left'], tabs['margin-right']]).toEqual(['0', '0', 'auto', 'auto'])
    })
})
