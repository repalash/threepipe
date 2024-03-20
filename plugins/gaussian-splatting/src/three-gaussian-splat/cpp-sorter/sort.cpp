#include <emscripten/bind.h>
#include <algorithm>
#include <cstdint>
#include <cmath>
#include <vector>
#include <numeric>
#include <stdio.h>
#include <cstring>


union DepthIndex {
    struct {
        float depth;
        uint32_t index;
    };

    bool operator < (const DepthIndex& other) const {
        return depth < other.depth;
    }
};

uint32_t floatToUInt(float f) {
    uint32_t u;
    std::memcpy(&u, &f, sizeof(float));
    uint32_t mask = -int32_t(u >> 31) | 0x80000000;
    return u ^ mask;
}

void radixSort(std::vector<DepthIndex>& depthIndices) {
    const int n = depthIndices.size();
    std::vector<DepthIndex> temp(n);

    for (int shift = 0; shift < 32; shift += 8) {
        size_t count[256] = {};
        for (auto& di : depthIndices) {
            count[(floatToUInt(di.depth) >> shift) & 0xFF]++;
        }
        size_t pos[256];
        pos[0] = 0;
        for (int i = 1; i < 256; i++) {
            pos[i] = pos[i - 1] + count[i - 1];
        }
        for (auto& di : depthIndices) {
            int index = (floatToUInt(di.depth) >> shift) & 0xFF;
            temp[pos[index]++] = di;
        }
        depthIndices.swap(temp);
    }
}


using namespace emscripten;


void runSort(int viewProjPtr, int bufferPtr, int vertexCount, int combinedPtr) {
    auto *viewProj = reinterpret_cast<float *>(viewProjPtr);
    uint8_t *buffer = reinterpret_cast<uint8_t *>(bufferPtr);
    auto *combined = reinterpret_cast<float *>(combinedPtr);

    // Calculate lengths based on vertexCount
    int quatLength = 4 * vertexCount;
    int scaleLength = 3 * vertexCount;
    int centerLength = 3 * vertexCount;
    int colorLength = 4 * vertexCount;

    // Calculate offsets for each array within the combined array
    int quatOffset = 0;
    int scaleOffset = quatOffset + quatLength;
    int centerOffset = scaleOffset + scaleLength;
    int colorOffset = centerOffset + centerLength;

    std::vector<DepthIndex> depthIndices(vertexCount);
    for (int i = 0; i < vertexCount; ++i) {
        auto *f_buffer = reinterpret_cast<float *>(buffer + 32 * i);
        depthIndices[i].depth = 10000 - (viewProj[2] * f_buffer[0] + viewProj[6] * f_buffer[1] + viewProj[10] * f_buffer[2]);
        depthIndices[i].index = i;
    }

    radixSort(depthIndices);

    for (int i = 0; i < vertexCount; ++i) {
        uint32_t index = depthIndices[i].index;
        auto *f_buffer = reinterpret_cast<float *>(buffer + 32 * index);

        combined[quatOffset + 4 * i + 0] = (buffer[32 * index + 28 + 0] - 128) / 128.0f;
        combined[quatOffset + 4 * i + 1] = (buffer[32 * index + 28 + 1] - 128) / 128.0f;
        combined[quatOffset + 4 * i + 2] = (buffer[32 * index + 28 + 2] - 128) / 128.0f;
        combined[quatOffset + 4 * i + 3] = (buffer[32 * index + 28 + 3] - 128) / 128.0f;

        combined[centerOffset + 3 * i + 0] = f_buffer[0];
        combined[centerOffset + 3 * i + 1] = f_buffer[1];
        combined[centerOffset + 3 * i + 2] = f_buffer[2];

        combined[colorOffset + 4 * i + 0] = buffer[32 * index + 24 + 0] / 255.0f;
        combined[colorOffset + 4 * i + 1] = buffer[32 * index + 24 + 1] / 255.0f;
        combined[colorOffset + 4 * i + 2] = buffer[32 * index + 24 + 2] / 255.0f;
        combined[colorOffset + 4 * i + 3] = buffer[32 * index + 24 + 3] / 255.0f;

        combined[scaleOffset + 3 * i + 0] = f_buffer[3];
        combined[scaleOffset + 3 * i + 1] = f_buffer[4];
        combined[scaleOffset + 3 * i + 2] = f_buffer[5];
    }
}

EMSCRIPTEN_BINDINGS(my_module) {
    function("runSort", &runSort);
}
