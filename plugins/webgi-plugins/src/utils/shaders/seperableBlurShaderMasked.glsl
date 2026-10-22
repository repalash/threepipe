varying vec2 vUv;
uniform sampler2D colorTexture;
uniform sampler2D maskTexture;
uniform vec2 texSize;
uniform vec2 direction;

float gaussianPdf(in float x, in float sigma) {
    return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
}

void main() {
    vec2 invSize = 1.0 / texSize;
    float fSigma = float(SIGMA);
    float weightSum = gaussianPdf(0.0, fSigma);
    vec4 mask = texture2D( maskTexture, vUv);
    vec3 diffuseSum = texture2D( colorTexture, vUv).rgb * weightSum;
    for( int i = 1; i < KERNEL_RADIUS; i ++ ) {
        float x = float(i);
        float w = gaussianPdf(x, fSigma);
        vec2 uvOffset = direction * invSize * x;
        vec3 sample1 = texture2D( colorTexture, vUv + uvOffset).rgb;
        vec3 sample2 = texture2D( colorTexture, vUv - uvOffset).rgb;
        diffuseSum += (sample1 + sample2) * w;
        weightSum += 2.0 * w;
    }
    //gl_FragColor = vec4(diffuseSum/weightSum * mask.r, 1.0);
    gl_FragColor = vec4(diffuseSum/weightSum, 1.0);
}
