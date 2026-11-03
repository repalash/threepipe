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

}());
