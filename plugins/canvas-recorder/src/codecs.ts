/**
 * Video codec families supported by the WebCodecs video recorder. All are written into an MP4 container.
 * - `avc` - H.264, plays everywhere. Default.
 * - `vp9` - VP9, wide software encoder support (Chrome, Firefox).
 * - `av1` - AV1, best compression, slow software encoders.
 * - `hevc` - H.265, only when set with a full codec string (see {@link CanvasRecordOptions.codecString}).
 */
export type VideoCodecName = 'avc' | 'hevc' | 'vp9' | 'av1'

/**
 * H.264 levels (ITU-T H.264 Table A-1).
 * [level_idc, max frame size in macroblocks, max macroblocks per second, max bitrate in kbit/s (Baseline/Main, High is 1.25x)]
 */
const avcLevels: [number, number, number, number][] = [
    [30, 1620, 40500, 10000],
    [31, 3600, 108000, 14000],
    [32, 5120, 216000, 20000],
    [40, 8192, 245760, 20000],
    [41, 8192, 245760, 50000],
    [42, 8704, 522240, 50000],
    [50, 22080, 589824, 135000],
    [51, 36864, 983040, 240000],
    [52, 36864, 2073600, 240000],
    [60, 139264, 4177920, 240000],
    [61, 139264, 8355840, 480000],
    [62, 139264, 16711680, 800000],
]

/**
 * VP9 levels (VP9 bitstream specification, Annex A).
 * [level, max luma picture size, max luma sample rate]
 */
const vp9Levels: [number, number, number][] = [
    [10, 36864, 829440],
    [11, 73728, 2764800],
    [20, 122880, 4608000],
    [21, 245760, 9216000],
    [30, 552960, 20736000],
    [31, 983040, 36864000],
    [40, 2228224, 83558400],
    [41, 2228224, 160432128],
    [50, 8912896, 311951360],
    [51, 8912896, 588251136],
    [52, 8912896, 1176502272],
    [60, 35651584, 1176502272],
    [61, 35651584, 2353004544],
    [62, 35651584, 4706009088],
]

/**
 * AV1 levels (AV1 bitstream specification, Annex A).
 * [seq_level_idx, max picture size, max display rate (samples per second)]
 */
const av1Levels: [number, number, number][] = [
    [0, 147456, 4423680],
    [1, 278784, 8363520],
    [4, 665856, 19975680],
    [5, 1065024, 31950720],
    [8, 2359296, 70778880],
    [9, 2359296, 141557760],
    [12, 8912896, 267386880],
    [13, 8912896, 534773760],
    [14, 8912896, 1069547520],
    [16, 35651584, 1069547520],
    [17, 35651584, 2139095040],
    [18, 35651584, 4278190080],
]

/**
 * Returns the smallest H.264 level that fits the resolution, frame rate and bitrate.
 * @param width - frame width in pixels
 * @param height - frame height in pixels
 * @param fps - frames per second
 * @param bitrate - bits per second
 * @returns the `level_idc` (like `42` for level 4.2)
 */
export function getAvcLevel(width: number, height: number, fps: number, bitrate = 0): number {
    const mbWidth = Math.ceil(width / 16)
    const mbHeight = Math.ceil(height / 16)
    const frameSize = mbWidth * mbHeight
    const mbps = frameSize * fps
    const kbps = bitrate / 1000
    for (const [level, maxFs, maxMbps, maxBr] of avcLevels) {
        // each dimension in macroblocks must be at most sqrt(8 * MaxFS) (H.264 A.3.1)
        const maxDim = Math.sqrt(maxFs * 8)
        if (frameSize <= maxFs && mbps <= maxMbps && kbps <= maxBr * 1.25 && mbWidth <= maxDim && mbHeight <= maxDim) return level
    }
    return avcLevels[avcLevels.length - 1][0]
}

/**
 * Returns the first level in the table that fits the picture size and the sample rate.
 * @param levels - [level, max picture size, max sample rate] sorted by level
 * @param width - frame width in pixels
 * @param height - frame height in pixels
 * @param fps - frames per second
 */
function findLevel(levels: [number, number, number][], width: number, height: number, fps: number) {
    const size = width * height
    const rate = size * fps
    for (const [level, maxSize, maxRate] of levels) {
        if (size <= maxSize && rate <= maxRate) return level
    }
    return levels[levels.length - 1][0]
}

/**
 * Returns a WebCodecs codec string for the codec family, the resolution and the frame rate.
 *
 * - `avc`: High profile, like `avc1.64002A` (level 4.2) for 1080p at 60 fps.
 * - `vp9`: Profile 0, 8-bit, like `vp09.00.41.08`.
 * - `av1`: Main profile, main tier, 8-bit, like `av01.0.09M.08`.
 *
 * `hevc` has no default string, it returns an empty string. Set a full codec string for it.
 * @param codec - codec family
 * @param width - frame width in pixels
 * @param height - frame height in pixels
 * @param fps - frames per second
 * @param bitrate - bits per second, used to pick the H.264 level
 */
export function getVideoCodecString(codec: VideoCodecName, width: number, height: number, fps: number, bitrate = 0): string {
    switch (codec) {
    case 'avc': {
        const level = getAvcLevel(width, height, fps, bitrate)
        return 'avc1.6400' + level.toString(16).toUpperCase().padStart(2, '0')
    }
    case 'vp9':
        return 'vp09.00.' + findLevel(vp9Levels, width, height, fps).toString().padStart(2, '0') + '.08'
    case 'av1':
        return 'av01.0.' + findLevel(av1Levels, width, height, fps).toString().padStart(2, '0') + 'M.08'
    default:
        return ''
    }
}

/**
 * Returns the codec family of a WebCodecs codec string, used for the MP4 muxer.
 * @param codecString - like `avc1.64002A`, `vp09.00.41.08`, `av01.0.09M.08`, `hvc1.1.6.L123.B0`
 */
export function getCodecFromString(codecString: string): VideoCodecName | undefined {
    const prefix = codecString.trim().split('.')[0].toLowerCase()
    if (prefix === 'avc1' || prefix === 'avc3') return 'avc'
    if (prefix === 'hvc1' || prefix === 'hev1') return 'hevc'
    if (prefix === 'vp09') return 'vp9'
    if (prefix === 'av01') return 'av1'
    return undefined
}

/**
 * Default video bitrate in bits per second: about 0.12 bits per pixel per frame, clamped to 1-100 Mbit/s.
 * This is about 15 Mbit/s for 1080p at 60 fps.
 * @param width - frame width in pixels
 * @param height - frame height in pixels
 * @param fps - frames per second
 */
export function getDefaultBitrate(width: number, height: number, fps: number): number {
    return Math.round(Math.min(100e6, Math.max(1e6, width * height * fps * 0.12)))
}

/**
 * Rounds a size down to an even number (minimum 2). H.264 and other 4:2:0 encoders need even frame sizes.
 * @param size - size in pixels
 */
export function evenSize(size: number): number {
    return Math.max(2, Math.floor(size / 2) * 2)
}

/**
 * Timestamp and duration of a frame in microseconds, as used by `VideoFrame`.
 * Computed from the frame index, so the timestamps do not drift.
 * @param index - frame index, starting at 0
 * @param fps - frames per second
 */
export function getFrameTiming(index: number, fps: number): {timestamp: number, duration: number} {
    const timestamp = Math.round(index * 1e6 / fps)
    const next = Math.round((index + 1) * 1e6 / fps)
    return {timestamp, duration: next - timestamp}
}
