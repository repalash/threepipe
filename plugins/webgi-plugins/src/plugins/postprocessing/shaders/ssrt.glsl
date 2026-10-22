#ifndef SSRT_PARS_SNIP
#define SSRT_PARS_SNIP

#define pow2(a) a*a

float getDepth2(const in vec2 uv, const in float lod) {
    float viewDepth = getDepth(uv);
    return depthToViewZ(viewDepth);
}

#define LOD_DEPTH 1.0// todo: generate mipmap depth and set.
#define LOD_COLOR 5.0

// multiple of 4
//#define I_STEP_COUNT (1./float(STEP_COUNT))

void _traceRay(in vec4 ray_origin, in vec4 ray_dir, in float tolerance, inout vec3 state, in int loopMax, in float iStepCount){
    vec4 sample_uv;
    float d, hit;
    float dLod = 0.;//floor(LOD_DEPTH * roughness);

    #pragma unroll_loop_start
    for (int i = 0; i < 8; i++){
        if ( UNROLLED_LOOP_INDEX < loopMax ){

            sample_uv = ray_origin + ray_dir * state.y;
            d = getDepth2(sample_uv.xy, dLod);
            d = sample_uv.z/sample_uv.w - d;
            if (abs(d + tolerance) < tolerance){

                hit = clamp(state.x / (state.x - d), 0., 1.) - 1.;
                hit = (state.y + hit * iStepCount);
                state.z = min(state.z, hit);

            }
            state.x = d;//depth diff
            state.y += 1. * iStepCount;

        }
    }
    #pragma unroll_loop_end

}

vec3 traceRay(in vec3 ray_origin_view, in vec3 ray_dir_view, in float tolerance, inout vec3 state, in int _STEP_COUNT){
    vec4 sample_uv;
//    float stepCount = float(_STEP_COUNT);

    vec4 ray_origin = viewToScreen3(ray_origin_view);

    vec3 ray_end_view = ray_origin_view + ray_dir_view;
    vec4 ray_dir = viewToScreen3(ray_end_view); // ray_end

    // clamp ray to screen edge.
    vec2 clamp_end = clamp(ray_dir.xy, vec2(0.), vec2(1.));
    vec2 correction = abs(ray_dir.xy - clamp_end);
    correction = ( step(0.01, correction) * correction / (abs(clamp_end - ray_origin.xy) + 0.01) ) + 1.; // = ((b-c)/(c-a) + 1) see bottom
    correction.x = 1./min(max(correction.y, correction.x), 10.);

    ray_dir = ray_dir - ray_origin;

    ray_dir.xyw *= correction.x;
//    tolerance /= correction.x;

//    if(len(ray_dir.xyw) < 0.1){
//        ray_dir.xyw = normalize(ray_dir.xyw)*0.1;
//    }

    float iStepCount = 1./float(_STEP_COUNT);
    tolerance *= 0.125;
//    tolerance *= iStepCount;

    _traceRay(ray_origin, ray_dir, tolerance, state, _STEP_COUNT, iStepCount);
    if(_STEP_COUNT > 8 && state.z > 0.98) _traceRay(ray_origin, ray_dir, tolerance, state, _STEP_COUNT-8, iStepCount);
    if(_STEP_COUNT > 15 && state.z > 0.98) _traceRay(ray_origin, ray_dir, tolerance, state, _STEP_COUNT-16, iStepCount);
    if(_STEP_COUNT > 23 && state.z > 0.98) _traceRay(ray_origin, ray_dir, tolerance, state, _STEP_COUNT-16, iStepCount);


    sample_uv = ray_origin + ray_dir * state.z;
    sample_uv.z /= sample_uv.w;

    state.z = state.z < 0.999 ? state.z : 9999999.;
    return sample_uv.xyz;
}



/**
for ray clipping

a = ray_origin
b = ray_end
c = clamp(b)
x = c.y - a.y
y = b.y - c.y
(c.y-a.y)/(b.y-c.y) = m/(l-m)
m/(l-m) = k
m = kl - km
m = kl/(1+k)

((c-a)/(b-c) ) / (1 + (c-a)/(b-c))
x/(y*(1+x/y))
x/(y+x)
1/(y/x+1)

x/(y + yx)
1/(y/x + y)

ray scale =

k/(1+k)
1/(1/k+1)

=
1/((b-c)/(c-a) + 1)

**/
#endif
