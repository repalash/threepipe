// Packs the depth pyramid levels 1-6 (one target each, rcHiZ.glsl) side by side into one atlas texture, level k at
// x = hizOffset[k], so the cascade pass reads the whole pyramid through one texture unit (WebGL on Apple GPUs allows 16
// per shader, and the world trace needs 7 more).

layout(location = 0) out highp vec4 outDepth;

uniform sampler2D tHiZ1;
uniform sampler2D tHiZ2;
uniform sampler2D tHiZ3;
uniform sampler2D tHiZ4;
uniform sampler2D tHiZ5;
uniform sampler2D tHiZ6;
uniform float hizOffset[8]; // x offset of level k (k = 1..6); hizOffset[7] = atlas width

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float x = float(p.x);
    int level = 6;
    for (int k = 1; k < 7; k++) if (x < hizOffset[k + 1]) { level = k; break; }
    ivec2 q = ivec2(p.x - int(hizOffset[level]), p.y);
    vec4 d;
    if (level == 1) d = texelFetch(tHiZ1, min(q, textureSize(tHiZ1, 0) - 1), 0);
    else if (level == 2) d = texelFetch(tHiZ2, min(q, textureSize(tHiZ2, 0) - 1), 0);
    else if (level == 3) d = texelFetch(tHiZ3, min(q, textureSize(tHiZ3, 0) - 1), 0);
    else if (level == 4) d = texelFetch(tHiZ4, min(q, textureSize(tHiZ4, 0) - 1), 0);
    else if (level == 5) d = texelFetch(tHiZ5, min(q, textureSize(tHiZ5, 0) - 1), 0);
    else d = texelFetch(tHiZ6, min(q, textureSize(tHiZ6, 0) - 1), 0);
    outDepth = d;
}
