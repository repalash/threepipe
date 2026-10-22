#include <packing>
// todo use this after threepipe update
// include <gbuffer_unpack>

uniform float intensity;
uniform float opacity;
uniform vec2 tDiffuseSize;
varying vec2 vUv;
uniform float weight;

#if PASS_STEP == 0
uniform vec4 prefilter;
vec4 Prefilter (vec4 c) {
    //    float brightness = max(c.r, max(c.g, c.b));
    //    float contribution = max(0., brightness - prefilter.x);
    //    contribution /= max(brightness, 0.00001);
    //    return vec4((c.rgb) * contribution, c.a);
    //    return (c - vec3(prefilterThreshold)) * contribution;

    #ifdef HAS_GBUFFER
    #if !BACKGROUND_BLOOM
    if(getDepth(vUv) > 0.999) {
        return vec4(0.0);
    }
    #endif
    #endif

    float brightness = max(c.r, max(c.g, c.b));
    float soft = brightness + prefilter.x * (prefilter.y - 1.);
    soft = clamp(soft, 0., prefilter.z);
    soft = soft * soft * prefilter.w;
    float contribution = max(soft, brightness - prefilter.x);
    contribution /= max(brightness, 0.001);
    return vec4(c.rgb * contribution, c.a);

}
#endif

vec4 Sample (vec2 uv) {
    return min(vec4(MAX_INTENSITY, MAX_INTENSITY, MAX_INTENSITY, 1.), tDiffuseTexelToLinear( texture2D( tDiffuse, uv ) ));
}

vec4 SampleBox (vec2 uv, float delta) {
    vec4 o = vec2(-delta, delta).xxyy / tDiffuseSize.xyxy;
    vec4 s =
    Sample(uv + o.xy) + Sample(uv + o.zy) +
    Sample(uv + o.xw) + Sample(uv + o.zw);
    return s * 0.25;
}

int getBloomBit(in int number) {
    #ifdef WebGL2Context
    return (number/4) % 2;
    #else
    return int(mod(floor(float(number)/4.), 2.));
    #endif
}

void main() {
    #if PASS_STEP == 0 //prefilter + down

    #ifdef GBUFFER_HAS_FLAGS
    int doBloom = getBloomBit(getGBufferFlags(vUv).a);
    #else
    int doBloom = 1;
    #endif

    gl_FragColor = float(doBloom) * weight * Prefilter(SampleBox(vUv, 1.));
    gl_FragColor.a = 1.;

    #elif PASS_STEP == 1 //down

    gl_FragColor = weight * (SampleBox(vUv, 1.));
    gl_FragColor.a = 1.;

    #elif PASS_STEP == 2 //up

    gl_FragColor = (SampleBox(vUv, 0.5));
    gl_FragColor.a = 1.;

    #elif PASS_STEP == 3 //final

    vec4 texel = tSourceTexelToLinear ( texture2D(tSource, vUv) );
    vec4 bloom = intensity * SampleBox(vUv, 0.5).rgba;
    float brightness = max(bloom.r, max(bloom.g, bloom.b));
    texel.rgb += bloom.rgb;
    texel.a = min(1., texel.a + brightness);
    gl_FragColor = texel;

    #elif PASS_STEP == 4 //debug

    vec4 texel = vec4(0.);
    texel.rgb += intensity * SampleBox(vUv, 0.5).rgb;
    texel.a = 1.;
    gl_FragColor = texel;

    #endif

    #include <colorspace_fragment>

}
