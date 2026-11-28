// Volume ray march: fragment shader.
//
// The march calls four hook functions. A material extension can replace any of them: define the matching
// VOL_CUSTOM_* macro and the function in its parsFragmentSnippet (inserted just before main). Default versions are
// at the end of this file.
//   float volSample(vec3 uvw)                       raw texture value at a texture coordinate (0..1 per axis)
//   vec4  volClassify(float v, vec3 uvw)            value on the transfer function (0..1) to colour and opacity per voxel
//   vec3  volShade(vec3 color, vec3 uvw, vec3 dir)  lighting of a sample; dir is the ray direction in texture space
//   void  volBlend(inout vec4 acc, vec4 s)          adds a sample (premultiplied colour) to the ray, front to back

precision highp sampler3D;

varying vec3 vOrigin;
varying vec3 vDirection;
varying vec3 vOriginView;
varying vec3 vDirectionView;

uniform sampler3D volumeMap;       // the field
uniform sampler2D transferMap;     // RGBA lookup over 0..1
uniform vec3 uBoxSize;             // size of the box in object units
uniform vec3 uVolumeSize;          // texel counts of the texture
uniform vec3 uDataSize;            // voxel counts of the data (larger than uVolumeSize when downsampled)
uniform vec2 uValueMap;            // transfer function coordinate = texture value * x + y
uniform float uSamplingRate;       // samples per voxel along the ray
uniform float uOpacityExponent;    // density / samplingRate, for opacity correction
uniform float uIsoValue;           // isosurface threshold on the transfer function coordinate
uniform vec3 uCropMin;             // crop box in texture coordinates
uniform vec3 uCropMax;
uniform vec2 uResolution;          // size of the target, for the depth lookup
uniform vec2 cameraNearFar;
uniform float frameCount;
uniform float uJitter;             // 0 or 1
uniform mat3 uNormalMatrix;        // object to view, for normals (object.normalMatrix)

#ifdef VOL_SKIP
// empty space skipping, see EmptySpaceMap and MinMaxBlocks
uniform highp sampler3D uSkipMap;   // Chebyshev distance in blocks to the nearest block that can show, / 255
uniform highp sampler3D uMinMaxMap; // range of texture values per block (min, max)
uniform float uSkipReady;          // 1 when uSkipMap is up to date
uniform float uMinMaxReady;        // 1 when uMinMaxMap is up to date
uniform vec3 uBlockGrid;           // blocks along x, y, z
uniform float uBlockSize;          // voxels per block along each axis
uniform float uOpenEnds;           // 1: 0 and 1 in uMinMaxMap also stand for values below and above
#endif

#ifdef VOL_GRADIENT_MAP
uniform highp sampler3D uGradientMap; // GradientField: direction * 0.5 + 0.5, length / VOL_GRADIENT_MAX
uniform float uGradientReady;
#endif

#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#ifndef VOLUME_MAX_STEPS
#define VOLUME_MAX_STEPS 2048
#endif

// VOL_DEBUG_STEPS: output the work per pixel instead of the image (VolumeMaterial.debugSteps)
#ifdef VOL_DEBUG_STEPS
#define VOL_COUNT(x) x += 1.0;
#else
#define VOL_COUNT(x)
#endif

float volSample(vec3 uvw);
vec4 volClassify(float v, vec3 uvw);
vec3 volShade(vec3 color, vec3 uvw, vec3 dir);
void volBlend(inout vec4 acc, vec4 s);

