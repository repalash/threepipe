#include <common>
#include <packing>

varying vec2 vUv;
//uniform sampler2D blurTexture;
uniform vec2 cocTextureSize;
uniform vec2 nearFarBlurScale;
uniform vec2 cameraNearFar;
uniform vec2 focalDepthRange;

uniform vec2 crossCenter;
uniform float crossRadius;
uniform float crossAlpha;
uniform vec3 crossColor;

float smoothBoundary(float d, float smooothFactor) {
    smooothFactor *= 0.5;
    float value = smoothstep(-smooothFactor,smooothFactor, d);
    return value;
}

float circle( vec2 p, float r ) {
    return min((length(p) - r), -(length(p) - r - 0.01));
}

float computeCoc() {
    float depth = getDepth(vUv);
    if(depth > 1.0 - 0.01) return max(nearFarBlurScale.x, nearFarBlurScale.y);
    depth = mix(cameraNearFar.x, cameraNearFar.y, depth);
    float coc = (depth - focalDepthRange.x)/focalDepthRange.y;
    coc = clamp(coc, -1., 1.);
    return (coc > 0.0 ? coc * nearFarBlurScale.y : coc * nearFarBlurScale.x);
}

void main() {
    vec4 blur = blurTextureTexelToLinear(texture2D(blurTexture, vUv));
    float scale = 0.5;
    blur += blurTextureTexelToLinear(texture2D(blurTexture, vUv + scale * vec2(1.0, 1.0) / cocTextureSize));
    blur += blurTextureTexelToLinear(texture2D(blurTexture, vUv + scale * vec2(-1.0, 1.0) / cocTextureSize));
    blur += blurTextureTexelToLinear(texture2D(blurTexture, vUv + scale * vec2(-1.0, -1.0) / cocTextureSize));
    blur += blurTextureTexelToLinear(texture2D(blurTexture, vUv + scale * vec2(1.0, -1.0) / cocTextureSize));
    blur /= 5.0;

    vec2 uvNearest = (floor(vUv * cocTextureSize) + 0.5) / cocTextureSize;
    float coc = abs(min(2. * cocTextureTexelToLinear(texture2D(cocTexture, uvNearest)).a - 1., computeCoc()));
    //coc = clamp(coc * coc * 8.0, 0.0, 1.0);
    float cocLower = 0.005;
    float cocHigher = 0.3;
    vec4 outColor = vec4(mix(colorTextureTexelToLinear(texture2D(colorTexture, vUv)).rgb, blur.rgb, smoothstep(cocLower, cocHigher, coc)), 1.0);

    vec2 d = vUv - crossCenter;

    if(length(d) > crossRadius + 0.05) {
        float dist = circle(d, crossRadius);
        gl_FragColor = outColor;
    } else {
        d.x *= cocTextureSize.x/cocTextureSize.y;
        float dist = circle(d, crossRadius);
        dist = smoothBoundary(dist, 2. * fwidth(dist));
        vec4 color = outColor;
        vec3 dofCircleColor = mix(crossColor, color.rgb, 1.-crossAlpha);
        gl_FragColor = vec4(mix(color.rgb, dofCircleColor, dist), color.a);

    }

    #include <colorspace_fragment>

}
