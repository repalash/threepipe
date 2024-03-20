vec4 Vignette(in vec4 color) {
    vec2 uv =  vUv * (1.0 - vUv);
    float vig = uv.x * uv.y * 16.0; // max value of this function is 1/16 at the centre(0.5, 0.5)
    vig = pow(vig, power);
    return vec4( mix( color.rgb, vec3( bgcolor ),  1. - vig ), color.a );
}
