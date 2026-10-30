/**
 * The waits of a plugin that end when the plugin is removed (or its viewer is disposed): no frame, animation or
 * recorder event comes after that. The plugin calls {@link endAll} in its `onRemove`.
 */
export class RemovalWaits {
    private _ends = new Set<() => void>()
    /** Counts the calls of {@link endAll}: one per removal */
    private _removals = 0

    /** The number of waits that run */
    get size(): number {
        return this._ends.size
    }

    /** Adds the end of a wait, which {@link endAll} calls */
    add(end: () => void): void {
        this._ends.add(end)
    }

    /** Removes the end of a wait that ended */
    delete(end: () => void): void {
        this._ends.delete(end)
    }

    /** Ends every wait that runs: the plugin is removed */
    endAll(): void {
        this._removals++
        ;[...this._ends].forEach(end => end())
        this._ends.clear()
    }

    /**
     * A check of whether the waits ended (the plugin was removed) after this call. An async step checks it after each
     * wait, so it does not act on the state of a later add of the plugin.
     */
    watch(): () => boolean {
        const removals = this._removals
        return () => this._removals !== removals
    }

    /**
     * Waits for the promise, or for {@link endAll}, whichever comes first.
     * @param promise - the wait, e.g. a frame, an animation or a recorder event
     * @returns the value of the promise, or `undefined` when the waits end first
     */
    async race<T>(promise: Promise<T>): Promise<T | undefined> {
        let end!: () => void
        const removed = new Promise<undefined>(resolve => end = () => resolve(undefined))
        this._ends.add(end)
        try {
            return await Promise.race([promise, removed])
        } finally {
            this._ends.delete(end)
        }
    }
}
