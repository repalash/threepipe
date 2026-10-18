/**
 * Parity cases for Float to Integer, Bit Math, Axes to Rotation, Combine / Separate / Transpose Matrix, Matrix
 * Determinant, Project Point and the string nodes. String results become attribute names (and lengths / positions
 * attribute values), so Blender's output geometry carries them.
 */

import {AnySocket, geometryNodes, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

const N = 64

export function functionMiscCases(): ParityCase[] {
    const cases: ParityCase[] = []
    cases.push(pointsCase('float-to-int', 'Float to Integer in every mode: halves (ties), negatives, noise, huge and tiny values', N, (v, g) => {
        const halves = v.digit(16, 0, -4, 0.5)
        const wide = v.math('MULTIPLY', v.noise(3, -1, 1), v.math('POWER', 10, v.digit(4, 1, 2, 4)))
        const out: Record<string, Socket> = {}
        for (const mode of ['ROUND', 'FLOOR', 'CEILING', 'TRUNCATE']) {
            out[`h_${mode}`] = g.node('FunctionNodeFloatToInt', {roundingMode: mode, float: halves}).outputs.integer
            out[`w_${mode}`] = g.node('FunctionNodeFloatToInt', {roundingMode: mode, float: wide}).outputs.integer
        }
        return out
    }))
    cases.push(pointsCase('bit-math', 'Bit Math: every operation, shifts and rotations beyond the int width both ways', N, (v, g) => {
        const toInt = (s: Socket) => g.node('FunctionNodeFloatToInt', {roundingMode: 'FLOOR', float: s}).outputs.integer
        const a = toInt(v.noise(5, -2147483000, 2147483000))
        const b = toInt(v.noise(9, -100000, 100000))
        const shift = toInt(v.digit(16, 0, -40, 5))
        const out: Record<string, Socket> = {}
        for (const op of ['AND', 'OR', 'XOR']) out[op] = g.node('FunctionNodeBitMath', {operation: op, a, b}).outputs.value
        out.NOT = g.node('FunctionNodeBitMath', {operation: 'NOT', a}).outputs.value
        for (const op of ['SHIFT', 'ROTATE']) out[op] = g.node('FunctionNodeBitMath', {operation: op, a, shift}).outputs.value
        return out
    }))
    cases.push(pointsCase('axes-to-rotation', 'Axes to Rotation for every axis pair (and equal axes): zero, parallel and generic vectors', N, (v, g) => {
        // Primary / secondary from a digit grid on {-1, 0, 1} plus noise for generic directions.
        const primary = v.g.node('ShaderNodeMix', {dataType: 'VECTOR', factorFloat: v.digit(2, 5, 0, 1), aVector: v.digitVector(3, 0, -1, 1), bVector: v.noiseVector(2, -1, 1)}).outputs.resultVector
        const secondary = v.digitVector(3, 2, -1, 1)
        const out: Record<string, Socket> = {}
        for (const p of ['X', 'Y', 'Z']) for (const s of ['X', 'Y', 'Z']) {
            out[`r_${p}${s}`] = g.node('FunctionNodeAxesToRotation', {primaryAxisEnum: p, secondaryAxisEnum: s, primaryAxis: primary, secondaryAxis: secondary}).outputs.rotation
        }
        return out
    }))
    cases.push(pointsCase('matrix-nodes', 'Combine / Separate / Transpose Matrix, Determinant (Eigen), Project Point (w of both signs)', N, (v, g) => {
        const comps: Record<string, Socket> = {}
        for (let c = 1; c <= 4; c++) for (let r = 1; r <= 4; r++) comps[`column${c}Row${r}`] = v.noise(c * 10 + r, -2, 2)
        const m = g.node('FunctionNodeCombineMatrix', comps).outputs.matrix
        const t = g.node('FunctionNodeTransposeMatrix', {matrix: m}).outputs.matrix
        const out: Record<string, Socket> = {m, t, det: g.node('FunctionNodeMatrixDeterminant', {matrix: m}).outputs.determinant,
            proj: g.node('FunctionNodeProjectPoint', {vector: v.noiseVector(7, -3, 3), transform: m}).outputs.vector}
        Object.assign(out, outputsOf(g.node('FunctionNodeSeparateMatrix', {matrix: t}), 's_'))
        return out
    }))

    // Strings: single values, so one case builds a few attribute names and values on a point.
    const id = 'string-nodes'
    const group = geometryNodes(id, g => {
        const s = (string: string) => g.node('FunctionNodeInputString', {string}).outputs.string
        const node = (idname: string, args: Record<string, unknown>) => g.node(idname, args).outputs
        let geometry: AnySocket = g.node('GeometryNodePoints', {count: 1}).outputs.geometry
        const store = (name: AnySocket, value: AnySocket | number, dataType = 'INT') => {
            geometry = g.node('GeometryNodeStoreNamedAttribute', {dataType, domain: 'POINT', geometry, name, value}).outputs.geometry
        }
        const text = s('  Héllo, Wörld! ÿß ǅ ΆΣ дЖ  ')
        const special = node('FunctionNodeInputSpecialCharacters', {})
        store(node('FunctionNodeSetStringCase', {string: text, case: 'Uppercase'}).string, 1)
        store(node('FunctionNodeSetStringCase', {string: text, case: 'Lowercase'}).string, 2)
        store(node('FunctionNodeReverseString', {string: text}).string, 3)
        store(node('FunctionNodeTrimString', {string: text}).string, 4)
        store(node('FunctionNodeTrimString', {string: text, characters: s(' !Hj'), whitespace: false, end: false}).string, 5)
        store(node('FunctionNodeTrimString', {string: s('xxyx'), characters: s('xy')}).string, 6)
        store(node('FunctionNodeSliceString', {string: text, position: 3, length: 7}).string, 7)
        store(node('FunctionNodeSliceString', {string: text, position: -2, length: 4}).string, 8)
        store(node('FunctionNodeReplaceString', {string: text, find: s('l'), replace: s('LL')}).string, 9)
        store(node('GeometryNodeStringJoin', {delimiter: special.tab, strings: [s('a'), s('ö'), special.lineBreak, s('c')]}).string, 10)
        for (const [i, [value, decimals]] of [[0.5, 0], [1.5, 0], [2.5, 0], [-0.125, 2], [0.375, 2], [-0.001, 2], [1e21, 1], [123.456, 6], [3.4e38, 0], [1 / 3, 9]].entries()) {
            store(node('FunctionNodeValueToString', {value, decimals}).string, 20 + i)
        }
        for (const [i, [value, base, padding]] of [[255, 16, 6], [-255, 2, 12], [-2147483648, 36, 0], [7, 1, 0], [42, 10, 1]].entries()) {
            store(node('FunctionNodeValueToString', {dataType: 'INT', value, base, padding}).string, 40 + i)
        }
        const lengthName = s('length')
        store(lengthName, node('FunctionNodeStringLength', {string: text}).length)
        for (const [i, [search, mode]] of [['l', 'From Start'], ['l', 'From End'], ['ö', 'From End'], ['zz', 'From Start'], ['', 'From Start']].entries()) {
            const f = node('FunctionNodeFindInString', {string: text, search: s(search), mode})
            store(s(`first${i}`), f.firstFound)
            store(s(`count${i}`), f.count)
        }
        for (const [i, [key, operation]] of [['  H', 'Starts With'], ['  ', 'Ends With'], ['Wö', 'Contains'], ['', 'Contains'], ['x', 'Starts With']].entries()) {
            store(s(`match${i}`), node('FunctionNodeMatchString', {string: text, key: s(key), operation}).result, 'BOOLEAN')
        }
        g.output.geometry('Geometry', geometry)
    })
    cases.push({id, description: 'String nodes: case mapping tables, reverse, trim, slice, replace, join, value to string (ties, signs, bases), length, find, match',
        library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty'})
    return cases
}
