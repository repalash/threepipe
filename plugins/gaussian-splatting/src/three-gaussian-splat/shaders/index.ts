import fragmentParsShaderSource from '../shaders/gsplat.pars.frag.glsl'
import vertexParsShaderSource from '../shaders/gsplat.pars.vert.glsl'
import vertexShaderSource from '../shaders/gsplat.main.vert.glsl'
import fragmentShaderSource from '../shaders/gsplat.main.frag.glsl'

export const gaussianSplatShaders = {
    main_frag: '\n' + fragmentShaderSource + '\n',
    main_vert: '\n' + vertexShaderSource + '\n',
    pars_frag: fragmentParsShaderSource,
    pars_vert: vertexParsShaderSource,
}