// interleaved gradient noise (Jimenez 2014), animated by frame
float volNoise(vec2 p) {
    p += 5.588238 * mod(frameCount, 64.0);
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec2 volIntersectBox(vec3 o, vec3 d, vec3 bmin, vec3 bmax) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (bmin - o) * inv;
    vec3 t1 = (bmax - o) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// value on the transfer function at a texture coordinate
float volValue(vec3 uvw) {
    return volSample(uvw) * uValueMap.x + uValueMap.y;
}

vec3 volGradient(vec3 uvw);

#ifdef VOL_SKIP
// the block of a texture coordinate: blocks of uBlockSize voxels, with voxel centres at integer coordinates. Block 0
// and the last block also cover the half voxel at the edges of the box.
vec3 volBlockOf(vec3 uvw) {
    return clamp(floor((uvw * uVolumeSize - 0.5) / uBlockSize), vec3(0.0), uBlockGrid - 1.0);
}

// the sample index, fractional, where the ray (sample k at base + stepTex * k) leaves the blocks lo to hi - 1.
// Sides at the edge of the grid are open: the edge blocks reach past the box.
float volBlocksExit(vec3 lo, vec3 hi, vec3 base, vec3 stepTex) {
    vec3 l = mix(lo * uBlockSize, vec3(-1e9), step(lo, vec3(0.0)));
    vec3 h = mix(hi * uBlockSize, vec3(1e9), step(uBlockGrid, hi));
    vec3 lt = (l + 0.5) / uVolumeSize;
    vec3 ht = (h + 0.5) / uVolumeSize;
    vec3 s = mix(stepTex, vec3(1e-20), lessThan(abs(stepTex), vec3(1e-20)));
    vec3 k = (mix(lt, ht, step(vec3(0.0), s)) - base) / s;
    return min(min(k.x, k.y), k.z);
}

// for a block with nothing to show, the sample index where the ray leaves the empty cube of blocks around it; else -1
float volEmptyExit(vec3 blk, vec3 base, vec3 stepTex) {
    float d = floor(texelFetch(uSkipMap, ivec3(blk), 0).r * 255.0 + 0.5);
    if (d < 1.0) return -1.0;
    return volBlocksExit(blk - (d - 1.0), blk + d, base, stepTex);
}

// the range of values of a block on the transfer function coordinate
vec2 volBlockRange(vec3 blk) {
    vec2 mm = texelFetch(uMinMaxMap, ivec3(blk), 0).rg;
    float t0 = uOpenEnds > 0.5 && mm.x <= 0.0 ? -1e6 : mm.x;
    float t1 = uOpenEnds > 0.5 && mm.y >= 1.0 ? 1e6 : mm.y;
    float v0 = t0 * uValueMap.x + uValueMap.y;
    float v1 = t1 * uValueMap.x + uValueMap.y;
    return vec2(min(v0, v1), max(v0, v1));
}
#endif

void main() {
    // ray in object space, parametrized by t' along the unnormalized direction (same as the view-space ray)
    vec3 halfSize = 0.5 * uBoxSize;
    vec3 cropMin = (uCropMin - 0.5) * uBoxSize;
    vec3 cropMax = (uCropMax - 0.5) * uBoxSize;
    vec2 bounds = volIntersectBox(vOrigin, vDirection, max(-halfSize, cropMin), min(halfSize, cropMax));
    if (!isOrthographic) bounds.x = max(bounds.x, 0.0); // camera inside the box

    // clip planes (material.clippingPlanes) shorten the ray instead of cutting the box surface
    #if NUM_CLIPPING_PLANES > 0
    for (int i = 0; i < UNION_CLIPPING_PLANES; i++) {
        vec4 plane = clippingPlanes[i];
        // a point P (view space) is clipped when dot(-P, plane.xyz) > plane.w, see clipping_planes_fragment
        float a = -dot(vOriginView, plane.xyz) - plane.w;
        float b = -dot(vDirectionView, plane.xyz);
        if (abs(b) < 1e-8) { if (a > 0.0) discard; }
        else if (b > 0.0) bounds.y = min(bounds.y, -a / b);
        else bounds.x = max(bounds.x, -a / b);
    }
    #endif

    // opaque scene geometry, from the G-buffer depth (GBufferPlugin)
    #if defined(HAS_NORMAL_DEPTH_BUFFER) && HAS_NORMAL_DEPTH_BUFFER == 1
    {
        float sceneDepth = getDepth(gl_FragCoord.xy / uResolution);
        if (sceneDepth < 0.999 && abs(vDirectionView.z) > 1e-8) {
            float sceneViewZ = -mix(cameraNearFar.x, cameraNearFar.y, sceneDepth);
            bounds.y = min(bounds.y, (sceneViewZ - vOriginView.z) / vDirectionView.z);
        }
    }
    #endif

    if (bounds.x >= bounds.y) discard;

    // texture space ray: sample k is at base + stepTex * k, for k from 0 to steps - 1 (up to kEnd, the end of the ray)
    vec3 dirTex = vDirection / uBoxSize;
    float voxelsPerUnit = length(dirTex * uVolumeSize); // voxels crossed per unit of t'
    float dtRate = 1.0 / (max(uSamplingRate, 1e-3) * voxelsPerUnit);
    // a ray longer than VOLUME_MAX_STEPS samples takes longer steps, so it still reaches the end
    float dt = max(dtRate, (bounds.y - bounds.x) / float(VOLUME_MAX_STEPS));
    // opacity correction for the step actually taken (uOpacityExponent is for the sampling rate), in voxels of the
    // data: a downsampled texture has fewer, larger texels (uDataSize is the voxel count of the data)
    float opacityExp = uOpacityExponent * dt / dtRate * length(dirTex * uDataSize) / voxelsPerUnit;
    vec3 startTex = (vOrigin + vDirection * bounds.x) / uBoxSize + 0.5;
    vec3 stepTex = dirTex * dt;
    float offset = uJitter > 0.5 ? volNoise(gl_FragCoord.xy) : 0.5;
    vec3 base = startTex + stepTex * offset;
    vec3 uvw = base;
    // the end of the ray in sample index; samples past it (outside the crop, a clip plane or an opaque mesh) are not read
    float kEnd = (bounds.y - bounds.x) / dt - offset;
    int steps = int(clamp(floor(kEnd) + 1.0, 0.0, float(VOLUME_MAX_STEPS)));
    float fsteps = float(steps);
    vec3 dirN = normalize(dirTex);

    // empty space skipping: only samples that add nothing are skipped, so the image is the same. Off with a custom
    // volSample or volClassify, which the block maps know nothing about.
    #if defined(VOL_SKIP) && !defined(VOL_CUSTOM_SAMPLE) && !defined(VOL_CUSTOM_CLASSIFY)
    #define VOL_SKIP_ON
    #endif

    vec4 acc = vec4(0.0);
    float k = 0.0;
    float nIter = 0.0;    // loop iterations, with VOL_DEBUG_STEPS
    float nSamples = 0.0; // samples read

    #if VOLUME_MODE == 0 || VOLUME_MODE == 5 // composite (direct volume rendering), x-ray
    #if VOLUME_MODE == 5
    float tau = 0.0;
    #endif
    #ifdef VOL_SKIP_ON
    float kCheck = 0.0; // the next sample to look at the map: the maps are read once per block
    #endif
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (k >= fsteps) break;
        VOL_COUNT(nIter)
        uvw = base + stepTex * k;
        #ifdef VOL_SKIP_ON
        if (k >= kCheck && uSkipReady > 0.5) {
            vec3 blk = volBlockOf(uvw);
            float kExit = volEmptyExit(blk, base, stepTex);
            // samples before kExit are in the empty cube and have zero opacity
            if (kExit > k) { k = ceil(kExit); continue; }
            kCheck = max(k + 1.0, floor(volBlocksExit(blk, blk + 1.0, base, stepTex)));
        }
        #endif
        VOL_COUNT(nSamples)
        vec4 s = volClassify(volValue(uvw), uvw);
        #if VOLUME_MODE == 0
        if (s.a > 0.0) {
            s.a = 1.0 - pow(max(1.0 - s.a, 0.0), opacityExp);
            s.rgb = volShade(s.rgb, uvw, dirN) * s.a;
            volBlend(acc, s);
            if (acc.a > 0.99) break;
        }
        #else
        tau += s.a;
        #endif
        k += 1.0;
    }
    #if VOLUME_MODE == 5 // summed absorption, grey
    float a = 1.0 - exp(-tau * opacityExp);
    vec4 s = volClassify(1.0, uvw);
    acc = vec4(s.rgb * a, a);
    #endif

    #elif VOLUME_MODE == 1 || VOLUME_MODE == 2 // maximum / minimum intensity projection
    float best = VOLUME_MODE == 1 ? -1e20 : 1e20;
    #ifdef VOL_SKIP_ON
    float kCheck = 0.0;
    #endif
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (k >= fsteps) break;
        VOL_COUNT(nIter)
        uvw = base + stepTex * k;
        #ifdef VOL_SKIP_ON
        if (k >= kCheck && uMinMaxReady > 0.5) {
            vec3 blk = volBlockOf(uvw);
            float kExit = volBlocksExit(blk, blk + 1.0, base, stepTex);
            // a block whose values cannot beat the best so far is skipped
            vec2 r = volBlockRange(blk);
            if ((VOLUME_MODE == 1 ? r.y <= best : r.x >= best) && kExit > k) { k = ceil(kExit); continue; }
            kCheck = max(k + 1.0, floor(kExit));
        }
        #endif
        VOL_COUNT(nSamples)
        float v = volValue(uvw);
        best = VOLUME_MODE == 1 ? max(best, v) : min(best, v);
        k += 1.0;
    }
    vec4 s = volClassify(best, uvw);
    acc = vec4(s.rgb * s.a, s.a);

    #elif VOLUME_MODE == 3 // average intensity
    float sum = 0.0;
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (k >= fsteps) break;
        VOL_COUNT(nIter)
        uvw = base + stepTex * k;
        VOL_COUNT(nSamples)
        sum += volValue(uvw);
        k += 1.0;
    }
    vec4 s = volClassify(sum / max(k, 1.0), uvw);
    acc = vec4(s.rgb * s.a, s.a);

    #elif VOLUME_MODE == 4 // isosurface: the first crossing between sample k and k + 1
    float prevV = volValue(base);
    bool hit = false;
    #ifdef VOL_SKIP_ON
    float kCheck = 0.0;
    #endif
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (k >= fsteps) break;
        VOL_COUNT(nIter)
        uvw = base + stepTex * k;
        #ifdef VOL_SKIP_ON
        if (k >= kCheck && uSkipReady > 0.5) {
            vec3 blk = volBlockOf(uvw);
            float kExit = volEmptyExit(blk, base, stepTex);
            // to the last sample in the empty cube: no crossing is inside it, but there can be one between that
            // sample and the next
            float kLast = min(ceil(kExit) - 1.0, fsteps - 1.0);
            if (kLast > k) { k = kLast; prevV = volValue(base + stepTex * k); kCheck = k + 1.0; continue; }
            kCheck = max(k + 1.0, floor(volBlocksExit(blk, blk + 1.0, base, stepTex)));
        }
        #endif
        // the next sample, or the end of the ray
        float kNext = min(k + 1.0, kEnd);
        if (kNext <= k) break;
        VOL_COUNT(nSamples)
        vec3 next = base + stepTex * kNext;
        float v = volValue(next);
        if ((prevV - uIsoValue) * (v - uIsoValue) <= 0.0 && v != prevV) {
            // refine between uvw and next by bisection
            vec3 a = uvw;
            vec3 b = next;
            float va = prevV;
            for (int j = 0; j < 6; j++) {
                vec3 m = 0.5 * (a + b);
                float vm = volValue(m);
                if ((va - uIsoValue) * (vm - uIsoValue) <= 0.0) { b = m; } else { a = m; va = vm; }
            }
            uvw = 0.5 * (a + b);
            hit = true;
            break;
        }
        prevV = v;
        if (kNext >= kEnd) break;
        k += 1.0;
    }
    #ifndef VOL_DEBUG_STEPS
    if (!hit) discard;
    #endif
    vec4 s = volClassify(uIsoValue, uvw);
    vec3 n = volGradient(uvw) / uBoxSize; // object space normal direction, unnormalized
    vec3 nView = normalize(uNormalMatrix * n);
    if (dot(nView, vDirectionView) > 0.0) nView = -nView;
    // headlight: diffuse plus a little ambient, until scene lights come in phase 3
    vec3 l = normalize(-vDirectionView);
    float diffuse = max(dot(nView, l), 0.0);
    float spec = pow(max(dot(reflect(-l, nView), l), 0.0), 32.0) * 0.25;
    acc = vec4(s.rgb * (0.25 + 0.75 * diffuse) + spec, 1.0);
    #endif

    #ifndef VOL_DEBUG_STEPS
    if (acc.a <= 0.0) discard;
    #endif

    // premultiplied colour
    gl_FragColor = acc;

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    #ifdef VOL_DEBUG_STEPS
    // red: samples read, green: loop iterations, blue: samples without skipping; 1 is 512
    gl_FragColor = vec4(nSamples, nIter, fsteps, 512.0) / 512.0;
    #endif
}

