/* eslint-disable */
/* Based on https://github.com/mrdoob/three.js/blob/dev/test/e2e/deterministic-injection.js */
(function () {

    /* Deterministic random */

    window.Math._random = window.Math.random;

    let seed = Math.PI / 4;
    window.Math.random = function () {

        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);

    };

    /* Deterministic timer */

    window.performance._now = performance.now;

    let frameId = 0;
    // Base time: 2024-01-01T00:00:00Z (must be ≥1980 for ZIP compatibility with fflate)
    const baseTime = 1704067200000;
    const now = () => baseTime + frameId * 16;
    window.Date.now = now;
    window.Date.prototype.getTime = now;
    window.performance.now = now;
    // Expose frameId for test control (reset before screenshots for determinism)
    Object.defineProperty(window, '__testFrameId', {
        get: () => frameId,
        set: (v) => { frameId = v; },
    });

    /* Deterministic RAF */

    const RAF = window.requestAnimationFrame;

    /* Disable stochastic convergence plugins (TemporalAA, SSReflection, SSAA)
     * These plugins accumulate over frames and produce non-deterministic output
     * depending on exact frame count at screenshot time. */
    let _convergenceDisabled = false;

    window.requestAnimationFrame = function (cb) {

        RAF(function () {

            frameId++;

            if (!_convergenceDisabled) {
                const v = window.threeViewers && window.threeViewers[0];
                if (v && v.getPlugin) {
                    ['TemporalAAPlugin', 'SSReflectionPlugin', 'SSAAPlugin', 'WatchHandsPlugin'].forEach(function (name) {
                        const p = v.getPlugin(name);
                        if (p) p.enabled = false;
                    });
                    _convergenceDisabled = true;
                    v.setDirty();
                }
            }

            cb(now());

        });

    };

    /* Semi-deterministic video */

    const play = HTMLVideoElement.prototype.play;

    HTMLVideoElement.prototype.play = async function () {

        play.call(this);
        this.addEventListener('timeupdate', () => this.pause());

        function renew () {

            this.load();
            play.call(this);
            RAF(renew);

        }

        RAF(renew);

    };

    /* Additional variable for examples that check this */

    window.TESTING = true;

    /* Deterministic GLB export — patch GLTFWriter2 to produce byte-identical output.
     *
     * The base class processBufferViewImage uses FileReader.readAsArrayBuffer with
     * onloadend callbacks that fire in non-deterministic order, causing different
     * bufferView indices and binary layouts across runs.
     *
     * Fix: pre-allocate bufferView slots, defer buffer data, then in write() finalize
     * them in image-array order (deterministic) after all pending promises complete.
     *
     * Called from GLTFWriter2's static {} block during module load. */
    window.testing_patchGLTFWriter2 = function (GLTFWriter2) {
        var _origWrite = GLTFWriter2.prototype.write;

        GLTFWriter2.prototype.processBufferViewImage = function (blob) {
            if (!this._deferredImages) this._deferredImages = [];
            var ready = blob.arrayBuffer().then(function (ab) {
                if (ab.byteLength % 4 === 0) return ab;
                var padded = new ArrayBuffer(Math.ceil(ab.byteLength / 4) * 4);
                new Uint8Array(padded).set(new Uint8Array(ab));
                return padded;
            });
            var callIndex = this._deferredImages.length;
            this._deferredImages.push({ index: callIndex, ready: ready });
            return Promise.resolve(callIndex);
        };

        GLTFWriter2.prototype.write = async function (input, onDone, options) {
            if (!this._deferredImages) this._deferredImages = [];

            // --- Option setup (mirrors base class) ---
            this.options = Object.assign({
                binary: false, trs: false, onlyVisible: true, maxTextureSize: Infinity,
                animations: [], includeCustomExtensions: false,
                ignoreInvalidMorphTargetTracks: false, ignoreEmptyTextures: false,
            }, options || {});
            if (this.options.animations.length > 0) this.options.trs = true;

            this.processInput(input);
            await Promise.all(this.pending);

            // --- Finalize deferred image bufferViews in deterministic order ---
            if (this._deferredImages.length > 0) {
                var json = this.json;
                if (!json.bufferViews) json.bufferViews = [];
                var buffers = await Promise.all(this._deferredImages.map(function (d) { return d.ready; }));
                var callIndexToBuffer = {};
                for (var i = 0; i < this._deferredImages.length; i++) callIndexToBuffer[i] = buffers[i];
                var images = json.images || [];
                for (var j = 0; j < images.length; j++) {
                    var imageDef = images[j];
                    if (imageDef.bufferView === undefined) continue;
                    var buf = callIndexToBuffer[imageDef.bufferView];
                    if (!buf) continue;
                    imageDef.bufferView = json.bufferViews.push({
                        buffer: this.processBuffer(buf),
                        byteOffset: this.byteOffset,
                        byteLength: buf.byteLength,
                    }) - 1;
                    this.byteOffset += buf.byteLength;
                }
                this._deferredImages = [];
            }

            // --- Buffer merge and GLB assembly ---
            var json = this.json;
            var blob = new Blob(this.buffers, { type: 'application/octet-stream' });
            var extensionsUsedList = Object.keys(this.extensionsUsed);
            var extensionsRequiredList = Object.keys(this.extensionsRequired);
            if (extensionsUsedList.length > 0) json.extensionsUsed = extensionsUsedList;
            if (extensionsRequiredList.length > 0) json.extensionsRequired = extensionsRequiredList;
            if (json.buffers && json.buffers.length > 0) json.buffers[0].byteLength = blob.size;

            if (this.options.binary) {
                var ab = await blob.arrayBuffer();
                var binPad = (4 - ab.byteLength % 4) % 4;
                var binaryChunk = binPad === 0 ? ab : (function () { var p = new ArrayBuffer(ab.byteLength + binPad); new Uint8Array(p).set(new Uint8Array(ab)); return p; })();
                var jsonStr = JSON.stringify(json);
                var jsonBytes = new TextEncoder().encode(jsonStr);
                var jsonPad = (4 - jsonBytes.byteLength % 4) % 4;
                var jsonChunk = new ArrayBuffer(jsonBytes.byteLength + jsonPad);
                new Uint8Array(jsonChunk).set(jsonBytes);
                if (jsonPad > 0) new Uint8Array(jsonChunk).fill(0x20, jsonBytes.byteLength);
                var totalByteLength = 12 + 8 + jsonChunk.byteLength + 8 + binaryChunk.byteLength;
                var glb = new ArrayBuffer(totalByteLength);
                var view = new DataView(glb);
                var offset = 0;
                view.setUint32(offset, 0x46546C67, true); offset += 4;
                view.setUint32(offset, 2, true); offset += 4;
                view.setUint32(offset, totalByteLength, true); offset += 4;
                view.setUint32(offset, jsonChunk.byteLength, true); offset += 4;
                view.setUint32(offset, 0x4E4F534A, true); offset += 4;
                new Uint8Array(glb, offset, jsonChunk.byteLength).set(new Uint8Array(jsonChunk)); offset += jsonChunk.byteLength;
                view.setUint32(offset, binaryChunk.byteLength, true); offset += 4;
                view.setUint32(offset, 0x004E4942, true); offset += 4;
                new Uint8Array(glb, offset, binaryChunk.byteLength).set(new Uint8Array(binaryChunk));
                onDone(glb);
            } else {
                if (json.buffers && json.buffers.length > 0) {
                    var reader = new FileReader();
                    reader.readAsDataURL(blob);
                    reader.onloadend = function () { json.buffers[0].uri = reader.result; onDone(json); };
                } else {
                    onDone(json);
                }
            }
        };
    };

}());
