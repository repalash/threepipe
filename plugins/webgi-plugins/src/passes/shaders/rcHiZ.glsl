// Depth pyramid for the radiance cascades march (RadianceCascadesGI.ts). Level k holds, per texel, the nearest (r) and
// the farthest (g) linear depth (distance along -z, view units) of the 2^k x 2^k pixels it covers. Level 1 reads the
// G-buffer, each further level reads the one before (tSource). Background pixels count as very far.
// A texel reads the 3x3 children starting at 2p (clamped), so odd sizes are covered; the extra row and column make the
// bounds slightly conservative, which only costs a few more fine steps.

layout(location = 0) out highp vec4 outDepth;

uniform bool fromGBuffer;
uniform vec2 sourceSize; // size of the source level in texels

#define RC_FAR_DEPTH 60000.0

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy) * 2;
    ivec2 maxP = ivec2(sourceSize) - 1;
    float nearest = RC_FAR_DEPTH, farthest = 0.0;
    for (int y = 0; y < 3; y++) {
        for (int x = 0; x < 3; x++) {
            ivec2 q = min(p + ivec2(x, y), maxP);
            vec2 d;
            if (fromGBuffer) {
                float depth = getDepth((vec2(q) + 0.5) / sourceSize);
                float z = depth > 0.999 ? RC_FAR_DEPTH : -depthToViewZ(depth);
                d = vec2(z);
            } else d = texelFetch(tSource, q, 0).rg;
            nearest = min(nearest, d.x);
            farthest = max(farthest, d.y);
        }
    }
    outDepth = vec4(nearest, farthest, 0.0, 0.0);
}
