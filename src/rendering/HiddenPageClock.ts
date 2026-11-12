/**
 * Keeps frames coming while the page is hidden. A browser stops `requestAnimationFrame` in a hidden tab, and slows
 * `setTimeout` to once a second and then to nothing; a timer in a worker keeps its pace. So while the page is hidden and
 * someone holds the clock, a worker ticks about 60 times a second and each tick calls `onTick(time)`; when the page is
 * visible again it stops, and `requestAnimationFrame` drives the frames as before.
 *
 * Measured in Chrome 156 (macOS, 8.5 minutes hidden): about 62 ticks a second the whole time; `setTimeout` gave 1.6, then
 * 0 from the third minute. A browser can still freeze a tab hidden for long (Chrome's Energy and Memory Saver).
 * As of November 2026, Safari pauses a hidden tab anyway (tried with a recording); Firefox and phones are not tested yet.
 * Rendering in the background uses the CPU and GPU, so hold it only for a task that needs it, like a recording.
 *
 * Does nothing where there is no `document` or `Worker` (Node.js).
 * Used by {@link RenderManager.keepRenderingWhenHidden}.
 */
export class HiddenPageClock {
    private _holders = new Set<string>()
    private _worker?: Worker
    private _listening = false

    /**
     * @param onTick - called on each tick while the page is hidden and the clock is held, with `performance.now()`
     * @param interval - milliseconds between ticks
     */
    constructor(public onTick: (time: number) => void, public interval = 16) {}

    /** The clock is held by someone */
    get held(): boolean {
        return this._holders.size > 0
    }

    /** The worker ticks now (held, and the page is hidden) */
    get ticking(): boolean {
        return !!this._worker
    }

    hold(key: string): void {
        this._holders.add(key)
        if (typeof document === 'undefined') return
        if (!this._listening) {
            document.addEventListener('visibilitychange', this._update)
            this._listening = true
        }
        this._update()
    }

    release(key: string): void {
        this._holders.delete(key)
        if (this._holders.size) return
        this._stop()
        if (this._listening) {
            document.removeEventListener('visibilitychange', this._update)
            this._listening = false
        }
    }

    dispose(): void {
        this._holders.clear()
        this.release('')
    }

    private _update = () => {
        if (this._holders.size && document.visibilityState === 'hidden') this._start()
        else this._stop()
    }

    private _start() {
        if (this._worker || typeof Worker === 'undefined') return
        let url: string | undefined
        try {
            url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${this.interval})`], {type: 'text/javascript'}))
            this._worker = new Worker(url)
        } catch (e) {
            // a Content Security Policy without blob: workers: frames stop while hidden, as without the clock
            console.warn('HiddenPageClock: no worker, frames stop while the page is hidden', e)
            return
        } finally {
            if (url) URL.revokeObjectURL(url)
        }
        this._worker.onmessage = () => this.onTick(performance.now())
    }

    private _stop() {
        this._worker?.terminate()
        this._worker = undefined
    }
}
