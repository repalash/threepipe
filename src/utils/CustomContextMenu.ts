import styles from './CustomContextMenu.css?inline'

/**
 * Represents a custom context menu that can be created and managed dynamically.
 */
export class CustomContextMenu {
    /**
     * The HTML element representing the context menu.
     */
    public static Element: HTMLDivElement | undefined = undefined

    /**
     * Indicates whether the context menu has been initialized.
     */
    private static _inited = false

    /**
     * Initializes the context menu by adding event listeners.
     * This method should be called before creating a context menu.
     */
    private static _initialize(): void {
        this._inited = true
        document.addEventListener('pointerdown', (e) => {
            if (this.Element && !this.Element.contains(e.target as any) && e.button === 0) {
                this.Remove()
            }
        })
    }

    /**
     * Creates a custom context menu with specified items and options.
     *
     * @param items - An object containing menu item labels and corresponding callback functions.
     * @param x - The horizontal position of the context menu.
     * @param y - The vertical position of the context menu.
     * @param show - Indicates whether the context menu should be displayed immediately.
     * @param removeOnSelect - Indicates whether the context menu should be removed after an item is selected.
     * @returns The HTML element representing the created context menu.
     */
    public static Create(
        items: Record<string, () => void>,
        x: number,
        y: number,
        show = true,
        removeOnSelect = true
    ): HTMLDivElement {
        if (!this._inited) this._initialize()

        if (this.Element) this.Remove()

        const container = document.createElement('div')
        container.id = 'customContextMenu'
        container.style.top = y + 'px'
        container.style.left = x + 'px'
        container.innerHTML = '<style>' + styles + '</style>'

        for (const [key, func] of Object.entries(items)) {
            const d = document.createElement('div')
            d.classList.add('customContextMenuItems')
            d.textContent = key
            container.appendChild(d)
            d.onclick = async() => {
                await func()
                if (removeOnSelect) this.Remove()
            }
        }

        this.Element = container
        if (show) document.body.appendChild(container)
        return container
    }

    /**
     * Removes the context menu from the DOM.
     */
    public static Remove(): void {
        this.Element?.remove()
        this.Element = undefined
    }
}
