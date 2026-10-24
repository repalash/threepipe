#include <common>
varying vec2 vUv;
//uniform sampler2D cocTexture;
uniform vec2 colorTextureSize;
//uniform vec2 screenSize;
uniform vec2 direction;
const float MAXIMUM_BLUR_SIZE = 16.0;

const float SIGMA = 5.0;
const int NUM_SAMPLES = 4;

float normpdf(in float x, in float sigma)
{
    return 0.39894*exp(-0.5*x*x/(sigma*sigma))/sigma;
}

vec3 weightedBlur() {
    float cocIn = 2. * cocTextureTexelToLinear(texture2D(cocTexture, vUv)).a - 1.;
    float kernelRadius = MAXIMUM_BLUR_SIZE * cocIn;
    vec2 invSize = 1.0 / colorTextureSize;
    cocIn *= cocIn * cocIn;
    float centerSpaceWeight = normpdf(0.0, SIGMA) * abs(cocIn);
    float weightSum = centerSpaceWeight;
    vec3 centerSample = colorTextureTexelToLinear(texture2D(colorTexture, vUv)).rgb;
    vec3 diffuseSum = centerSample * weightSum;
    vec2 delta = invSize * kernelRadius/float(NUM_SAMPLES);
    for( int i = 1; i <= NUM_SAMPLES; i ++ ) { // todo unroll?
        float spaceWeight = normpdf(float(i), SIGMA);
        vec2 texcoord = direction * delta * float(i);
        vec4 rightSample = colorTextureTexelToLinear(texture2D( colorTexture, vUv + texcoord));
        vec4 leftSample = colorTextureTexelToLinear(texture2D( colorTexture, vUv - texcoord));
        float leftCocWeight = abs(2. * cocTextureTexelToLinear(texture2D( cocTexture, vUv - texcoord)).a - 1.);
        float rightCocWeight = abs(2. * cocTextureTexelToLinear(texture2D( cocTexture, vUv + texcoord)).a - 1.);
        leftCocWeight *= leftCocWeight * leftCocWeight;
        rightCocWeight *= rightCocWeight * rightCocWeight;
        diffuseSum += ( (leftSample.rgb * leftCocWeight) + (rightSample.rgb * rightCocWeight) ) * spaceWeight;
        weightSum += (spaceWeight * (leftCocWeight + rightCocWeight));
    }
    return diffuseSum/weightSum;
}

void main() {
    gl_FragColor = vec4(weightedBlur(), 1.0);

    #include <colorspace_fragment>
}
