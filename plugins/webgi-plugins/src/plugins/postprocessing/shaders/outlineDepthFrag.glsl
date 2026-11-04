uniform vec2 cameraNearFar;
varying vec3 vViewPosition;

vec2 pack16(float value) {
    float sMax = 65535.0;
    int v = int(clamp(value, 0.0, 1.0)*sMax+0.5);
    int digit0 = v/256;
    int digit1 = v-digit0*256;
    return vec2(float(digit0)/255.0, float(digit1)/255.0);
}

float linstep(float edge0, float edge1, float value) {
    return clamp((value-edge0)/(edge1-edge0), 0.0, 1.0);
}

void main() {

    float linearZ = linstep(-cameraNearFar.x, -cameraNearFar.y, -vViewPosition.z);
    vec2 packedZ = pack16(pow(max(0., linearZ), 0.5));

    gl_FragColor = vec4(packedZ.x, packedZ.y, 0., 0.);
}
