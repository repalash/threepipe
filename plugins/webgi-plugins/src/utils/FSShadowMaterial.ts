import {AnyOptions, glsl, ITexture, Shader, ShadowMaterial, uniform, WebGLRenderer} from 'threepipe'

// Full screen shadow material, used for baking shadow maps.
export class FSShadowMaterial extends ShadowMaterial /*implements IMaterial*/ {
    public readonly typeSlug = 'fsShadow'
    assetType: 'material' = 'material'

    private _uniforms: any = {}
    @uniform({propKey: 'tLastThis'})
    public lastFrameTexture: ITexture | null = null

    get materialObject(): ShadowMaterial {
        return this
    }

    onBeforeCompile(shader: Shader, renderer: WebGLRenderer): void {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
#include <project_vertex>
gl_Position = vec4(uv*2.-1., 0, 1.); 
        `) // todo: write to uv2?
        shader.vertexShader = shader.vertexShader.replace('void main() {', `
varying vec2 vUv;
void main() {
    vUv = uv;
        `)
        shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
varying vec2 vUv;
uniform sampler2D tLastThis;
void main() {
        `)
        shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', glsl`
float shadow = getShadowMask();

//shift the color by dither_shift
shadow = clamp(shadow + mix(-1./512., 1./512., rand( gl_FragCoord.xy )), 0., 1.);

float last = unpackRGBAToDepth(texture2D(tLastThis, vUv));
gl_FragColor = packDepthToRGBA(mix(last, shadow, opacity));
//if not useMovingAverage:
//gl_FragColor = packDepthToRGBA(shadow * opacity + last);
        `)
        Object.assign(shader.uniforms, this._uniforms)
        super.onBeforeCompile(shader, renderer)
    }

    customProgramCacheKey(): string {
        return super.customProgramCacheKey()
    }

    toJSON(): any {
        throw new Error('Method not supported for this material.')
    }
    fromJSON(): this | null {
        throw new Error('Method not supported for this material.')
    }

    copyProps(): this {
        throw new Error('Method not supported for this material.')
    }

    setDirty(options?: AnyOptions): void {
        this.needsUpdate = true
        this.dispatchEvent({...options, type: 'materialUpdate'}) // this sets sceneUpdate in root scene
    }
}
