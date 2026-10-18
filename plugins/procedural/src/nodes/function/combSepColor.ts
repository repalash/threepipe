/**
 * Combine Color (`FunctionNodeCombineColor`, `nodes/function/nodes/node_fn_combine_color.cc`: declaration
 * :19, `node_init` :79, `get_multi_function` :86) and Separate Color (`FunctionNodeSeparateColor`,
 * `node_fn_separate_color.cc`: declaration :19, `node_init` :55, `SeparateRGBAFunction` :62,
 * `SeparateHSVAFunction` :116, `SeparateHSLAFunction` :153). Modes are `rna_enum_node_combsep_color_items`
 * (`makesrna/intern/rna_nodetree.cc:498`).
 */

import {elementwise, MultiFunction} from '../../fields/field'
import {hslToRgb, hsvToRgb, rgbToHsl, rgbToHsv} from '../../blender/math/color'
import {registerNodeType} from '../../runtime/registry'

const MODES = ['RGB', 'HSV', 'HSL']

const COMBINE: Record<string, MultiFunction> = {
    RGB: elementwise('RGB', ['float', 'float', 'float', 'float'], ['float4'], (i, o) => {
        o[0][0] = i[0][0]
        o[0][1] = i[1][0]
        o[0][2] = i[2][0]
        o[0][3] = i[3][0]
    }),
    HSV: elementwise('HSV', ['float', 'float', 'float', 'float'], ['float4'], (i, o) => {
        const c = hsvToRgb(i[0][0], i[1][0], i[2][0])
        o[0][0] = c[0]
        o[0][1] = c[1]
        o[0][2] = c[2]
        o[0][3] = i[3][0]
    }),
    HSL: elementwise('HSL', ['float', 'float', 'float', 'float'], ['float4'], (i, o) => {
        const c = hslToRgb(i[0][0], i[1][0], i[2][0])
        o[0][0] = c[0]
        o[0][1] = c[1]
        o[0][2] = c[2]
        o[0][3] = i[3][0]
    }),
}

const SEPARATE: Record<string, MultiFunction> = {
    RGB: elementwise('Separate Color', ['float4'], ['float', 'float', 'float', 'float'], (i, o) => {
        for (let k = 0; k < 4; k++) o[k][0] = i[0][k]
    }),
    HSV: elementwise('Separate Color', ['float4'], ['float', 'float', 'float', 'float'], (i, o) => {
        const c = rgbToHsv(i[0][0], i[0][1], i[0][2])
        o[0][0] = c[0]
        o[1][0] = c[1]
        o[2][0] = c[2]
        o[3][0] = i[0][3]
    }),
    HSL: elementwise('Separate Color', ['float4'], ['float', 'float', 'float', 'float'], (i, o) => {
        const c = rgbToHsl(i[0][0], i[0][1], i[0][2])
        o[0][0] = c[0]
        o[1][0] = c[1]
        o[2][0] = c[2]
        o[3][0] = i[0][3]
    }),
}

function modeFunction(table: Record<string, MultiFunction>, mode: string, node: string): MultiFunction {
    const fn = table[mode]
    if (!fn) throw new Error(`procedural: ${node} mode ${mode} is not supported`)
    return fn
}

registerNodeType({
    idname: 'FunctionNodeCombineColor',
    label: 'Combine Color',
    properties: {mode: 'RGB'},
    enums: {mode: MODES},
    declare(b) {
        // :19-73. The labels follow the mode (Hue/Saturation/Value...); identifiers do not.
        b.input('FLOAT', 'Red').default(0).min(0).max(1).subtype('FACTOR')
        b.input('FLOAT', 'Green').default(0).min(0).max(1).subtype('FACTOR')
        b.input('FLOAT', 'Blue').default(0).min(0).max(1).subtype('FACTOR')
        b.input('FLOAT', 'Alpha').default(1).min(0).max(1).subtype('FACTOR')
        b.output('RGBA', 'Color')
    },
    multiFunction: node => modeFunction(COMBINE, node.prop<string>('mode'), 'Combine Color'),
})

registerNodeType({
    idname: 'FunctionNodeSeparateColor',
    label: 'Separate Color',
    properties: {mode: 'RGB'},
    enums: {mode: MODES},
    declare(b) {
        // :19-49.
        b.input('RGBA', 'Color').default([1, 1, 1, 1])
        b.output('FLOAT', 'Red')
        b.output('FLOAT', 'Green')
        b.output('FLOAT', 'Blue')
        b.output('FLOAT', 'Alpha')
    },
    multiFunction: node => modeFunction(SEPARATE, node.prop<string>('mode'), 'Separate Color'),
})
