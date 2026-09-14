// Ported from webgi/plugins/shaders/lut.glsl — 3D-texture only (WebGL2 baseline).
// Multi-LUT slot selection per pixel via GBuffer flags (data.y bits 0-2 pick the slot,
// data.w bit 0 is the per-material enable).
#if (USE_LUT == 1 || USE_LUT1 == 1 || USE_LUT2 == 1)

precision highp sampler3D;

uniform float lutSize;
uniform float lutSize1;
uniform float lutSize2;
uniform float intensity;

#if USE_LUT == 1
    uniform sampler3D lut3d;
#endif
#if USE_LUT1 == 1
    uniform sampler3D lut3d1;
#endif
#if USE_LUT2 == 1
    uniform sampler3D lut3d2;
#endif

int getLUTBit(in int number) {
    #ifdef WebGL2Context
    return number % 2;
    #else
    return int(mod(float(number), 2.));
    #endif
}

// slot index packed in first 3 bits
int getLUTIndex(in int number) {
    #ifdef WebGL2Context
    return number % 8;
    #else
    return int(mod(float(number), 8.));
    #endif
}

// Pull the sample in by half a pixel so it begins at the center of the edge pixels
// — avoids ramping artifacts at the LUT boundaries.
vec3 getUVW(in float lutSize, in vec4 color) {
    float pixelWidth = 1.0 / lutSize;
    float halfPixelWidth = 0.5 / lutSize;
    vec3 uvw = vec3(halfPixelWidth) + color.rgb * (1.0 - pixelWidth);
    return uvw;
}

vec4 colorLookUp(in vec4 color) {
    vec4 outColor = color;

    float lutFac = float(getLUTBit(getGBufferFlags(vUv).a));
    float lutIndex = float(getLUTIndex(getGBufferFlags(vUv).g));

    if (lutIndex == 0.) {
        #if USE_LUT == 1
            outColor = vec4(texture(lut3d, getUVW(lutSize, color)).rgb, color.a);
        #endif
    } else if (lutIndex == 1.) {
        #if USE_LUT1 == 1
            outColor = vec4(texture(lut3d1, getUVW(lutSize1, color)).rgb, color.a);
        #endif
    } else if (lutIndex == 2.) {
        #if USE_LUT2 == 1
            outColor = vec4(texture(lut3d2, getUVW(lutSize2, color)).rgb, color.a);
        #endif
    } else {
        #if USE_LUT == 1
            outColor = vec4(texture(lut3d, getUVW(lutSize, color)).rgb, color.a);
        #endif
    }

    outColor = mix(color, outColor, lutFac);
    return vec4(mix(color, outColor, intensity));
}

#endif
