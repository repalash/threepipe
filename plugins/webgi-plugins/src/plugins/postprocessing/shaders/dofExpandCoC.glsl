#include <common>
#include <gbuffer_unpack>
varying vec2 vUv;
uniform vec2 colorTextureSize;
uniform vec2 direction;
uniform vec2 nearFarBlurScale;
const float MAXIMUM_BLUR_SIZE = 4.0;

float expandNear(const in vec2 offset, const in bool isBackground) {
    float coc = 0.0;
    vec2 sampleOffsets = MAXIMUM_BLUR_SIZE * offset / 5.0;
    float coc0 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv)).a - 1.;
    float coc1 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv - 5.0 * sampleOffsets)).a - 1.;
    float coc2 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv - 4.0 * sampleOffsets)).a - 1.;
    float coc3 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv - 3.0 * sampleOffsets)).a - 1.;
    float coc4 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv - 2.0 * sampleOffsets)).a - 1.;
    float coc5 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv - 1.0 * sampleOffsets)).a - 1.;
    float coc6 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv + 1.0 * sampleOffsets)).a - 1.;
    float coc7 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv + 2.0 * sampleOffsets)).a - 1.;
    float coc8 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv + 3.0 * sampleOffsets)).a - 1.;
    float coc9 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv + 4.0 * sampleOffsets)).a - 1.;
    float coc10 = 2. * colorTextureTexelToLinear(texture2D(colorTexture, vUv + 5.0 * sampleOffsets)).a - 1.;

    if(isBackground){
        coc = abs(coc0) * 0.095474 +
        (abs(coc1) + abs(coc10)) * 0.084264 +
        (abs(coc2) + abs(coc9)) * 0.088139 +
        (abs(coc3) + abs(coc8)) * 0.091276 +
        (abs(coc4) + abs(coc7)) * 0.093585 +
        (abs(coc5) + abs(coc6)) * 0.094998;
    } else {
        coc = min(coc0, 0.0);
        coc = min(coc1 * 0.3, coc);
        coc = min(coc2 * 0.5, coc);
        coc = min(coc3 * 0.75, coc);
        coc = min(coc4 * 0.8, coc);
        coc = min(coc5 * 0.95, coc);
        coc = min(coc6 * 0.95, coc);
        coc = min(coc7 * 0.8, coc);
        coc = min(coc8 * 0.75, coc);
        coc = min(coc9 * 0.5, coc);
        coc = min(coc10 * 0.3, coc);
        if(abs(coc0) > abs(coc))
        coc = coc0;
    }
    return coc;
}

void main() {
    vec2 offset = 2. * direction/colorTextureSize;
    bool isBackground = getDepth(vUv) > 1.0 - 0.001;
    float coc = expandNear(offset, isBackground);
    gl_FragColor = vec4(colorTextureTexelToLinear(texture2D(colorTexture, vUv)).rgb, 0.5 * coc + 0.5);

    #include <colorspace_fragment>
}
