#ifndef BASIC_RANDOM_HELPERS
#define BASIC_RANDOM_HELPERS

float random(float n){return fract(sin(n) * 43758.5453123);}

float random2(vec2 n,float x){n+=x;return fract(sin(dot(n.xy,vec2(12.9898, 78.233)))*43758.5453);}

float random3(vec3 v) {
    v = fract(v * 443.8975);
    v += dot(v, v.yzx + 19.19);
    return fract((v.x + v.y) * v.z);
}

// https://github.com/EpicGames/UnrealEngine/blob/release/Engine/Shaders/Private/Random.ush#L27
float interleavedGradientNoise(const in vec2 fragCoord, const in float seed) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(fragCoord.xy + seed * vec2(2.083, 4.867), magic.xy)));
}

vec3 hash3( vec2 p )
{
    vec3 q = vec3( dot(p,vec2(127.1,311.7)),
    dot(p,vec2(269.5,183.3)),
    dot(p,vec2(419.2,371.9)) );
    return fract(sin(q)*43758.5453);
}

#endif
