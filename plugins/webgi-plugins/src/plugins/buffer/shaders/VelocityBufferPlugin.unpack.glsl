#if defined(HAS_VELOCITY_BUFFER)
uniform sampler2D tVelocity;
vec2 getVelocity(const in vec2 uv) {
    vec2 screenSpaceVelocity = texture2D(tVelocity, uv).xy * 2.0 - 1.0;
    return sign(screenSpaceVelocity) * pow(abs(screenSpaceVelocity), vec2(4.));
}
#endif

