import {FullScreenQuad, IUniform, ShaderMaterial, WebGL3DRenderTarget, WebGLRenderer} from 'threepipe'

export interface VolumeKernelOptions {
    /**
     * Name, for debugging and the shader program name.
     */
    name: string
    /**
     * GLSL of the kernel: uniform declarations, helper functions and `vec4 kernel(ivec3 voxel)`, which returns the
     * value of one output voxel. `uLayer` (int, the output z) and `uOutputSize` (ivec3) are declared already.
     */
    fragment: string
    uniforms?: Record<string, IUniform>
    defines?: Record<string, any>
}

/**
 * Runs a GLSL function once per voxel of a 3D render target, one z layer per draw: a compute kernel for WebGL2.
 *
 * Each layer is a full-screen triangle drawn into that layer of a `WebGL3DRenderTarget`, so any renderable format
 * works (R8, RG8 and RGBA8 everywhere; half and float formats need `EXT_color_buffer_half_float` /
 * `EXT_color_buffer_float`). Inputs are textures read with `texelFetch` or `texture`.
 *
 * Used by {@link DerivedField}; can also be used on its own.
 */
export class VolumeKernel {
    readonly material: ShaderMaterial
    private _quad: FullScreenQuad

    constructor(options: VolumeKernelOptions) {
        this.material = new ShaderMaterial({
            name: options.name,
            uniforms: {
                uLayer: {value: 0},
                uOutputSize: {value: [1, 1, 1]},
                ...options.uniforms,
            },
            defines: {...options.defines},
            vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp sampler2D;
uniform int uLayer;
uniform ivec3 uOutputSize;
${options.fragment}
void main() {
    gl_FragColor = kernel(ivec3(ivec2(gl_FragCoord.xy), uLayer));
}
`,
            depthTest: false,
            depthWrite: false,
        })
        this._quad = new FullScreenQuad(this.material)
    }

    get uniforms(): Record<string, IUniform> {
        return this.material.uniforms
    }

    /**
     * Runs the kernel for the layers `from` to `to - 1` of `target`. The render target, the viewport and the clear
     * settings of the renderer are restored after.
     */
    run(renderer: WebGLRenderer, target: WebGL3DRenderTarget, from = 0, to = target.depth) {
        const prevTarget = renderer.getRenderTarget()
        const prevFace = renderer.getActiveCubeFace()
        const prevMip = renderer.getActiveMipmapLevel()
        const prevAutoClear = renderer.autoClear
        const prevXr = renderer.xr.enabled
        renderer.autoClear = false
        renderer.xr.enabled = false
        const u = this.material.uniforms
        u.uOutputSize.value = [target.width, target.height, target.depth]
        for (let z = Math.max(0, from); z < Math.min(to, target.depth); z++) {
            u.uLayer.value = z
            // for 3D targets three.js uses the second argument as the layer
            renderer.setRenderTarget(target, z)
            this._quad.render(renderer)
        }
        renderer.setRenderTarget(prevTarget, prevFace, prevMip)
        renderer.autoClear = prevAutoClear
        renderer.xr.enabled = prevXr
    }

    dispose() {
        this.material.dispose()
        this._quad.dispose()
    }
}
