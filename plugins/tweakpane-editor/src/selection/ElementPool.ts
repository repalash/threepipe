/**
 * Elements by key that stay between redraws, so an element under the pointer keeps its identity (hover, cursor).
 * A redraw calls {@link begin}, then {@link get} for each element it draws, then {@link end}, which removes the elements
 * it did not get. An attribute is written only when its value changes.
 */
export class ElementPool<T extends Element> {
    private _els = new Map<string, T>()
    private _used = new Set<string>()

    /**
     * @param root - the parent of the elements
     * @param create - makes an element of a tag name
     */
    constructor(readonly root: Element, private _create: (tag: string) => T) {}

    begin() {
        this._used.clear()
    }

    /**
     * The element of `key`, made (or made again for another tag) and added to the root when needed
     * @param attrs - attributes to set, `undefined` removes one. A camelCase name is the kebab-case attribute
     * (`strokeWidth` sets `stroke-width`), so an attribute that is camelCase itself (`viewBox`) cannot be set here.
     */
    get(key: string, tag: string, attrs: Record<string, string | number | undefined>): T {
        let e = this._els.get(key)
        if (!e || e.tagName.toLowerCase() !== tag) {
            e?.remove()
            e = this._create(tag)
            this.root.appendChild(e)
            this._els.set(key, e)
        }
        this._used.add(key)
        for (const [k, v] of Object.entries(attrs)) {
            const name = k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
            if (v === undefined) e.removeAttribute(name)
            else if (e.getAttribute(name) !== String(v)) e.setAttribute(name, String(v))
        }
        return e
    }

    /** Remove the elements that were not got since {@link begin} */
    end() {
        for (const [k, e] of this._els) if (!this._used.has(k)) {
            e.remove()
            this._els.delete(k)
        }
    }

    /** Remove all elements */
    clear() {
        this._els.forEach(e => e.remove())
        this._els.clear()
        this._used.clear()
    }
}
