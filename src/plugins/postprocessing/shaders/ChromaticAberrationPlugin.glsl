vec4 ChromaticAberration(in vec4 color) {
    vec2 distFromCenter = vUv - 0.5;

    vec2 aberrated = aberrationIntensity * pow(abs(distFromCenter), vec2(2.0));

    vec4 outColor = vec4(
    tDiffuseTexelToLinear (texture2D(tDiffuse, vUv + aberrated)).r,
    color.g,
    tDiffuseTexelToLinear (texture2D(tDiffuse, vUv - aberrated)).b,
    color.a
    );

    return outColor;
}