// derivative of the transfer function coordinate per texture unit
vec3 volGradient(vec3 uvw) {
    #if defined(VOL_GRADIENT_MAP) && !defined(VOL_CUSTOM_SAMPLE)
    if (uGradientReady > 0.5) {
        vec4 g = texture(uGradientMap, uvw);
        return (g.rgb * 2.0 - 1.0) * (max(g.a, 1.0 / 255.0) * VOL_GRADIENT_MAX) * uVolumeSize * uValueMap.x;
    }
    #endif
    vec3 e = 1.0 / uVolumeSize;
    return vec3(
        volSample(uvw + vec3(e.x, 0., 0.)) - volSample(uvw - vec3(e.x, 0., 0.)),
        volSample(uvw + vec3(0., e.y, 0.)) - volSample(uvw - vec3(0., e.y, 0.)),
        volSample(uvw + vec3(0., 0., e.z)) - volSample(uvw - vec3(0., 0., e.z))
    ) * (0.5 * uVolumeSize * uValueMap.x);
}

// region default hooks

#ifndef VOL_CUSTOM_SAMPLE
float volSample(vec3 uvw) {
    return texture(volumeMap, uvw).r;
}
#endif

#ifndef VOL_CUSTOM_CLASSIFY
vec4 volClassify(float v, vec3 uvw) {
    return texture2D(transferMap, vec2(clamp(v, 0.0, 1.0), 0.5));
}
#endif

#ifndef VOL_CUSTOM_SHADE
vec3 volShade(vec3 color, vec3 uvw, vec3 dir) {
    return color;
}
#endif

#ifndef VOL_CUSTOM_BLEND
void volBlend(inout vec4 acc, vec4 s) {
    acc += (1.0 - acc.a) * s;
}
#endif

// endregion
