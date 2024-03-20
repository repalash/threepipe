// https://www.shadertoy.com/view/4sXSWs
vec4 FilmicGrain(in vec4 color) {
    float x = (vUv.x + 4.0 ) * (vUv.y + 4.0 ) * ( 10.0);
    vec4 grain = vec4(mod((mod(x, 13.0) + 1.0) * (mod(x, 123.0) + 1.0), 0.01)-0.005) * grainIntensity;
    return vec4(
    grainMultiply ?
        (color.rgb * vec3(1.-grain)) :
        (color.rgb + vec3(grain)),
    color.a);
}
