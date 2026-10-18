/**
 * Separate XYZ (`ShaderNodeSeparateXYZ`) and Combine XYZ (`ShaderNodeCombineXYZ`) -
 * `nodes/shader/nodes/node_shader_sepcomb_xyz.cc` (declarations :21, :162; `MF_SeparateXYZ` :39,
 * `sh_node_combxyz_build_multi_function` :180).
 */

import {elementwise, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'

/** `MF_SeparateXYZ` (`node_shader_sepcomb_xyz.cc:39`). */
const separateXYZ: MultiFunction = elementwise('Separate XYZ', ['float3'], ['float', 'float', 'float'], (i, o) => {
    o[0][0] = i[0][0]
    o[1][0] = i[0][1]
    o[2][0] = i[0][2]
})

/** `SI3_SO<float, float, float, float3>("Combine Vector")` (`:182`). */
const combineXYZ: MultiFunction = elementwise('Combine Vector', ['float', 'float', 'float'], ['float3'], (i, o) => {
    o[0][0] = i[0][0]
    o[0][1] = i[1][0]
    o[0][2] = i[2][0]
})

registerNodeType({
    idname: 'ShaderNodeSeparateXYZ',
    label: 'Separate XYZ',
    declare(b) {
        // :21-28.
        b.input('VECTOR', 'Vector').min(-10000).max(10000)
        b.output('FLOAT', 'X')
        b.output('FLOAT', 'Y')
        b.output('FLOAT', 'Z')
    },
    multiFunction: () => separateXYZ,
})

registerNodeType({
    idname: 'ShaderNodeCombineXYZ',
    label: 'Combine XYZ',
    declare(b) {
        // :162-169.
        b.input('FLOAT', 'X').min(-10000).max(10000)
        b.input('FLOAT', 'Y').min(-10000).max(10000)
        b.input('FLOAT', 'Z').min(-10000).max(10000)
        b.output('VECTOR', 'Vector')
    },
    multiFunction: () => combineXYZ,
})
