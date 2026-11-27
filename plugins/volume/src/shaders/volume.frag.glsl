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
uniform vec3 uVolumeSize;          // voxel counts
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

#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#ifndef VOLUME_MAX_STEPS
#define VOLUME_MAX_STEPS 2048
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

vec3 volGradient(vec3 uvw) {
    vec3 e = 1.0 / uVolumeSize;
    return vec3(
        volSample(uvw + vec3(e.x, 0., 0.)) - volSample(uvw - vec3(e.x, 0., 0.)),
        volSample(uvw + vec3(0., e.y, 0.)) - volSample(uvw - vec3(0., e.y, 0.)),
        volSample(uvw + vec3(0., 0., e.z)) - volSample(uvw - vec3(0., 0., e.z))
    ) * (0.5 * uVolumeSize * uValueMap.x); // derivative per texture unit
}

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

    // texture space ray
    vec3 dirTex = vDirection / uBoxSize;
    float voxelsPerUnit = length(dirTex * uVolumeSize); // voxels crossed per unit of t'
    float dtRate = 1.0 / (max(uSamplingRate, 1e-3) * voxelsPerUnit);
    // a ray longer than VOLUME_MAX_STEPS samples takes longer steps, so it still reaches the end
    float dt = max(dtRate, (bounds.y - bounds.x) / float(VOLUME_MAX_STEPS));
    int steps = int(min(ceil((bounds.y - bounds.x) / dt), float(VOLUME_MAX_STEPS)));
    // opacity correction for the step actually taken (uOpacityExponent is for the sampling rate)
    float opacityExp = uOpacityExponent * dt / dtRate;
    vec3 startTex = (vOrigin + vDirection * bounds.x) / uBoxSize + 0.5;
    vec3 stepTex = dirTex * dt;
    float offset = uJitter > 0.5 ? volNoise(gl_FragCoord.xy) : 0.5;
    vec3 uvw = startTex + stepTex * offset;
    vec3 dirN = normalize(dirTex);

    vec4 acc = vec4(0.0);

    #if VOLUME_MODE == 0 // composite (direct volume rendering)
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (i >= steps) break;
        float v = volValue(uvw);
        vec4 s = volClassify(v, uvw);
        if (s.a > 0.0) {
            s.a = 1.0 - pow(max(1.0 - s.a, 0.0), opacityExp);
            s.rgb = volShade(s.rgb, uvw, dirN) * s.a;
            volBlend(acc, s);
            if (acc.a > 0.99) break;
        }
        uvw += stepTex;
    }

    #elif VOLUME_MODE == 1 || VOLUME_MODE == 2 // maximum / minimum intensity projection
    float best = VOLUME_MODE == 1 ? -1e20 : 1e20;
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (i >= steps) break;
        float v = volValue(uvw);
        best = VOLUME_MODE == 1 ? max(best, v) : min(best, v);
        uvw += stepTex;
    }
    vec4 s = volClassify(best, uvw);
    acc = vec4(s.rgb * s.a, s.a);

    #elif VOLUME_MODE == 3 // average intensity
    float sum = 0.0;
    float count = 0.0;
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (i >= steps) break;
        sum += volValue(uvw);
        count += 1.0;
        uvw += stepTex;
    }
    vec4 s = volClassify(sum / max(count, 1.0), uvw);
    acc = vec4(s.rgb * s.a, s.a);

    #elif VOLUME_MODE == 4 // isosurface
    float prevV = volValue(uvw);
    bool hit = false;
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (i >= steps) break;
        vec3 next = uvw + stepTex;
        float v = volValue(next);
        if ((prevV - uIsoValue) * (v - uIsoValue) <= 0.0 && v != prevV) {
            // refine between uvw and next by bisection
            vec3 a = uvw;
            vec3 b = next;
            float va = prevV;
            for (int k = 0; k < 6; k++) {
                vec3 m = 0.5 * (a + b);
                float vm = volValue(m);
                if ((va - uIsoValue) * (vm - uIsoValue) <= 0.0) { b = m; } else { a = m; va = vm; }
            }
            uvw = 0.5 * (a + b);
            hit = true;
            break;
        }
        prevV = v;
        uvw = next;
    }
    if (!hit) discard;
    vec4 s = volClassify(uIsoValue, uvw);
    vec3 n = volGradient(uvw) / uBoxSize; // object space normal direction, unnormalized
    vec3 nView = normalize(uNormalMatrix * n);
    if (dot(nView, vDirectionView) > 0.0) nView = -nView;
    // headlight: diffuse plus a little ambient, until scene lights come in phase 3
    vec3 l = normalize(-vDirectionView);
    float diffuse = max(dot(nView, l), 0.0);
    float spec = pow(max(dot(reflect(-l, nView), l), 0.0), 32.0) * 0.25;
    acc = vec4(s.rgb * (0.25 + 0.75 * diffuse) + spec, 1.0);

    #elif VOLUME_MODE == 5 // x-ray: summed absorption, grey
    float tau = 0.0;
    for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
        if (i >= steps) break;
        tau += volClassify(volValue(uvw), uvw).a;
        uvw += stepTex;
    }
    float a = 1.0 - exp(-tau * opacityExp);
    vec4 s = volClassify(1.0, uvw);
    acc = vec4(s.rgb * a, a);
    #endif

    if (acc.a <= 0.0) discard;

    // premultiplied colour
    gl_FragColor = acc;

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
