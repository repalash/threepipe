uniform sampler2D outlineBuffer;
uniform vec2 tDiffuseSize;
uniform vec3 outlineColor;
uniform float outlineThickness;
uniform float outlineIntensity;
uniform float highlightTransparency;
uniform bool enableHighlight;
uniform float dpr;

float isSelected(vec2 uv) {
    return 1. - texture2D(outlineBuffer, uv).b;
}

vec4 outline(in vec4 color) {
    vec2 invSize = 1.0 / tDiffuseSize;

    #if DEBUG_OUTLINE > 0
    color = vec4(0., 0., 0., 1.);
    //    return texture2D(outlineBuffer, vUv);
    #endif

    vec3 finalColor = color.rgb;

    float c = isSelected(vUv);

//    return vec4(c,c,c,1.);

    if(c > 0.) {
        vec4 uvOffset = 1.5 * dpr * outlineThickness * vec4(1.0, 0.0, -1.0, 1.0) * vec4(invSize, invSize);

        float c1 = isSelected(vUv + uvOffset.xy);
        float c2 = isSelected(vUv - uvOffset.xy);
        float c3 = isSelected(vUv + uvOffset.yw);
        float c4 = isSelected(vUv - uvOffset.yw);
        float diff1 = (c1 - c2) * 0.5;
        float diff2 = (c3 - c4) * 0.5;

        float d = length(vec2(diff1, diff2));
        // float trans = min(1., 10. * (1. - highlightTransparency));

        vec4 highlightColor = enableHighlight ? vec4(c * outlineColor, (1. - highlightTransparency) * c) : vec4(0.);
        vec4 edgeColor = vec4(outlineColor, 1.) * vec4(d);

        float gbufferDepth = getDepth(vUv);
        float outlineDepth = unpack16(texture2D(outlineBuffer, vUv).xy);
        outlineDepth *= outlineDepth;
        outlineDepth -= 0.005;

        if(gbufferDepth < outlineDepth) {
            highlightColor.rgb = highlightColor.rgb * 0.3;
            edgeColor.rgb = edgeColor.rgb * 0.5;
        }

        vec4 outColor = edgeColor + highlightColor * (1. - d);
        finalColor = mix(color.rgb, outlineIntensity * outColor.rgb, outColor.a);
    } else {
        finalColor.rgb = color.rgb;
    }
    return vec4(finalColor.rgb, color.a);
}
