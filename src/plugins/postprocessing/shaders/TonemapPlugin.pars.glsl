int getToneMapBit(in int number) {
    #ifdef WebGL2Context
    return (number/2) % 2;
    #else
    return int(mod(floor(float(number)/2.), 2.));
    #endif
}

vec3 TonemappingSaturation(vec3 rgb) {
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    vec3 intensity = vec3(dot(rgb, W));
    return mix(intensity, rgb, toneMappingSaturation);
}

vec3 TonemappingContrast(vec3 color){
    return (color - vec3(0.5)) * toneMappingContrast + vec3(0.5);
}

vec4 ToneMapping(in vec4 color) {
    vec4 outColor = color;

    #if defined( TONE_MAPPING )

    outColor.rgb = toneMapping(outColor.rgb);
    outColor.rgb = TonemappingContrast(outColor.rgb);
    outColor.rgb = TonemappingSaturation(outColor.rgb);

    #endif

    return outColor;
}
