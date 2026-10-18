/**
 * Curve operations: Resample Curve (`node_geo_curve_resample.cc`), Trim Curve (`node_geo_curve_trim.cc`) and Reverse Curve
 * (`node_geo_curve_reverse.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {CurvesEvaluator} from '../../geometry/curvesEval'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {countFromLength, resampleToEvaluated, resampleToUniform} from '../../geometry/resampleCurves'
import {trimCurves} from '../../geometry/trimCurves'
import {reverseCurves} from '../../geometry/curvesEdit'
import {subdivideCurves} from '../../geometry/subdivideCurves'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeResampleCurve',
    label: 'Resample Curve',
    // `node_init` (:87).
    properties: {keep_last_segment: true},
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        // Menu values are the item names (`mode_items` :16: Evaluated, Count, Length).
        b.input('MENU', 'Mode').default('Count')
        b.input('INT', 'Count').default(10).min(1).max(100000).field()
        b.input('FLOAT', 'Length').default(0.1).min(0.01).subtype('DISTANCE').field()
    },
    // `node_geo_exec` (:94).
    execute(p) {
        const mode = p.string('Mode')
        if (mode !== 'Evaluated' && mode !== 'Count' && mode !== 'Length') throw new Error(`Resample Curve: mode '${mode}' is not a menu item`)
        const keepLastSegment = !!p.node.prop<boolean>('keep_last_segment')
        const selectionField = p.field('Selection')
        const countField = mode === 'Count' ? p.field('Count') : undefined
        const lengthField = mode === 'Length' ? p.field('Length') : undefined
        p.set('Curve', foreachRealGeometry(p.geometry('Curve'), g => {
            const src = g.curves
            if (!src) return
            let dst: CurvesGeometry
            if (src.curvesNum === 0) {
                // `return {}` (resample_curves.cc:425), materials from `curves_copy_parameters`.
                dst = new CurvesGeometry(0, 0)
            } else {
                // `bke::CurvesFieldContext{curves, AttrDomain::Curve}`.
                const e = new FieldEvaluation(new FieldContext('curves', src, AttrDomain.Curve), src.curvesNum)
                const selection = e.evaluate(selectionField).materialize()
                if (mode === 'Evaluated') {
                    dst = resampleToEvaluated(src, selection)
                } else {
                    const counts = new Int32Array(src.curvesNum)
                    if (countField) {
                        // `get_count_input_max_one` (:27): `max(int, int)` with 1.
                        const c = e.evaluate(countField)
                        for (let i = 0; i < src.curvesNum; i++) counts[i] = Math.max(1, c.get(i, 0))
                    } else {
                        // `get_count_input_from_length` (:47): `CurveLengthFieldInput` and `get_count_from_length`.
                        const l = e.evaluate(lengthField!)
                        const ev = new CurvesEvaluator(src)
                        for (let i = 0; i < src.curvesNum; i++) counts[i] = countFromLength(ev.lengthTotal(i), l.get(i, 0), keepLastSegment)
                    }
                    dst = resampleToUniform(src, selection, counts)
                }
            }
            dst.materials = src.materials.slice()
            g.setCurves(dst)
        }, p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodeTrimCurve',
    label: 'Trim Curve',
    // `node_init` (:93).
    properties: {mode: 'FACTOR'},
    enums: {mode: ['FACTOR', 'LENGTH']},
    declare(b, node) {
        const factor = node.prop<string>('mode') === 'FACTOR'
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('FLOAT', 'Start').min(0).max(1).subtype('FACTOR').field().available(factor)
        b.input('FLOAT', 'End').min(0).max(1).default(1).subtype('FACTOR').field().available(factor)
        b.input('FLOAT', 'Start', 'Start_001').min(0).subtype('DISTANCE').field().available(!factor)
        b.input('FLOAT', 'End', 'End_001').min(0).default(1).subtype('DISTANCE').field().available(!factor)
    },
    // `node_geo_exec` (:224).
    execute(p) {
        const factor = p.node.prop<string>('mode') === 'FACTOR'
        const selectionField = p.field('Selection')
        const startField = p.field(factor ? 'Start' : 'Start_001')
        const endField = p.field(factor ? 'End' : 'End_001')
        p.set('Curve', foreachRealGeometry(p.geometry('Curve'), g => {
            // `geometry_set_curve_trim` (:184) and `trim_curves` (:150).
            const src = g.curves
            if (!src || src.curvesNum === 0) return
            const e = new FieldEvaluation(new FieldContext('curves', src, AttrDomain.Curve), src.curvesNum)
            const sel = e.evaluate(selectionField)
            const starts = e.evaluate(startField).materialize()
            const ends = e.evaluate(endField).materialize()
            const selection: number[] = []
            for (let i = 0; i < src.curvesNum; i++) if (sel.get(i, 0)) selection.push(i)
            if (selection.length === 0) return
            const dst = trimCurves(src, selection, starts, ends, factor)
            dst.materials = src.materials.slice()
            g.setCurves(dst)
        }, p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodeReverseCurve',
    label: 'Reverse Curve',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
    },
    // `node_geo_exec` (`node_geo_curve_reverse.cc:57`) with `reverse_curve` (:25).
    execute(p) {
        const selectionField = p.field('Selection')
        p.set('Curve', foreachRealGeometry(p.geometry('Curve'), g => {
            const src = g.curves
            if (!src) return
            const sel = new FieldEvaluation(new FieldContext('curves', src, AttrDomain.Curve), src.curvesNum).evaluate(selectionField)
            const mask: number[] = []
            for (let i = 0; i < src.curvesNum; i++) if (sel.get(i)) mask.push(i)
            if (!mask.length) return
            reverseCurves(g.curvesForWrite()!, mask)
        }, p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodeSubdivideCurve',
    label: 'Subdivide Curve',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('INT', 'Cuts').default(1).min(0).max(1000).field()
    },
    // `node_geo_exec` (`node_geo_curve_subdivide.cc:79`) with `subdivide_curves` (:28).
    execute(p) {
        const cutsField = p.field('Cuts')
        p.set('Curve', foreachRealGeometry(p.geometry('Curve'), g => {
            const src = g.curves
            if (!src) return
            const cuts = new FieldEvaluation(new FieldContext('curves', src, AttrDomain.Point), src.pointsNum).evaluate(cutsField)
            if (cuts.isSingle && cuts.get(0) < 1) return
            const dst = subdivideCurves(src, cuts.isSingle ? new Int32Array(src.pointsNum).fill(cuts.get(0)) : cuts.materialize())
            g.setCurves(dst)
        }, p.options.scene))
    },
})
