/**
 * Parity cases for Float Curve (curve mappings with every handle type, clipping on/off, horizontal and
 * extrapolated extension, points outside the clip rectangle) and Color Ramp (every interpolation, the HSV/HSL
 * colour modes with each hue interpolation, one-element and off-range bands). Inputs run past both ends.
 * The DSL has no argument for a node's `curveMapping` / `colorRamp`, so the cases attach them to the built
 * node JSON by node name.
 */

import {GroupBuilder, Socket} from '../../../src/dsl/builder'
import type {CurveMappingJSON} from '../../../src/blender/math/curveMapping'
import type {ColorRampJSON} from '../../../src/blender/math/colorband'
import type {NodeJSON} from '../../../src/runtime/types'
import {Inputs, outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

const N = 64

type Extra = {curveMapping?: CurveMappingJSON, colorRamp?: ColorRampJSON}

/** A points case whose nodes get `extra` JSON attached after the tree is built. */
function caseWithData(id: string, description: string, count: number, body: (v: Inputs, g: GroupBuilder, attach: (name: string, extra: Extra) => void) => Record<string, Socket>): ParityCase {
    const extras = new Map<string, Extra>()
    const c = pointsCase(id, description, count, (v, g) => body(v, g, (name, extra) => extras.set(name, extra)))
    for (const node of c.library[id].nodes as NodeJSON[]) {
        const e = extras.get(node.name)
        if (e) Object.assign(node, e)
    }
    return c
}

const pts = (handle: string, ...xy: number[][]) => xy.map(([x, y]) => ({location: [x, y], handleType: handle}))

const CURVES: Record<string, CurveMappingJSON | undefined> = {
    default: undefined,
    auto: {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: true, extend: 'EXTRAPOLATED',
        curves: [{points: pts('AUTO', [0, 0.1], [0.25, 0.8], [0.5, 0.3], [0.8, 0.95], [1, 0.2])}]},
    'auto-horizontal-noclip': {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: false, extend: 'HORIZONTAL',
        curves: [{points: pts('AUTO', [0, 0.1], [0.25, 0.8], [0.5, 0.3], [0.8, 0.95], [1, 0.2])}]},
    'auto-clamped': {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: true, extend: 'EXTRAPOLATED',
        curves: [{points: pts('AUTO_CLAMPED', [0, 0.1], [0.2, 0.9], [0.45, 0.2], [0.7, 0.6], [0.85, 0.55], [1, 1])}]},
    vector: {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: false, extend: 'EXTRAPOLATED',
        curves: [{points: pts('VECTOR', [0, 0.3], [0.4, 0.9], [0.6, 0.1], [1, 0.7])}]},
    mixed: {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: false, extend: 'EXTRAPOLATED',
        curves: [{points: [
            ...pts('VECTOR', [0.05, 0.2]), ...pts('AUTO', [0.3, 0.7]), ...pts('AUTO_CLAMPED', [0.5, 0.65]),
            ...pts('VECTOR', [0.7, 0.1]), ...pts('AUTO', [0.95, 0.9]),
        ]}]},
    'wide-clip': {clipMinX: -2, clipMinY: -1, clipMaxX: 2, clipMaxY: 1.5, useClip: true, extend: 'EXTRAPOLATED',
        curves: [{points: pts('AUTO', [-1.5, -2], [-0.2, 1.4], [0.7, -0.6], [1.8, 3])}]},
    // Points outside the clip rectangle widen the table range (mintable/maxtable).
    'outside-clip': {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: false, extend: 'HORIZONTAL',
        curves: [{points: pts('AUTO', [-0.5, 0.2], [0.5, 0.5], [1.5, 0.9])}]},
    steep: {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: false, extend: 'EXTRAPOLATED',
        curves: [{points: pts('AUTO', [0.3, 0], [0.31, 1])}]},
    'two-vector': {clipMinX: 0, clipMinY: 0, clipMaxX: 1, clipMaxY: 1, useClip: true, extend: 'EXTRAPOLATED',
        curves: [{points: pts('VECTOR', [0.2, 0.8], [0.9, 0.1])}]},
}

const color = (r: number, g: number, b: number, a: number) => [r, g, b, a]
const el = (position: number, c: number[]) => ({position, color: c})
const STOPS = [el(0.1, color(0.9, 0.1, 0.2, 1)), el(0.35, color(0.2, 0.8, 0.3, 0.5)), el(0.6, color(0.1, 0.2, 0.95, 0.8)), el(0.9, color(1, 0.9, 0.05, 0.2))]

const RAMPS: Record<string, ColorRampJSON | undefined> = {default: undefined}
for (const interpolation of ['LINEAR', 'EASE', 'CONSTANT', 'B_SPLINE', 'CARDINAL']) {
    RAMPS[`rgb-${interpolation.toLowerCase().replace('_', '-')}`] = {interpolation, colorMode: 'RGB', hueInterpolation: 'NEAR', elements: STOPS}
}
for (const colorMode of ['HSV', 'HSL']) {
    for (const hue of ['NEAR', 'FAR', 'CW', 'CCW']) {
        RAMPS[`${colorMode.toLowerCase()}-${hue.toLowerCase()}`] = {interpolation: 'LINEAR', colorMode, hueInterpolation: hue, elements: [
            el(0, color(1, 0, 0, 1)), el(0.3, color(0.2, 0.2, 1, 0.6)), el(0.55, color(0.5, 0.5, 0.5, 1)), el(0.8, color(0.1, 0.9, 0.4, 0.3)), el(1, color(0.9, 0.1, 0.8, 1)),
        ]}
    }
}
RAMPS.single = {interpolation: 'LINEAR', colorMode: 'RGB', hueInterpolation: 'NEAR', elements: [el(0.4, color(0.3, 0.6, 0.9, 0.7))]}
RAMPS['b-spline-two'] = {interpolation: 'B_SPLINE', colorMode: 'RGB', hueInterpolation: 'NEAR', elements: [el(0.2, color(0, 0.5, 1, 1)), el(0.7, color(1, 0.25, 0, 0))]}
RAMPS['cardinal-three'] = {interpolation: 'CARDINAL', colorMode: 'RGB', hueInterpolation: 'NEAR', elements: [el(0, color(0, 0, 0, 1)), el(0.5, color(1, 0.2, 0.6, 1)), el(1, color(0.3, 1, 0.1, 0.5))]}
RAMPS['ease-same-position'] = {interpolation: 'EASE', colorMode: 'RGB', hueInterpolation: 'NEAR', elements: [el(0.25, color(0.1, 0.1, 0.1, 1)), el(0.5, color(0.7, 0.3, 0.2, 1)), el(0.5, color(0.7, 0.3, 0.2, 1)), el(0.75, color(0.2, 0.9, 0.9, 0.4))]}

export function functionCurvesCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const [name, mapping] of Object.entries(CURVES)) {
        cases.push(caseWithData(`float-curve-${name}`, `Float Curve ${name}`, N, (v, g, attach) => {
            const out: Record<string, Socket> = {}
            const sets: [string, Socket | number, Socket | number][] = [
                ['a', 1, v.noise(1, -0.75, 1.75)],
                ['b', v.digit(4, 2, -0.5, 0.5), v.digit(16, 0, -0.5, 0.125)],
                ['c', v.noise(2, -1, 2), v.digit(8, 0, -0.25, 0.1875)],
            ]
            for (const [set, factor, value] of sets) {
                const node = g.node('ShaderNodeFloatCurve', {factor, value})
                if (mapping) attach(node.name, {curveMapping: mapping})
                Object.assign(out, outputsOf(node, `${set}_`))
            }
            return out
        }))
    }
    cases.push(caseWithData('float-curve-single', 'Float Curve on single values', 1, (_v, g, attach) => {
        const out: Record<string, Socket> = {}
        ;[[1, 0.37], [0.4, 0.9], [1, -3], [1, 5], [-0.5, 0.5]].forEach(([factor, value], i) => {
            const node = g.node('ShaderNodeFloatCurve', {factor, value})
            attach(node.name, {curveMapping: CURVES.auto})
            Object.assign(out, outputsOf(node, `s${i}_`))
        })
        return out
    }))
    for (const [name, ramp] of Object.entries(RAMPS)) {
        cases.push(caseWithData(`color-ramp-${name}`, `Color Ramp ${name}`, N, (v, g, attach) => {
            const out: Record<string, Socket> = {}
            // Element positions hit exactly (digits of 0.05), and noise past both ends.
            for (const [set, fac] of [['a', v.digit(32, 0, -0.25, 0.05)], ['b', v.noise(3, -0.3, 1.3)]] as [string, Socket][]) {
                const node = g.node('ShaderNodeValToRGB', {fac})
                if (ramp) attach(node.name, {colorRamp: ramp})
                Object.assign(out, outputsOf(node, `${set}_`))
            }
            return out
        }))
    }
    cases.push(caseWithData('color-ramp-single-values', 'Color Ramp on single values', 1, (_v, g, attach) => {
        const out: Record<string, Socket> = {}
        ;[['rgb-b-spline', 0.47], ['hsv-far', 0.66], ['rgb-constant', 0.35], ['rgb-ease', 1.2]].forEach(([name, fac], i) => {
            const node = g.node('ShaderNodeValToRGB', {fac})
            attach(node.name, {colorRamp: RAMPS[name as string]})
            Object.assign(out, outputsOf(node, `s${i}_`))
        })
        return out
    }))
    return cases
}
